/**
 * Patient Migrator
 *
 * Handles migration of fichas (patient records) to patients table.
 * Covers Requirements 2.1 - 2.7, 9.1, 9.2, 9.4, 9.5
 *
 * Key features:
 * - Maps fichas fields to patients according to sdd.md section 4
 * - Excludes: fuente, lugarTrabajo, tipoTrabajo, trabajoConyuge, tipoTrabajoConyuge
 * - Resolves doctor_id: '0' → NULL, numeric → lookup in doctorIdMap
 * - Converts sentinel dates ('0000-00-00') to NULL
 * - Retains valorConsulta in memory for ClinicalRecordMigrator
 * - Supports idempotent re-execution via MigrationLogStore
 */

import { PoolClient } from 'pg';
import { PostgresClient, calculatePayloadHash } from '../db/client';
import { MigrationLogStore } from '../db/migration-log';
import { normalizeText } from '../utils/normalize';

/**
 * Raw patient row from fichas table dump
 */
export type PatientRow = {
  idFicha: number;
  tipoDoc?: string;
  documento?: string;
  apellido: string;
  nombre: string;
  domicilio?: string;
  departamento?: string;
  provincia?: string;
  fechaNac?: string; // 'YYYY-MM-DD' or '0000-00-00' (sentinel)
  sexo?: string; // 'M', 'F', or other → map to gender ENUM
  obraSocial?: string;
  nroObraSocial?: string;
  telefono?: string;
  telefonoTrabajo?: string;
  eMail?: string;
  codPostal?: string;
  estadoCivil?: string;
  profesional?: string; // doctor_id legacy; '0' = NULL
  primerConsulta?: string; // DATE
  ultimaConsulta?: string; // DATE
  diagnostico?: string;
  valorConsulta?: string;
  // Excluded fields (ignored completely):
  // fuente, lugarTrabajo, tipoTrabajo, trabajoConyuge, tipoTrabajoConyuge
};

/**
 * Result of patient migration
 */
export type PatientMigrationResult = {
  /** Number of new patients inserted */
  migrated: number;
  /** Number of patients reused (already existed) */
  reused: number;
  /** Errors encountered (prevents row from being counted) */
  errors: Array<{ sourceId: any; error: string }>;
  /** Warnings (row processed but with some issue) */
  warnings: Array<{ sourceId: any; warning: string }>;
  /** Mapping from legacy idFicha to destination patient.id */
  legacyIdToPatientId: Map<number, number>;
  /** Mapping from legacy idFicha to valorConsulta (retained for ClinicalRecordMigrator) */
  visitFeeByLegacyPatientId: Map<number, string>;
};

export type PatientMigrator = {
  migrate(
    rows: PatientRow[],
    doctorIdMap: Map<number, number>,
    client: PostgresClient,
    logStore: MigrationLogStore,
  ): Promise<PatientMigrationResult>;
};

/**
 * Convert sentinel date ('0000-00-00') to null, or return the date as-is if valid
 */
function normalizeDateField(dateStr?: string): string | null {
  if (!dateStr || dateStr === '' || dateStr === '0000-00-00') {
    return null;
  }
  return dateStr;
}

/**
 * Convert gender: 'M' → 'male', 'F' → 'female', others → null
 */
function normalizeGender(sexo?: string): string | null {
  if (!sexo) {
    return null;
  }

  const upper = sexo.toUpperCase().trim();
  if (upper === 'M') {
    return 'male';
  }
  if (upper === 'F') {
    return 'female';
  }

  // Invalid gender values become NULL
  return null;
}

/**
 * Validate and normalize marital status.
 * Valid values: single, married, divorced, widowed, separated, common_law, other
 */
function normalizeMaritalStatus(estadoCivil?: string): {
  value: string | null;
  warning?: string;
} {
  if (!estadoCivil) {
    return { value: null };
  }

  const validValues = ['single', 'married', 'divorced', 'widowed', 'separated', 'common_law', 'other'];

  // Try direct match
  if (validValues.includes(estadoCivil)) {
    return { value: estadoCivil };
  }

  // Try case-insensitive match
  const lower = estadoCivil.toLowerCase().trim();
  if (validValues.includes(lower)) {
    return { value: lower };
  }

  // Invalid value → NULL with warning
  return {
    value: null,
    warning: `Invalid marital_status value: "${estadoCivil}". Allowed: ${validValues.join(', ')}`,
  };
}

/**
 * Resolve doctor_id from legacy profesional field
 * - '0' → null
 * - numeric that exists in doctorIdMap → mapped value
 * - numeric that doesn't exist → null + warning
 * - non-numeric → null + warning
 */
function resolveDoctorId(
  profesional?: string,
  doctorIdMap?: Map<number, number>,
): { value: number | null; warning?: string } {
  if (!profesional || profesional === '' || profesional === '0') {
    return { value: null };
  }

  // Try to parse as number
  const parsedId = parseInt(profesional, 10);
  if (isNaN(parsedId)) {
    return {
      value: null,
      warning: `profesional is not numeric: "${profesional}"`,
    };
  }

  // Look up in doctorIdMap
  if (doctorIdMap && doctorIdMap.has(parsedId)) {
    return { value: doctorIdMap.get(parsedId) || null };
  }

  // Not found in map
  return {
    value: null,
    warning: `doctor_id ${parsedId} not found in doctorIdMap`,
  };
}

/**
 * Select phone: prioritize particular > trabajo
 */
