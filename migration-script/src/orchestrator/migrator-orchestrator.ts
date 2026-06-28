/**
 * Migration Orchestrator
 *
 * Coordinates the complete data migration process across all modules in the correct order.
 * Implements Requirements 5.1-5.3, 9.4, 10.1, 10.6, 11.1, 11.2.
 *
 * Orchestration order (dependencies):
 * 1. Ensure schema of migration_log table
 * 2. Apply reset if configured (log-only or full)
 * 3. Register excluded tables (inst_alt, medias, ventamedias) as intentionally out of scope
 * 4. Migrate reference data (doctors, insurances, visit reasons, verify schedules)
 * 5. Migrate patients (fichas → patients)
 * 6. Populate surgery lookups (diagnoses, body parts, techniques)
 * 7. Build patient pool from all migrated patients
 * 8. Migrate appointments (inst_turnos → appointments) with patient matching
 * 9. Migrate surgeries (cirugias → surgeries) with patient matching
 * 10. Migrate clinical records (historiaclinica → clinical_records)
 * 11. Migrate cash entries (caja → cash_entries)
 * 12. Detect possible duplicate patients in destination
 * 13. Build and write reports
 *
 * Error handling strategy:
 * - Fail-fast on configuration/parsing errors (before touching DB)
 * - Fail-soft on individual row errors (continue migration, report issues)
 * - Transaction-scoped by table: if a batch fails, rollback that batch and retry row-by-row
 * - Unknown tables in dump: warning, no abort
 */

import { PoolClient } from 'pg';
import type { MigrationConfig } from '../config/index';
import type { DumpParseResult, RawRow } from '../parser/dump';
import { parseDump } from '../parser/dump';
import { createPostgresClient, PostgresClient } from '../db/client';
import {
  createMigrationLogStore,
  MigrationLogStore,
} from '../db/migration-log';
import { createReferenceDataMigrator } from '../migrators/reference-data-migrator';
import { createPatientMigrator } from '../migrators/patient-migrator';
import { createSurgeryMigrator } from '../migrators/surgery-migrator';
import { createAppointmentMigrator } from '../migrators/appointment-migrator';
import { createClinicalRecordMigrator } from '../migrators/clinical-record-migrator';
import { createCashEntryMigrator } from '../migrators/cash-entry-migrator';
import { createPatientMatcher } from '../matcher/patient-matcher';
import type { PatientMatcherConfig } from '../matcher/patient-matcher';
import { createReportBuilder, MigrationReport } from '../report/report-builder';

/**
 * Detailed result of orchestrator execution
 */
export type MigrationOrchestrationResult = {
  success: boolean;
  report?: MigrationReport;
  reportPaths?: {
    jsonPath: string;
    mdPath: string;
  };
  error?: string;
  executionTimeMs?: number;
};

/**
 * Public interface for MigrationOrchestrator
 */
export type MigrationOrchestrator = {
  run(
    config: MigrationConfig,
  ): Promise<MigrationOrchestrationResult>;
};

/**
 * Create a migration orchestrator instance
 */
