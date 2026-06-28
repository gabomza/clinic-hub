/**
 * Surgery Migrator
 *
 * Handles migration of cirugias (surgery records) to surgeries table
 * and population of related lookup tables: surgery_diagnoses, body_parts, surgery_techniques.
 *
 * Covers Requirements 5.1 - 5.3 (population of lookups) and 5.4 - 5.8 (migration of surgery rows).
 *
 * Key features:
 * - Extracts distinct values from diagnostico, miembro, tecnica1/2/3
 * - Uses normalizeText() for deduplication and duplicate detection
 * - Transactional population of lookups
 * - Resolves foreign keys for lookup tables
 * - Handles empty values without creating lookup entries
 * - Supports idempotent re-execution via MigrationLogStore
 */

import { PoolClient } from 'pg';
import { PostgresClient, calculatePayloadHash } from '../db/client';
import { MigrationLogStore } from '../db/migration-log';
import { normalizeText } from '../utils/normalize';
import { PatientMatcher, PatientCandidate } from '../matcher/patient-matcher';

/**
 * Raw surgery row from cirugias table dump
 */
export type SurgeryRow = {
  id_cirugia: number;
  apellido?: string | null;
  nombre?: string | null;
  edad?: number | null;
  domicilio?: string | null;
  fecha?: string | null;
  diagnostico?: string | null;
  miembro?: string | null;
  tecnica1?: string | null;
  tecnica2?: string | null;
  tecnica3?: string | null;
  evolucion?: string | null;
  [key: string]: any;
};

/**
 * Maps normalized lookup values to their destination IDs
 */
export type LookupIdMaps = {
  diagnoses: Map<string, number>; // normalized_diagnosis → surgery_diagnoses.id
  bodyParts: Map<string, number>; // normalized_body_part → body_parts.id
  techniques: Map<string, number>; // normalized_technique → surgery_techniques.id
};

/**
 * Result of populateLookups operation
 */
export type PopulateLookupResult = {
  inserted: number; // Total new entries inserted
  reused: number; // Total entries reused (already existed)
  errors: Array<{ value: string; table: string; error: string }>;
  lookupIdMaps: LookupIdMaps; // For use in surgery row migration (Task 10)
};

/**
 * Result of surgery row migration (Task 10)
 */
export type SurgeryMigrationResult = {
  migrated: number; // Total surgeries successfully inserted
  errors: Array<{ sourceId: number; error: string }>;
  warnings: Array<{ sourceId: number; warning: string }>;
};

