/**
 * Appointment Migrator
 *
 * Handles migration of inst_turnos (appointments) to appointments table.
 * Covers Requirements 3.1 - 3.5, 6.5, 6.7.
 *
 * Key features:
 * - Maps Turno_motivoid → reason_id, Turno_doctor → doctor_id, Turno_fecha → date,
 *   Turno_hora → schedule_id, Turno_obrasocialid → insurance_id
 * - Discards Turno_telefono (Requirement 3.2)
 * - Resolves Turno_paciente via PatientMatcher.match(..., 'last_name_only') (Requirement 3.3, 6.5)
 * - Validates Turno_hora against scheduleIds; sets NULL + warning if not found (Requirement 3.4)
 * - Maps Turno_estado via deterministic APPOINTMENT_STATUS_MAP (Requirement 3.5)
 * - Supports idempotent re-execution via MigrationLogStore
 */

import { PoolClient } from 'pg';
import { PostgresClient, calculatePayloadHash } from '../db/client';
import { MigrationLogStore } from '../db/migration-log';
import { normalizeText } from '../utils/normalize';
import { PatientMatcher, PatientCandidate } from '../matcher/patient-matcher';

/**
 * Raw appointment row from inst_turnos table dump
 * Requirement 3.1, 3.2
 */
export type AppointmentRow = {
  idTurno: number;
  Turno_paciente?: string | null; // text libre (apellido solamente, last_name_only mode)
  Turno_motivoid?: number | null; // reason_id (may be NULL)
  Turno_doctor?: number | null; // doctor_id (may be NULL)
  Turno_fecha?: string | null; // 'YYYY-MM-DD' or '0000-00-00' or NULL
  Turno_hora?: number | null; // schedule_id (may be NULL)
  Turno_obrasocialid?: number | null; // insurance_id (may be NULL)
  Turno_estado?: number | null; // status (0, 1, 2, 3, etc.)
  Turno_telefono?: string | null; // DISCARDED (Requirement 3.2)
  [key: string]: any;
};

/**
 * Deterministic mapping of legacy appointment status values to destination status.
 * Requirement 3.5: Any value not in this map → DEFAULT_APPOINTMENT_STATUS + warning
 */
export const APPOINTMENT_STATUS_MAP: Record<number, string> = {
  0: 'pending',
  1: 'confirmed',
  2: 'completed',
  3: 'cancelled',
};

/**
 * Default appointment status for unknown/unmapped values.
 * Requirement 3.5
 */
export const DEFAULT_APPOINTMENT_STATUS = 'pending';

/**
 * Context for appointment migration
 * Requirement 3.3, 3.4, 6.5
 */
export type AppointmentMigrationContext = {
  /** Set of valid schedule IDs in the destination database */
  scheduleIds: Set<number>;
  /** Pool of candidate patients for matching */
  patientPool: PatientCandidate[];
};

/**
 * Result of appointment migration
 */
export type AppointmentMigrationResult = {
  /** Number of new appointments inserted */
  migrated: number;
  /** Number of appointments reused (already existed) */
  reused: number;
  /** Errors encountered (prevents row from being counted) */
  errors: Array<{ sourceId: any; error: string }>;
  /** Warnings (row processed but with some issue) */
  warnings: Array<{ sourceId: any; warning: string }>;
};

export type AppointmentMigrator = {
  migrate(
    rows: AppointmentRow[],
    context: AppointmentMigrationContext,
    patientMatcher: PatientMatcher,
    client: PostgresClient,
    logStore: MigrationLogStore,
  ): Promise<AppointmentMigrationResult>;
};

/**
 * Helper: Extract non-empty strings from a value, trimming whitespace
 */
function extractNonEmpty(value: any): string | null {
  if (!value) return null;
  const str = String(value).trim();
  return str.length > 0 ? str : null;
}

/**
 * Validate a date string and convert to DATE format or NULL.
 * Requirement 3.1: Turno_fecha should be 'YYYY-MM-DD' or '0000-00-00' (sentinel)
 * Returns null for invalid dates or sentinel values.
 */
function parseDate(dateStr: any): string | null {
  if (!dateStr) {
    return null;
  }

  const str = String(dateStr).trim();
  if (str === '0000-00-00' || str.length === 0) {
    return null;
  }

  // Validate YYYY-MM-DD format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(str)) {
    return null;
  }

  return str;
}

/**
 * Resolve appointment status from legacy value.
 * Requirement 3.5: Map via APPOINTMENT_STATUS_MAP; unknown values → DEFAULT_APPOINTMENT_STATUS + warning
 */
function resolveStatus(
  turnoEstado: number | null | undefined,
): { status: string; warning: string | null } {
  if (turnoEstado === null || turnoEstado === undefined) {
    // NULL estado → 'pending' without warning
    return { status: DEFAULT_APPOINTMENT_STATUS, warning: null };
  }

  const mapped = APPOINTMENT_STATUS_MAP[turnoEstado];
  if (mapped) {
    return { status: mapped, warning: null };
  }

  // Unknown status value
  return {
    status: DEFAULT_APPOINTMENT_STATUS,
    warning: `Unknown appointment status: ${turnoEstado}`,
  };
}

