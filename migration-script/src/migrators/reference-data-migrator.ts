/**
 * Reference Data Migrator
 *
 * Handles migration of lookup/reference tables:
 * - inst_doctor → doctors
 * - inst_obrasoc → health_insurances
 * - inst_motivo → visit_reasons
 * - inst_horarios → schedules (verification only, no insert)
 *
 * Covers Requirements 1.1 - 1.6
 */

import { PoolClient } from 'pg';
import { PostgresClient } from '../db/client';
import { MigrationLogStore } from '../db/migration-log';
import { normalizeText } from '../utils/normalize';

/**
 * Raw row types from dump
 */
export type DoctorRow = {
  Profesional_id: number;
  Profesional: string;
};

export type HealthInsuranceRow = {
  id: number;
  nombre: string;
};

export type VisitReasonRow = {
  id: number;
  nombre: string;
};

export type ScheduleRow = {
  Horarios_id: number;
  Horarios_estado: number; // must be in {0, 1, 2}
  [key: string]: any;
};

/**
 * Result of migration operation
 */
export type MigrationResult = {
  /** Number of new records inserted */
  inserted: number;
  /** Number of records reused (already existed) */
  reused: number;
  /** Errors encountered (prevents single row from being counted as success) */
  errors: Array<{ sourceId: any; error: string }>;
  /** Warnings (row processed but with some issue) */
  warnings: Array<{ sourceId: any; warning: string }>;
};

export type ReferenceDataMigrator = {
  migrateDoctors(
    doctorRows: DoctorRow[],
    client: PostgresClient,
    logStore: MigrationLogStore,
  ): Promise<MigrationResult>;

  migrateHealthInsurances(
    rows: HealthInsuranceRow[],
    client: PostgresClient,
    logStore: MigrationLogStore,
  ): Promise<MigrationResult>;

  migrateVisitReasons(
    rows: VisitReasonRow[],
    client: PostgresClient,
    logStore: MigrationLogStore,
  ): Promise<MigrationResult>;

  verifySchedules(
    scheduleRows: ScheduleRow[],
    client: PostgresClient,
  ): Promise<MigrationResult>;
};

/**
 * Generic migration algorithm for reference data tables.
 *
 * For each row:
 * 1. Normalize the name with normalizeText()
 * 2. Search destination for exact match (normalized)
 * 3. If found: log as 'migrated', reuse target_id, don't insert
 * 4. If not found: INSERT with explicit id preservation, then setval
 *
 * Requirement 1.1 - 1.6
 */
async function migrateReferenceTable(
  sourceTable: string,
  targetTable: string,
  rows: Array<{ id: number; nombre: string } | { Profesional_id: number; Profesional: string }>,
  client: PostgresClient,
  logStore: MigrationLogStore,
): Promise<MigrationResult> {
  const result: MigrationResult = {
    inserted: 0,
    reused: 0,
    errors: [],
    warnings: [],
  };

  if (rows.length === 0) {
    return result;
  }

  // Determine field names based on source table
  const isDoctor = sourceTable === 'inst_doctor';
  const idField = isDoctor ? 'Profesional_id' : 'id';
  const nameField = isDoctor ? 'Profesional' : 'nombre';

  await client.withTransaction(async (tx: PoolClient) => {
    // Process each row
    for (const row of rows) {
      try {
        const sourceId = (row as any)[idField];
        const sourceName = (row as any)[nameField];

        if (!sourceName) {
          result.warnings.push({
            sourceId,
            warning: `Empty name field`,
          });
          continue;
        }

        // Normalize the name
        const normalizedName = normalizeText(sourceName);

        // Fetch all existing names from destination and compare locally
        // This is more reliable than complex SQL normalization
        const existingRows = await client.query<{ id: number; name: string }>(
          tx,
          `SELECT id, name FROM ${targetTable}`,
        );

        let foundExisting: { id: number } | null = null;
        for (const existingRow of existingRows) {
          const existingNormalized = normalizeText(existingRow.name);
          if (existingNormalized === normalizedName) {
            foundExisting = { id: existingRow.id };
            break;
          }
        }

        if (foundExisting) {
          // Reuse existing
          await logStore.record(tx, {
            sourceTable,
            sourcePk: String(sourceId),
            targetTable,
            targetId: foundExisting.id,
            status: 'migrated',
            payloadHash: normalizedName,
            migratedAt: new Date(),
          });
          result.reused++;
        } else {
          // Insert with explicit id
          await client.query(
            tx,
            `INSERT INTO ${targetTable} (id, name) VALUES ($1, $2)`,
            [sourceId, sourceName],
          );

          await logStore.record(tx, {
            sourceTable,
            sourcePk: String(sourceId),
            targetTable,
            targetId: sourceId,
            status: 'migrated',
            payloadHash: normalizedName,
            migratedAt: new Date(),
          });
          result.inserted++;
        }
      } catch (error) {
        const sourceId = (row as any)[idField];
        result.errors.push({
          sourceId,
          error: String(error),
        });
      }
    }

    // After all inserts, adjust the sequence for the table
    // to prevent future auto-increment collisions
    try {
      const maxIdRows = await client.query<{ max_id: number }>(
        tx,
        `SELECT COALESCE(MAX(id), 0) as max_id FROM ${targetTable}`,
      );
      const maxId = maxIdRows[0]?.max_id ?? 0;
      await client.query(tx, `SELECT setval('${targetTable}_id_seq', $1)`, [maxId + 1]);
    } catch (error) {
      // Sequence might not exist; continue without error
    }
  });

  return result;
}