export function createMigrationOrchestrator(): MigrationOrchestrator {
  return {
    async run(config: MigrationConfig): Promise<MigrationOrchestrationResult> {
      const startTime = Date.now();
      let pgClient: PostgresClient | null = null;
      let logStore: MigrationLogStore | null = null;

      try {
        // Step 1: Validate configuration (fail-fast)
        if (!config.dumpFilePath || config.dumpFilePath.trim() === '') {
          throw new Error('Configuration error: dumpFilePath is required');
        }
        if (!config.databaseUrl || config.databaseUrl.trim() === '') {
          throw new Error('Configuration error: databaseUrl is required');
        }

        console.log('[ORCHESTRATOR] Starting migration process...');
        console.log(
          `[ORCHESTRATOR] Dump file: ${config.dumpFilePath}`,
        );
        console.log(
          `[ORCHESTRATOR] Reset mode: ${config.resetMode}`,
        );

        // Step 2: Parse dump (fail-fast on parse error)
        console.log('[ORCHESTRATOR] Parsing dump file...');
        const dumpResult = await parseDump(config.dumpFilePath);

        console.log(
          `[ORCHESTRATOR] Parsed ${dumpResult.tables.size} tables from dump`,
        );
        if (dumpResult.excludedTables.length > 0) {
          console.log(
            `[ORCHESTRATOR] Excluded tables (intentional): ${dumpResult.excludedTables.join(', ')}`,
          );
        }
        if (dumpResult.unknownTables.length > 0) {
          console.log(
            `[ORCHESTRATOR] WARNING: Unknown tables in dump (will be ignored): ${dumpResult.unknownTables.join(', ')}`,
          );
        }

        // Step 3: Connect to database
        console.log('[ORCHESTRATOR] Connecting to PostgreSQL...');
        pgClient = createPostgresClient({
          connectionString: config.databaseUrl,
        });
        logStore = createMigrationLogStore(pgClient);

        // Step 4: Ensure schema of migration_log
        console.log('[ORCHESTRATOR] Ensuring migration_log schema...');
        await pgClient.withTransaction(async (client) => {
          await logStore!.ensureSchema(client);
        });

        // Step 5: Apply reset if configured
        if (config.resetMode === 'full') {
          console.log('[ORCHESTRATOR] Applying full reset...');
          await pgClient.withTransaction(async (client) => {
            await logStore!.reset(client, 'full');
          });
        } else if (config.resetMode === 'log-only') {
          console.log('[ORCHESTRATOR] Applying log-only reset...');
          await pgClient.withTransaction(async (client) => {
            await logStore!.reset(client, 'log-only');
          });
        }

        // Create report builder to accumulate events
        const reportBuilder = createReportBuilder();

        // Register excluded tables in report
        for (const tableName of dumpResult.excludedTables) {
          reportBuilder.addExcludedTable(
            tableName,
            'Tabla sin equivalente en el nuevo esquema (Requirement 11.1)',
          );
        }

        // Register unknown tables as warnings in report
        for (const tableName of dumpResult.unknownTables) {
          reportBuilder.addExcludedTable(
            tableName,
            'Tabla no reconocida en el catálogo (se ignora con advertencia)',
          );
        }

        // Step 6: Migrate reference data (doctors, insurances, visit reasons, verify schedules)
        console.log('[ORCHESTRATOR] Migrating reference data...');
        const referenceDataMigrator = createReferenceDataMigrator();

        const doctorsTable = dumpResult.tables.get('inst_doctor');
        const doctorsResult = await pgClient.withTransaction(async (client) => {
          const doctors = (doctorsTable?.rows || []) as any[];
          return await referenceDataMigrator.migrateDoctors(doctors, pgClient!, logStore!);
        });

        const insurancesTable = dumpResult.tables.get('inst_obrasoc');
        const insurancesResult = await pgClient.withTransaction(
          async (client) => {
            const insurances = (insurancesTable?.rows || []) as any[];
            return await referenceDataMigrator.migrateHealthInsurances(
              insurances,
              pgClient!,
              logStore!,
            );
          },
        );

        const visitReasonsTable = dumpResult.tables.get('inst_motivo');
        const visitReasonsResult = await pgClient.withTransaction(
          async (client) => {
            const reasons = (visitReasonsTable?.rows || []) as any[];
            return await referenceDataMigrator.migrateVisitReasons(
              reasons,
              pgClient!,
              logStore!,
            );
          },
        );

        const schedulesTable = dumpResult.tables.get('inst_horarios');
        const schedulesResult = await pgClient.withTransaction(
          async (client) => {
            const schedules = (schedulesTable?.rows || []) as any[];
            return await referenceDataMigrator.verifySchedules(
              schedules,
              pgClient!,
            );
          },
        );

        // Collect schedule IDs for later validation
        const scheduleIds = new Set<number>();
        if (schedulesTable) {
          for (const row of schedulesTable.rows) {
            if (typeof row.Horarios_id === 'number') {
              scheduleIds.add(row.Horarios_id);
            }
          }
        }

        console.log(
          `[ORCHESTRATOR] Reference data migration complete (${doctorsResult.inserted + insurancesResult.inserted + visitReasonsResult.inserted} inserted)`,
        );

        // Step 7: Migrate patients
        console.log('[ORCHESTRATOR] Migrating patients...');
        const patientMigrator = createPatientMigrator();

        // Build doctor ID map for patient resolution
        const doctorIdMap = new Map<number, number>();
        if (doctorsTable) {
          for (const row of doctorsTable.rows) {
            const legacyId = row.Profesional_id as number;
            if (legacyId) {
              // Query to find the new doctor ID
              const result = await pgClient.withTransaction(async (client) => {
                const rows = await pgClient!.query<{ id: number }>(
                  client,
                  'SELECT id FROM doctors WHERE id = $1',
                  [legacyId],
                );
                return rows.length > 0 ? rows[0].id : null;
              });
              if (result) {
                doctorIdMap.set(legacyId, result);
              }
            }
          }
        }

        const patientRows = (dumpResult.tables.get('fichas')?.rows || []) as any[];
        const patientResult = await pgClient.withTransaction(async (client) => {
          return await patientMigrator.migrate(
            patientRows,
            doctorIdMap,
            pgClient!,
            logStore!,
          );
        });

        console.log(
          `[ORCHESTRATOR] Patient migration complete (${patientResult.migrated} new, ${patientResult.reused} reused)`,
        );

        // Step 8: Populate surgery lookups
        console.log('[ORCHESTRATOR] Populating surgery lookups...');
        const surgeryMigrator = createSurgeryMigrator();
        const surgeryRows = (dumpResult.tables.get('cirugias')?.rows || []) as any[];

        const lookupResult = await pgClient.withTransaction(async (client) => {
          return await surgeryMigrator.populateLookups(surgeryRows, pgClient!, logStore!);
        });
        const lookups = lookupResult.lookupIdMaps;

        console.log('[ORCHESTRATOR] Surgery lookups populated');

        // Step 9: Build patient pool for matching
        console.log('[ORCHESTRATOR] Building patient pool...');
        const patientPool = await pgClient.withTransaction(async (client) => {
          const patients = await pgClient!.query<{
            id: number;
            last_name: string;
            first_name: string;
          }>(
            client,
            'SELECT id, last_name, first_name FROM patients ORDER BY id ASC',
          );
          return patients.map((p) => ({
            id: p.id,
            lastName: p.last_name,
            firstName: p.first_name,
          }));
        });

        console.log(
          `[ORCHESTRATOR] Patient pool ready (${patientPool.length} patients)`,
        );

        // Step 10: Create patient matcher with config
        const matcherConfig: PatientMatcherConfig = {
          confidenceThreshold: config.matchConfidenceThreshold,
          minConsiderationThreshold: config.matchMinConsiderationThreshold,
        };
        const patientMatcher = createPatientMatcher(matcherConfig);

        // Step 11: Migrate appointments
        console.log('[ORCHESTRATOR] Migrating appointments...');
        const appointmentMigrator = createAppointmentMigrator();
        const appointmentRows = (dumpResult.tables.get('inst_turnos')?.rows || []) as any[];

        const appointmentResult = await pgClient.withTransaction(
          async (client) => {
            return await appointmentMigrator.migrate(
              appointmentRows,
              {
                scheduleIds,
                patientPool,
              },
              patientMatcher,
              pgClient!,
              logStore!,
            );
          },
        );

        console.log(
          `[ORCHESTRATOR] Appointment migration complete (${appointmentResult.migrated} inserted)`,
        );

        // Step 12: Migrate surgeries
        console.log('[ORCHESTRATOR] Migrating surgeries...');

        const surgeryResult = await pgClient.withTransaction(async (client) => {
          return await surgeryMigrator.migrate(
            surgeryRows as any[],
            lookups,
            patientPool,
            patientMatcher,
            pgClient!,
            logStore!,
          );
        });

        console.log(
          `[ORCHESTRATOR] Surgery migration complete (${surgeryResult.migrated} inserted)`,
        );

        // Step 13: Migrate clinical records
        console.log('[ORCHESTRATOR] Migrating clinical records...');
        const clinicalRecordMigrator = createClinicalRecordMigrator();
        const clinicalRecordRows = (dumpResult.tables.get('historiaclinica')?.rows || []) as any[];

        const clinicalRecordResult = await pgClient.withTransaction(
          async (client) => {
            return await clinicalRecordMigrator.migrate(
              clinicalRecordRows,
              patientResult.legacyIdToPatientId,
              patientResult.visitFeeByLegacyPatientId,
              pgClient!,
              logStore!,
            );
          },
        );

        console.log(
          `[ORCHESTRATOR] Clinical record migration complete (${clinicalRecordResult.migrated} inserted)`,
        );

        // Step 14: Migrate cash entries
        console.log('[ORCHESTRATOR] Migrating cash entries...');
        const cashEntryMigrator = createCashEntryMigrator();
        const cashEntryRows = (dumpResult.tables.get('caja')?.rows || []) as any[];

        const cashEntryResult = await pgClient.withTransaction(async (client) => {
          return await cashEntryMigrator.migrate(
            cashEntryRows,
            pgClient!,
            logStore!,
          );
        });

        console.log(
          `[ORCHESTRATOR] Cash entry migration complete (${cashEntryResult.migrated} inserted)`,
        );

        // Step 15: Detect duplicate patients in destination
        console.log('[ORCHESTRATOR] Detecting duplicate patients...');
        const duplicatePairs = patientMatcher.detectDuplicatesInPool(patientPool);

        if (duplicatePairs.length > 0) {
          console.log(
            `[ORCHESTRATOR] Found ${duplicatePairs.length} possible duplicate patient pairs`,
          );
        }

        // Step 16: Build and write reports
        console.log('[ORCHESTRATOR] Building reports...');

        // Add summaries to report builder
        if (doctorsTable) {
          reportBuilder.addTableSummary({
            tableName: 'inst_doctor',
            migrated: doctorsResult.inserted,
            reused: doctorsResult.reused,
            excluded: 0,
            omitted: 0,
            errors: doctorsResult.errors.length,
            warnings: doctorsResult.warnings.length,
          });
        }

        if (insurancesTable) {
          reportBuilder.addTableSummary({
            tableName: 'inst_obrasoc',
            migrated: insurancesResult.inserted,
            reused: insurancesResult.reused,
            excluded: 0,
            omitted: 0,
            errors: insurancesResult.errors.length,
            warnings: insurancesResult.warnings.length,
          });
        }

        if (visitReasonsTable) {
          reportBuilder.addTableSummary({
            tableName: 'inst_motivo',
            migrated: visitReasonsResult.inserted,
            reused: visitReasonsResult.reused,
            excluded: 0,
            omitted: 0,
            errors: visitReasonsResult.errors.length,
            warnings: visitReasonsResult.warnings.length,
          });
        }

        if (schedulesTable) {
          reportBuilder.addTableSummary({
            tableName: 'inst_horarios',
            migrated: 0,
            reused: 0,
            excluded: 0,
            omitted: 0,
            errors: schedulesResult.errors.length,
            warnings: schedulesResult.warnings.length,
          });
        }

        // Add patient summary
        reportBuilder.addTableSummary({
          tableName: 'fichas',
          migrated: patientResult.migrated,
          reused: patientResult.reused,
          excluded: patientResult.errors.length,
          omitted: 0,
          errors: patientResult.errors.length,
          warnings: patientResult.warnings.length,
        });

        // Add appointment summary
        reportBuilder.addTableSummary({
          tableName: 'inst_turnos',
          migrated: appointmentResult.migrated,
          reused: appointmentResult.reused,
          excluded: appointmentResult.errors.length,
          omitted: 0,
          errors: appointmentResult.errors.length,
          warnings: appointmentResult.warnings.length,
        });

        // Add surgery summary
        reportBuilder.addTableSummary({
          tableName: 'cirugias',
          migrated: surgeryResult.migrated,
          reused: 0,
          excluded: surgeryResult.errors.length,
          omitted: 0,
          errors: surgeryResult.errors.length,
          warnings: surgeryResult.warnings.length,
        });

        // Add clinical record summary
        reportBuilder.addTableSummary({
          tableName: 'historiaclinica',
          migrated: clinicalRecordResult.migrated,
          reused: clinicalRecordResult.reused,
          excluded: clinicalRecordResult.excluded,
          omitted: 0,
          errors: clinicalRecordResult.errors.length,
          warnings: clinicalRecordResult.warnings.length,
        });

        // Add cash entry summary
        reportBuilder.addTableSummary({
          tableName: 'caja',
          migrated: cashEntryResult.migrated,
          reused: 0,
          excluded: cashEntryResult.excluded,
          omitted: cashEntryResult.omitted,
          errors: cashEntryResult.errors.length,
          warnings: cashEntryResult.warnings.length,
        });

        // Add duplicate pairs to report
        if (duplicatePairs.length > 0) {
          const convertedPairs = duplicatePairs.map((p) => ({
            candidates: [String(p.candidateA.id), String(p.candidateB.id)],
            score: p.score,
          }));
          reportBuilder.addDuplicatePatientPairs(convertedPairs);
        }

        const report = reportBuilder.build(new Date());
        const paths = await reportBuilder.writeToDisk(
          report,
          config.reportOutputDir,
        );

        const executionTimeMs = Date.now() - startTime;

        console.log('[ORCHESTRATOR] Migration completed successfully');
        console.log(`[ORCHESTRATOR] JSON report: ${paths.jsonPath}`);
        console.log(`[ORCHESTRATOR] Markdown report: ${paths.mdPath}`);
        console.log(
          `[ORCHESTRATOR] Execution time: ${(executionTimeMs / 1000).toFixed(2)}s`,
        );

        return {
          success: true,
          report,
          reportPaths: paths,
          executionTimeMs,
        };
      } catch (error) {
        const executionTimeMs = Date.now() - startTime;
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        console.error(`[ORCHESTRATOR] Migration failed: ${errorMessage}`);

        return {
          success: false,
          error: errorMessage,
          executionTimeMs,
        };
      } finally {
        if (pgClient) {
          await pgClient.close();
        }
      }
    },
  };
}