export type SurgeryMigrator = {
  /**
   * Populates lookup tables (surgery_diagnoses, body_parts, surgery_techniques)
   * with distinct values extracted from surgery rows.
   *
   * Algorithm (Requirements 5.1-5.3):
   * 1. Extract distinct non-empty values from diagnostico → diagnoses
   * 2. Extract distinct non-empty values from miembro → bodyParts
   * 3. Extract distinct non-empty values from tecnica1/2/3 → techniques
   * 4. For each value:
   *    a. Normalize with normalizeText()
   *    b. Check if already exists in destination (normalized comparison)
   *    c. If exists: add to map with existing_id, increment reused
   *    d. If not exists: INSERT and add to map with new_id, increment inserted
   * 5. Return LookupIdMaps for use in migrate() step
   *
   * Requirement 5.1: Populate surgery_diagnoses with distinct diagnostico values
   * Requirement 5.2: Populate body_parts with distinct miembro values
   * Requirement 5.3: Populate surgery_techniques with distinct tecnica1/2/3 values
   */
  populateLookups(
    rows: SurgeryRow[],
    client: PostgresClient,
    logStore: MigrationLogStore,
  ): Promise<PopulateLookupResult>;

  /**
   * Migrates surgery rows from cirugias table to surgeries + surgery_applied_techniques.
   *
   * Algorithm (Requirements 5.4-5.8, 6.7):
   * 1. For each row:
   *    a. Get source_pk = id_cirugia.toString()
   *    b. Check migration_log for already-migrated row (idempotence)
   *    c. If found: reuse target_id, continue
   *    d. If not found: process row
   *
   * 2. For each new row:
   *    a. Resolve patient via PatientMatcher.match() (full_name mode)
   *       - If auto_linked: use candidateId
   *       - If manual_review or no_match: patient_id = NULL, record warning
   *    b. Map fields:
   *       - fecha → date (validate YYYY-MM-DD format; 0000-00-00 → NULL)
   *       - evolucion → outcome
   *       - diagnostico → diagnosis_id (normalized lookup; NULL if empty or not found)
   *       - miembro → body_part_id (normalized lookup; NULL if empty or not found)
   *    c. INSERT surgeries row
   *    d. For each non-empty technique (tecnica1/2/3):
   *       - Resolve technique_id via normalized lookup
   *       - INSERT surgery_applied_techniques with order_index 1/2/3
   *    e. Record in migration_log
   *
   * 3. Handle errors:
   *    - Collect errors, don't stop processing
   *    - Collect warnings for non-critical issues (missing lookup, manual_review)
   *    - Return summary with migrated count, errors, and warnings
   *
   * Requirements 5.4-5.8, 6.7
   */
  migrate(
    rows: SurgeryRow[],
    lookups: LookupIdMaps,
    patientPool: PatientCandidate[],
    patientMatcher: PatientMatcher,
    client: PostgresClient,
    logStore: MigrationLogStore,
  ): Promise<SurgeryMigrationResult>;
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
 * Requirement 5.4: fecha should be YYYY-MM-DD or '0000-00-00' (sentinel)
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
 * Create a SurgeryMigrator instance
 */
export function createSurgeryMigrator(): SurgeryMigrator {
  return {
    async populateLookups(
      rows: SurgeryRow[],
      client: PostgresClient,
      logStore: MigrationLogStore,
    ): Promise<PopulateLookupResult> {
      const result: PopulateLookupResult = {
        inserted: 0,
        reused: 0,
        errors: [],
        lookupIdMaps: {
          diagnoses: new Map(),
          bodyParts: new Map(),
          techniques: new Map(),
        },
      };

      if (rows.length === 0) {
        return result;
      }

      // Collect distinct non-empty values from all rows
      const diagnoses = new Set<string>();
      const bodyParts = new Set<string>();
      const techniques = new Set<string>();

      for (const row of rows) {
        // Extract diagnostico values
        const diagnostico = extractNonEmpty(row.diagnostico);
        if (diagnostico) {
          diagnoses.add(diagnostico);
        }

        // Extract miembro values
        const miembro = extractNonEmpty(row.miembro);
        if (miembro) {
          bodyParts.add(miembro);
        }

        // Extract tecnica1, tecnica2, tecnica3 values
        const tecnica1 = extractNonEmpty(row.tecnica1);
        if (tecnica1) {
          techniques.add(tecnica1);
        }

        const tecnica2 = extractNonEmpty(row.tecnica2);
        if (tecnica2) {
          techniques.add(tecnica2);
        }

        const tecnica3 = extractNonEmpty(row.tecnica3);
        if (tecnica3) {
          techniques.add(tecnica3);
        }
      }

      // Process lookup tables within a transaction
      await client.withTransaction(async (tx: PoolClient) => {
        // Process diagnoses
        await populateLookupTable(
          tx,
          client,
          logStore,
          'surgery_diagnoses',
          Array.from(diagnoses),
          result.lookupIdMaps.diagnoses,
          result,
        );

        // Process body_parts
        await populateLookupTable(
          tx,
          client,
          logStore,
          'body_parts',
          Array.from(bodyParts),
          result.lookupIdMaps.bodyParts,
          result,
        );

        // Process surgery_techniques
        await populateLookupTable(
          tx,
          client,
          logStore,
          'surgery_techniques',
          Array.from(techniques),
          result.lookupIdMaps.techniques,
          result,
        );
      });

      return result;
    },

    async migrate(
      rows: SurgeryRow[],
      lookups: LookupIdMaps,
      patientPool: PatientCandidate[],
      patientMatcher: PatientMatcher,
      client: PostgresClient,
      logStore: MigrationLogStore,
    ): Promise<SurgeryMigrationResult> {
      const result: SurgeryMigrationResult = {
        migrated: 0,
        errors: [],
        warnings: [],
      };

      if (rows.length === 0) {
        return result;
      }

      // Process each surgery row within a transaction
      await client.withTransaction(async (tx: PoolClient) => {
        for (const row of rows) {
          try {
            const sourcePk = String(row.id_cirugia);

            // Check idempotence: is this surgery already migrated?
            const existingEntry = await logStore.findExisting(tx, 'cirugias', sourcePk);
            if (existingEntry && existingEntry.targetId) {
              // Already migrated, skip
              continue;
            }

            // Resolve patient via PatientMatcher
            // Requirement 5.7, 6.7: Use full_name mode with apellido and nombre
            const apellido = extractNonEmpty(row.apellido) || '';
            const nombre = extractNonEmpty(row.nombre) || '';

            let patientId: number | string | null = null;

            if (apellido || nombre) {
              const matchResult = patientMatcher.match(
                { lastName: apellido, firstName: nombre },
                'full_name',
                patientPool,
              );

              if (matchResult.outcome === 'auto_linked') {
                patientId = matchResult.candidateId;
              } else if (matchResult.outcome === 'manual_review') {
                // Requirement 6.3: manual_review → patient_id = NULL + warning
                patientId = null;
                result.warnings.push({
                  sourceId: row.id_cirugia,
                  warning: `Patient matching requires manual review: "${apellido} ${nombre}" - multiple candidates found`,
                });
              } else {
                // no_match
                patientId = null;
                result.warnings.push({
                  sourceId: row.id_cirugia,
                  warning: `No patient match found for: "${apellido} ${nombre}"`,
                });
              }
            } else {
              // No patient data provided
              patientId = null;
              result.warnings.push({
                sourceId: row.id_cirugia,
                warning: 'Patient reference is empty (no apellido or nombre)',
              });
            }

            // Requirement 5.4: Map fecha → date
            const dateStr = parseDate(row.fecha);

            // Requirement 5.4: Map evolucion → outcome
            const outcome = extractNonEmpty(row.evolucion) || null;

            // Requirement 5.4: Map diagnostico → diagnosis_id (normalized lookup)
            let diagnosisId: number | null = null;
            const diagnosticoStr = extractNonEmpty(row.diagnostico);
            if (diagnosticoStr) {
              const normalizedDiagnosis = normalizeText(diagnosticoStr);
              diagnosisId = lookups.diagnoses.get(normalizedDiagnosis) || null;
              if (!diagnosisId) {
                result.warnings.push({
                  sourceId: row.id_cirugia,
                  warning: `Diagnosis lookup failed for "${diagnosticoStr}" - no entry in surgery_diagnoses`,
                });
              }
            }

            // Requirement 5.4: Map miembro → body_part_id (normalized lookup)
            let bodyPartId: number | null = null;
            const miembroStr = extractNonEmpty(row.miembro);
            if (miembroStr) {
              const normalizedBodyPart = normalizeText(miembroStr);
              bodyPartId = lookups.bodyParts.get(normalizedBodyPart) || null;
              if (!bodyPartId) {
                result.warnings.push({
                  sourceId: row.id_cirugia,
                  warning: `Body part lookup failed for "${miembroStr}" - no entry in body_parts`,
                });
              }
            }

            // Requirement 5.5: empty diagnostico/miembro → NULL without creating entry
            // (already handled above: if empty, we don't create entries)

            // INSERT into surgeries table
            const insertSurgerySql = `
              INSERT INTO surgeries (patient_id, date, diagnosis_id, body_part_id, outcome)
              VALUES ($1, $2, $3, $4, $5)
              RETURNING id
            `;

            const surgeryResult = await client.query<{ id: number }>(
              tx,
              insertSurgerySql,
              [patientId, dateStr, diagnosisId, bodyPartId, outcome],
            );

            if (surgeryResult.length === 0) {
              throw new Error('INSERT into surgeries returned no rows');
            }

            const surgeryId = surgeryResult[0].id;

            // Requirement 5.6: Insert surgery_applied_techniques for each non-empty technique
            const techniques = [
              { value: row.tecnica1, orderIndex: 1 },
              { value: row.tecnica2, orderIndex: 2 },
              { value: row.tecnica3, orderIndex: 3 },
            ];

            for (const { value, orderIndex } of techniques) {
              const techniqueStr = extractNonEmpty(value);
              if (!techniqueStr) {
                continue; // Skip empty techniques
              }

              const normalizedTechnique = normalizeText(techniqueStr);
              const techniqueId = lookups.techniques.get(normalizedTechnique);

              if (!techniqueId) {
                result.warnings.push({
                  sourceId: row.id_cirugia,
                  warning: `Technique lookup failed for "${techniqueStr}" (order ${orderIndex}) - no entry in surgery_techniques`,
                });
                continue; // Skip this technique
              }

              // INSERT into surgery_applied_techniques
              const insertTechniqueSql = `
                INSERT INTO surgery_applied_techniques (surgery_id, technique_id, order_index)
                VALUES ($1, $2, $3)
              `;

              await client.query(tx, insertTechniqueSql, [surgeryId, techniqueId, orderIndex]);
            }

            // Record in migration_log
            const payloadHash = calculatePayloadHash(row);
            await logStore.record(tx, {
              sourceTable: 'cirugias',
              sourcePk: sourcePk,
              targetTable: 'surgeries',
              targetId: surgeryId,
              status: 'migrated',
              payloadHash,
              migratedAt: new Date(),
            });

            result.migrated++;
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            result.errors.push({
              sourceId: row.id_cirugia,
              error: errorMessage,
            });
            // Continue with next row (fail-soft)
          }
        }
      });

      return result;
    },
  };
}

/**
 * Generic helper to populate a lookup table.
 *
 * For each value:
 * 1. Normalize with normalizeText()
 * 2. Check if already in idMap (deduplication within this batch)
 * 3. If in map: skip (already processed)
 * 4. Query destination table for exact match (normalized)
 * 5. If found: add to map with existing_id, increment reused
 * 6. If not found: INSERT new row, add to map with new_id, increment inserted
 * 7. On error: add to errors array, continue processing
 *
 * Implementation of Requirements 5.1-5.3
 */
async function populateLookupTable(
  tx: PoolClient,
  client: PostgresClient,
  logStore: MigrationLogStore,
  table: string,
  values: string[],
  idMap: Map<string, number>,
  result: PopulateLookupResult,
): Promise<void> {
  // Determine the name column based on table
  const nameColumn =
    table === 'surgery_diagnoses' ? 'diagnosis' :
    table === 'body_parts' ? 'body_part' :
    table === 'surgery_techniques' ? 'technique' :
    'name';

  for (const value of values) {
    try {
      const normalizedValue = normalizeText(value);

      // Check if already processed in this batch (deduplication)
      if (idMap.has(normalizedValue)) {
        result.reused++;
        continue;
      }

      // Query existing entries in the destination table
      const existing = await client.query<{ id: number; [key: string]: any }>(
        tx,
        `SELECT id, ${nameColumn} FROM ${table}`,
      );

      // Find if normalized value already exists
      let foundExisting: { id: number } | null = null;
      for (const row of existing) {
        const existingNormalized = normalizeText(row[nameColumn] as string);
        if (existingNormalized === normalizedValue) {
          foundExisting = { id: row.id };
          break;
        }
      }

      if (foundExisting) {
        // Reuse existing entry
        idMap.set(normalizedValue, foundExisting.id);
        result.reused++;
      } else {
        // Insert new entry
        const insertQuery = `INSERT INTO ${table} (${nameColumn}) VALUES ($1) RETURNING id`;
        const insertResult = await client.query<{ id: number }>(tx, insertQuery, [
          value,
        ]);

        if (insertResult.length > 0) {
          const newId = insertResult[0].id;
          idMap.set(normalizedValue, newId);
          result.inserted++;
        } else {
          // Unexpected: INSERT returned no rows
          result.errors.push({
            value,
            table,
            error: 'INSERT succeeded but returned no rows',
          });
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push({
        value,
        table,
        error: errorMessage,
      });
    }
  }
}