function selectPhone(telefonoParticular?: string, telefonoTrabajo?: string): string | null {
  const particular = telefonoParticular?.trim() || '';
  const trabajo = telefonoTrabajo?.trim() || '';

  if (particular && particular !== '0') {
    return particular;
  }
  if (trabajo && trabajo !== '0') {
    return trabajo;
  }

  return null;
}

/**
 * Create a PatientMigrator instance
 */
export function createPatientMigrator(): PatientMigrator {
  return {
    async migrate(
      rows: PatientRow[],
      doctorIdMap: Map<number, number>,
      client: PostgresClient,
      logStore: MigrationLogStore,
    ): Promise<PatientMigrationResult> {
      const result: PatientMigrationResult = {
        migrated: 0,
        reused: 0,
        errors: [],
        warnings: [],
        legacyIdToPatientId: new Map(),
        visitFeeByLegacyPatientId: new Map(),
      };

      if (rows.length === 0) {
        return result;
      }

      await client.withTransaction(async (tx: PoolClient) => {
        for (const row of rows) {
          try {
            const sourcePk = String(row.idFicha);

            // Step 1: Check for idempotence
            const existing = await logStore.findExisting(tx, 'fichas', sourcePk);
            if (existing) {
              // Reuse existing patient
              result.reused++;
              const targetId = existing.targetId ? Number(existing.targetId) : null;
              if (targetId) {
                result.legacyIdToPatientId.set(row.idFicha, targetId);
              }
              // Retain valorConsulta even on reuse
              if (row.valorConsulta) {
                result.visitFeeByLegacyPatientId.set(row.idFicha, row.valorConsulta);
              }
              continue;
            }

            // Step 2: Validate required fields
            if (!row.apellido?.trim() && !row.nombre?.trim()) {
              throw new Error('Both apellido and nombre are empty');
            }

            // Step 3: Transform fields
            const lastNameValue = row.apellido?.trim() || '';
            const firstNameValue = row.nombre?.trim() || '';
            const docTypeValue = row.tipoDoc?.trim() || null;
            const docNumberValue = row.documento?.trim() || null;
            const addressValue = row.domicilio?.trim() || null;
            const districtValue = row.departamento?.trim() || null;
            const provinceValue = row.provincia?.trim() || null;
            const birthDateValue = normalizeDateField(row.fechaNac);
            const genderValue = normalizeGender(row.sexo);
            const insuranceNumberValue = row.nroObraSocial?.trim() || null;
            const phoneValue = selectPhone(row.telefono, row.telefonoTrabajo);
            const emailValue = row.eMail?.trim() || null;
            const postalCodeValue = row.codPostal?.trim() || null;

            const maritalStatusResult = normalizeMaritalStatus(row.estadoCivil);
            const maritalStatusValue = maritalStatusResult.value;
            if (maritalStatusResult.warning) {
              result.warnings.push({
                sourceId: row.idFicha,
                warning: maritalStatusResult.warning,
              });
            }

            const doctorIdResult = resolveDoctorId(row.profesional, doctorIdMap);
            const doctorIdValue = doctorIdResult.value;
            if (doctorIdResult.warning) {
              result.warnings.push({
                sourceId: row.idFicha,
                warning: doctorIdResult.warning,
              });
            }

            const firstVisitDateValue = normalizeDateField(row.primerConsulta);
            const lastVisitDateValue = normalizeDateField(row.ultimaConsulta);
            const diagnosisValue = row.diagnostico?.trim() || null;

            // Step 4: Build INSERT values array
            const insertValues: unknown[] = [
              docTypeValue,
              docNumberValue,
              lastNameValue,
              firstNameValue,
              addressValue,
              districtValue,
              provinceValue,
              birthDateValue,
              genderValue,
              null, // insurance_id (not used; obraSocial is text)
              insuranceNumberValue,
              phoneValue,
              emailValue,
              postalCodeValue,
              maritalStatusValue,
              doctorIdValue,
              firstVisitDateValue,
              lastVisitDateValue,
              diagnosisValue,
            ];

            const columns = [
              'doc_type',
              'doc_number',
              'last_name',
              'first_name',
              'address',
              'district',
              'province',
              'birth_date',
              'gender',
              'insurance_id',
              'insurance_number',
              'phone',
              'email',
              'postal_code',
              'marital_status',
              'doctor_id',
              'first_visit_date',
              'last_visit_date',
              'diagnosis',
            ];

            // Step 5: INSERT
            const insertResult = await client.query<{ id: number }>(
              tx,
              `INSERT INTO patients (${columns.join(', ')}) VALUES (${columns
                .map((_, i) => `$${i + 1}`)
                .join(', ')}) RETURNING id`,
              insertValues,
            );

            const insertedId = insertResult[0]?.id;
            if (!insertedId) {
              throw new Error('INSERT did not return id');
            }

            // Step 6: Record in migration log
            const payloadHash = calculatePayloadHash(row);
            await logStore.record(tx, {
              sourceTable: 'fichas',
              sourcePk,
              targetTable: 'patients',
              targetId: insertedId,
              status: 'migrated',
              payloadHash,
              migratedAt: new Date(),
            });

            // Step 7: Update result
            result.migrated++;
            result.legacyIdToPatientId.set(row.idFicha, insertedId);

            // Step 8: Retain valorConsulta for ClinicalRecordMigrator
            if (row.valorConsulta) {
              result.visitFeeByLegacyPatientId.set(row.idFicha, row.valorConsulta);
            }
          } catch (error) {
            result.errors.push({
              sourceId: row.idFicha,
              error: String(error),
            });
          }
        }
      });

      return result;
    },
  };
}