/**
 * Create an AppointmentMigrator instance
 */
export function createAppointmentMigrator(): AppointmentMigrator {
  return {
    async migrate(
      rows: AppointmentRow[],
      context: AppointmentMigrationContext,
      patientMatcher: PatientMatcher,
      client: PostgresClient,
      logStore: MigrationLogStore,
    ): Promise<AppointmentMigrationResult> {
      const result: AppointmentMigrationResult = {
        migrated: 0,
        reused: 0,
        errors: [],
        warnings: [],
      };

      if (rows.length === 0) {
        return result;
      }

      // Process each appointment row within a transaction
      await client.withTransaction(async (tx: PoolClient) => {
        for (const row of rows) {
          try {
            const sourcePk = String(row.idTurno);

            // Check idempotence: is this appointment already migrated?
            // Requirement 9.2, 9.5
            const existingEntry = await logStore.findExisting(tx, 'inst_turnos', sourcePk);
            if (existingEntry && existingEntry.targetId) {
              // Already migrated, reuse
              result.reused++;
              continue;
            }

            // Calculate payload hash for idempotence
            const payloadHash = calculatePayloadHash(row);

            // Requirement 3.1: Map direct fields
            const reasonId = row.Turno_motivoid ?? null;
            const doctorId = row.Turno_doctor ?? null;
            const insuranceId = row.Turno_obrasocialid ?? null;

            // Requirement 3.1: Turno_fecha → date
            const date = parseDate(row.Turno_fecha);

            // Requirement 3.4: Turno_hora → schedule_id (with validation)
            let scheduleId: number | null = null;
            let scheduleWarning: string | null = null;

            if (row.Turno_hora !== null && row.Turno_hora !== undefined) {
              const hora = Number(row.Turno_hora);
              if (context.scheduleIds.has(hora)) {
                scheduleId = hora;
              } else {
                // Schedule ID not found in destination
                scheduleId = null;
                scheduleWarning = `Schedule ID ${hora} not found in destination`;
              }
            }

            // Requirement 3.3, 6.5: Resolve Turno_paciente via PatientMatcher (last_name_only mode)
            let patientId: number | string | null = null;
            let patientWarning: string | null = null;

            const turnoPatiente = extractNonEmpty(row.Turno_paciente) || '';

            if (turnoPatiente) {
              const matchResult = patientMatcher.match(
                { lastName: turnoPatiente },
                'last_name_only',
                context.patientPool,
              );

              if (matchResult.outcome === 'auto_linked') {
                patientId = matchResult.candidateId;
              } else if (matchResult.outcome === 'manual_review') {
                // Requirement 6.3: manual_review → patient_id = NULL + warning
                patientId = null;
                patientWarning = `Patient matching requires manual review: "${turnoPatiente}" - multiple candidates found`;
              } else {
                // no_match
                patientId = null;
                patientWarning = `No patient match found for: "${turnoPatiente}"`;
              }
            } else {
              // Requirement 6.6: Empty or whitespace-only input
              patientId = null;
              patientWarning = 'Patient reference is empty (Turno_paciente)';
            }

            // Requirement 3.5: Map Turno_estado → status
            const { status, warning: statusWarning } = resolveStatus(row.Turno_estado);

            // Collect warnings
            if (scheduleWarning) {
              result.warnings.push({
                sourceId: row.idTurno,
                warning: scheduleWarning,
              });
            }
            if (patientWarning) {
              result.warnings.push({
                sourceId: row.idTurno,
                warning: patientWarning,
              });
            }
            if (statusWarning) {
              result.warnings.push({
                sourceId: row.idTurno,
                warning: statusWarning,
              });
            }

            // INSERT into appointments table
            // Requirement 3.1-3.5
            const insertResult = await client.query<{ id: number }>(
              tx,
              `
                INSERT INTO appointments (patient_id, doctor_id, reason_id, insurance_id, date, schedule_id, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id
              `,
              [patientId, doctorId, reasonId, insuranceId, date, scheduleId, status],
            );

            const appointmentId = insertResult[0]?.id;
            if (!appointmentId) {
              throw new Error('Failed to retrieve inserted appointment ID');
            }

            // Register in migration log for idempotence
            // Requirement 9.2
            await logStore.record(tx, {
              sourceTable: 'inst_turnos',
              sourcePk,
              targetTable: 'appointments',
              targetId: appointmentId,
              status: 'migrated',
              payloadHash,
              migratedAt: new Date(),
            });

            result.migrated++;
          } catch (error) {
            result.errors.push({
              sourceId: row.idTurno,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      });

      return result;
    },
  };
}