/**
 * Verify schedules exist in destination.
 *
 * Requirement 1.4, 1.5: Check Horarios_id exists in schedules,
 * validate Horarios_estado ∈ {0, 1, 2}
 */
async function verifySchedulesImpl(
  scheduleRows: ScheduleRow[],
  client: PostgresClient,
): Promise<MigrationResult> {
  const result: MigrationResult = {
    inserted: 0,
    reused: 0,
    errors: [],
    warnings: [],
  };

  if (scheduleRows.length === 0) {
    return result;
  }

  await client.withTransaction(async (tx: PoolClient) => {
    for (const row of scheduleRows) {
      const scheduleId = row.Horarios_id;
      const status = row.Horarios_estado;

      // Validate Horarios_estado ∈ {0, 1, 2}
      if (![0, 1, 2].includes(status)) {
        result.warnings.push({
          sourceId: scheduleId,
          warning: `Invalid Horarios_estado value: ${status}. Must be 0, 1, or 2.`,
        });
        continue;
      }

      // Check if schedule exists
      const existing = await client.query<{ id: number }>(
        tx,
        `SELECT id FROM schedules WHERE id = $1`,
        [scheduleId],
      );

      if (existing.length === 0) {
        result.warnings.push({
          sourceId: scheduleId,
          warning: `Schedule ID ${scheduleId} not found in destination`,
        });
      } else {
        // Schedule verified successfully
        result.reused++;
      }
    }
  });

  return result;
}

/**
 * Create a ReferenceDataMigrator instance
 */
export function createReferenceDataMigrator(): ReferenceDataMigrator {
  return {
    async migrateDoctors(
      doctorRows: DoctorRow[],
      client: PostgresClient,
      logStore: MigrationLogStore,
    ): Promise<MigrationResult> {
      return migrateReferenceTable(
        'inst_doctor',
        'doctors',
        doctorRows,
        client,
        logStore,
      );
    },

    async migrateHealthInsurances(
      rows: HealthInsuranceRow[],
      client: PostgresClient,
      logStore: MigrationLogStore,
    ): Promise<MigrationResult> {
      return migrateReferenceTable(
        'inst_obrasoc',
        'health_insurances',
        rows,
        client,
        logStore,
      );
    },

    async migrateVisitReasons(
      rows: VisitReasonRow[],
      client: PostgresClient,
      logStore: MigrationLogStore,
    ): Promise<MigrationResult> {
      return migrateReferenceTable(
        'inst_motivo',
        'visit_reasons',
        rows,
        client,
        logStore,
      );
    },

    async verifySchedules(
      scheduleRows: ScheduleRow[],
      client: PostgresClient,
    ): Promise<MigrationResult> {
      return verifySchedulesImpl(scheduleRows, client);
    },
  };
}
