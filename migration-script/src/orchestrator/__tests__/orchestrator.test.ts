/**
 * Integration Tests for MigrationOrchestrator
 *
 * Complete end-to-end migration test against a real PostgreSQL test database.
 * Requirement: Full integration test verifying the entire orchestration sequence.
 *
 * Reference: docs/specs/data-migration-script/tasks.md Task 15
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';
import { createMigrationOrchestrator } from '../migrator-orchestrator';
import type { MigrationConfig } from '../../config/index';

/**
 * Test database connection URL (for CI/local testing)
 * Can be overridden via TEST_DATABASE_URL environment variable
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/migration_test';

/**
 * Path to sample dump for integration testing
 * Expected to exist at project root or be provided by CI
 */
const SAMPLE_DUMP_PATH = path.join(__dirname, '../../../..', 'sample_dump.sql');

/**
 * Path to database schema file
 */
const SCHEMA_SQL_PATH = path.join(__dirname, '../../../..', 'schema.sql');

/**
 * Helper: Check if test database is available
 */
async function isDatabaseAvailable(): Promise<boolean> {
  try {
    const pool = new Pool({ connectionString: TEST_DATABASE_URL });
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    await pool.end();
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper: Drop and recreate test database schema
 */
async function setupTestDatabase(): Promise<void> {
  if (!fs.existsSync(SCHEMA_SQL_PATH)) {
    throw new Error(`Schema SQL not found at ${SCHEMA_SQL_PATH}`);
  }

  const pool = new Pool({ connectionString: TEST_DATABASE_URL });

  try {
    // Read and execute schema
    const schemaSql = fs.readFileSync(SCHEMA_SQL_PATH, 'utf-8');

    // Split by semicolons and execute each statement
    const statements = schemaSql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      try {
        await pool.query(statement);
      } catch (err) {
        // Some statements may fail (e.g., IF EXISTS on non-existent objects in some dialects)
        // This is acceptable during schema setup
        console.log(`[SCHEMA SETUP] Ignoring error: ${(err as Error).message}`);
      }
    }
  } finally {
    await pool.end();
  }
}

/**
 * Helper: Clean up test database
 */
async function cleanupTestDatabase(): Promise<void> {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL });

  try {
    const client = await pool.connect();
    try {
      // Get all table names (excluding system tables)
      const tables = await client.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );

      // Drop all tables with CASCADE
      for (const { table_name } of tables.rows) {
        try {
          await client.query(`DROP TABLE IF EXISTS "${table_name}" CASCADE`);
        } catch (err) {
          console.log(`[CLEANUP] Ignoring error dropping ${table_name}`);
        }
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

describe('MigrationOrchestrator', () => {
  let isDbAvailable = false;

  // Note: These tests require a live PostgreSQL database
  // Skip them if TEST_DATABASE_URL is not set or database is unavailable
  // In CI environments, ensure postgres service is running

  beforeAll(async () => {
    // Check if database is available
    const available = await isDatabaseAvailable();
    isDbAvailable = available;
    if (!available) {
      console.warn(`[ORCHESTRATOR TEST] Test database not available at ${TEST_DATABASE_URL}`);
      console.warn('[ORCHESTRATOR TEST] Skipping integration tests');
    }
  });

  afterAll(async () => {
    // Cleanup test database after all tests
    if (isDbAvailable) {
      try {
        await cleanupTestDatabase();
      } catch (err) {
        console.warn('[ORCHESTRATOR TEST] Cleanup failed:', (err as Error).message);
      }
    }
  });

  describe('Basic initialization', () => {
    it('should create an orchestrator instance', () => {
      const orchestrator = createMigrationOrchestrator();
      expect(orchestrator).toBeDefined();
      expect(typeof orchestrator.run).toBe('function');
    });
  });

  describe('End-to-end migration', () => {
    it.skipIf(!isDbAvailable)('should execute complete migration against sample_dump.sql', async () => {
      // Check if sample dump exists
      if (!fs.existsSync(SAMPLE_DUMP_PATH)) {
        console.warn(`[ORCHESTRATOR TEST] Sample dump not found at ${SAMPLE_DUMP_PATH}`);
        console.warn('[ORCHESTRATOR TEST] Skipping E2E test');
        return;
      }

      // Setup test database
      await setupTestDatabase();

      // Create migration configuration
      const config: MigrationConfig = {
        dumpFilePath: SAMPLE_DUMP_PATH,
        databaseUrl: TEST_DATABASE_URL,
        matchConfidenceThreshold: 0.92,
        matchMinConsiderationThreshold: 0.75,
        resetMode: 'log-only',
        reportOutputDir: './test-reports',
        insertBatchSize: 500,
      };

      // Ensure report directory exists
      if (!fs.existsSync(config.reportOutputDir)) {
        fs.mkdirSync(config.reportOutputDir, { recursive: true });
      }

      // Execute orchestrator
      const orchestrator = createMigrationOrchestrator();
      const result = await orchestrator.run(config);

      // Assertions: Basic success
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.reportPaths).toBeDefined();

      // Assertions: Report files exist
      if (result.reportPaths) {
        expect(fs.existsSync(result.reportPaths.jsonPath)).toBe(true);
        expect(fs.existsSync(result.reportPaths.mdPath)).toBe(true);

        // Assertions: Report content is valid
        const jsonContent = fs.readFileSync(result.reportPaths.jsonPath, 'utf-8');
        expect(() => JSON.parse(jsonContent)).not.toThrow();

        const mdContent = fs.readFileSync(result.reportPaths.mdPath, 'utf-8');
        expect(mdContent.length).toBeGreaterThan(0);
        expect(mdContent).toContain('Migration Report');
      }

      // Assertions: Report object is valid
      if (result.report) {
        expect(result.report.summaryByTable).toBeDefined();
        expect(typeof result.report.summaryByTable).toBe('object');
        expect(result.report.excludedTables).toBeDefined();
        expect(Array.isArray(result.report.excludedTables)).toBe(true);

        // Assertions: Excluded tables are registered
        const excludedTableNames = result.report.excludedTables.map((t) => t.name);
        expect(excludedTableNames).toContain('inst_alt');
        expect(excludedTableNames).toContain('medias');
        expect(excludedTableNames).toContain('ventamedias');
      }

      // Cleanup test reports
      try {
        const reportFiles = fs.readdirSync(config.reportOutputDir);
        for (const file of reportFiles) {
          fs.unlinkSync(path.join(config.reportOutputDir, file));
        }
        fs.rmdirSync(config.reportOutputDir);
      } catch (err) {
        console.warn('[ORCHESTRATOR TEST] Report cleanup failed');
      }
    });
  });

  describe('Configuration validation', () => {
    it('should fail if dumpFilePath is empty', async () => {
      const config: MigrationConfig = {
        dumpFilePath: '',
        databaseUrl: TEST_DATABASE_URL,
        matchConfidenceThreshold: 0.92,
        matchMinConsiderationThreshold: 0.75,
        resetMode: 'log-only',
        reportOutputDir: './test-reports',
        insertBatchSize: 500,
      };

      const orchestrator = createMigrationOrchestrator();
      const result = await orchestrator.run(config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('dumpFilePath');
    });

    it('should fail if databaseUrl is empty', async () => {
      const config: MigrationConfig = {
        dumpFilePath: SAMPLE_DUMP_PATH,
        databaseUrl: '',
        matchConfidenceThreshold: 0.92,
        matchMinConsiderationThreshold: 0.75,
        resetMode: 'log-only',
        reportOutputDir: './test-reports',
        insertBatchSize: 500,
      };

      const orchestrator = createMigrationOrchestrator();
      const result = await orchestrator.run(config);

      expect(result.success).toBe(false);
      expect(result.error).toContain('databaseUrl');
    });

    it('should fail gracefully if dump file does not exist', async () => {
      const config: MigrationConfig = {
        dumpFilePath: '/nonexistent/path/dump.sql',
        databaseUrl: TEST_DATABASE_URL,
        matchConfidenceThreshold: 0.92,
        matchMinConsiderationThreshold: 0.75,
        resetMode: 'log-only',
        reportOutputDir: './test-reports',
        insertBatchSize: 500,
      };

      const orchestrator = createMigrationOrchestrator();
      const result = await orchestrator.run(config);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Report generation', () => {
    it('should generate valid JSON report', async () => {
      if (!fs.existsSync(SAMPLE_DUMP_PATH)) {
        console.warn('[ORCHESTRATOR TEST] Sample dump not found, skipping');
        return;
      }

      await setupTestDatabase();

      const reportDir = './test-reports-json';
      if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true });
      }

      const config: MigrationConfig = {
        dumpFilePath: SAMPLE_DUMP_PATH,
        databaseUrl: TEST_DATABASE_URL,
        matchConfidenceThreshold: 0.92,
        matchMinConsiderationThreshold: 0.75,
        resetMode: 'log-only',
        reportOutputDir: reportDir,
        insertBatchSize: 500,
      };

      const orchestrator = createMigrationOrchestrator();
      const result = await orchestrator.run(config);

      if (result.reportPaths) {
        const jsonContent = fs.readFileSync(result.reportPaths.jsonPath, 'utf-8');
        const report = JSON.parse(jsonContent);

        // Verify JSON structure
        expect(report).toHaveProperty('summaryByTable');
        expect(report).toHaveProperty('excludedTables');
        expect(report).toHaveProperty('patientMatching');
        expect(report).toHaveProperty('errors');
        expect(report).toHaveProperty('warnings');
      }

      // Cleanup
      try {
        const files = fs.readdirSync(reportDir);
        for (const file of files) {
          fs.unlinkSync(path.join(reportDir, file));
        }
        fs.rmdirSync(reportDir);
      } catch (err) {
        console.warn('[ORCHESTRATOR TEST] Report cleanup failed');
      }
    });

    it('should generate valid Markdown report', async () => {
      if (!fs.existsSync(SAMPLE_DUMP_PATH)) {
        console.warn('[ORCHESTRATOR TEST] Sample dump not found, skipping');
        return;
      }

      await setupTestDatabase();

      const reportDir = './test-reports-md';
      if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true });
      }

      const config: MigrationConfig = {
        dumpFilePath: SAMPLE_DUMP_PATH,
        databaseUrl: TEST_DATABASE_URL,
        matchConfidenceThreshold: 0.92,
        matchMinConsiderationThreshold: 0.75,
        resetMode: 'log-only',
        reportOutputDir: reportDir,
        insertBatchSize: 500,
      };

      const orchestrator = createMigrationOrchestrator();
      const result = await orchestrator.run(config);

      if (result.reportPaths) {
        const mdContent = fs.readFileSync(result.reportPaths.mdPath, 'utf-8');

        // Verify Markdown structure
        expect(mdContent).toContain('# Migration Report');
        expect(mdContent).toContain('##'); // Section headers
        expect(mdContent.length).toBeGreaterThan(0);
      }

      // Cleanup
      try {
        const files = fs.readdirSync(reportDir);
        for (const file of files) {
          fs.unlinkSync(path.join(reportDir, file));
        }
        fs.rmdirSync(reportDir);
      } catch (err) {
        console.warn('[ORCHESTRATOR TEST] Report cleanup failed');
      }
    });
  });

  describe('MigrationOrchestrator - Idempotence & Re-execution (Requirement 9)', () => {
    /**
     * Test 1: E2E - Second run does not change row counts
     *
     * Requirement 9.1, 9.5: Executing the script twice over the same input
     * should not create duplicates; row counts in destination tables must remain
     * stable between runs. Additionally, Requirement 9.5 verifies that patient
     * matching (Requirement 6) is deterministic.
     */
    it.skipIf(!isDbAvailable)('E2E: Second run does not change row counts (Requirement 9.1, 9.5)', async () => {
      // Skip if sample dump is not available
      if (!fs.existsSync(SAMPLE_DUMP_PATH)) {
        console.warn('[ORCHESTRATOR TEST] Sample dump not found, skipping idempotence test');
        return;
      }

      // Setup: Create fresh test database with schema + seeds
      await setupTestDatabase();

      const reportDir = './test-reports-idempotence-1';
      if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true });
      }

      const config: MigrationConfig = {
        dumpFilePath: SAMPLE_DUMP_PATH,
        databaseUrl: TEST_DATABASE_URL,
        matchConfidenceThreshold: 0.92,
        matchMinConsiderationThreshold: 0.75,
        resetMode: 'log-only',
        reportOutputDir: reportDir,
        insertBatchSize: 500,
      };

      const orchestrator = createMigrationOrchestrator();

      // Run 1: Execute the first migration
      console.log('[IDEMPOTENCE TEST 1] Running first migration...');
      const result1 = await orchestrator.run(config);

      if (!result1.success) {
        console.error('[IDEMPOTENCE TEST 1] Migration failed:', result1.error);
      }
      expect(result1.success).toBe(true);
      expect(result1.report).toBeDefined();

      // Capture row counts from first run
      const pool1 = new Pool({ connectionString: TEST_DATABASE_URL });
      try {
        const counts1: Record<string, number> = {};

        const tables = [
          'patients',
          'appointments',
          'clinical_records',
          'surgeries',
          'cash_entries',
          'doctors',
          'health_insurances',
          'visit_reasons',
          'surgery_diagnoses',
          'body_parts',
          'surgery_techniques',
        ];

        for (const table of tables) {
          const result = await pool1.query<{ count: bigint }>(`SELECT COUNT(*) as count FROM ${table}`);
          counts1[table] = Number(result.rows[0].count);
        }

        console.log('[IDEMPOTENCE TEST 1] Row counts after run 1:', counts1);

        // Run 2: Execute the migration again on the same database with same dump
        console.log('[IDEMPOTENCE TEST 1] Running second migration...');
        const result2 = await orchestrator.run(config);

        expect(result2.success).toBe(true);
        expect(result2.report).toBeDefined();

        // Capture row counts from second run
        const counts2: Record<string, number> = {};
        for (const table of tables) {
          const result = await pool1.query<{ count: bigint }>(`SELECT COUNT(*) as count FROM ${table}`);
          counts2[table] = Number(result.rows[0].count);
        }

        console.log('[IDEMPOTENCE TEST 1] Row counts after run 2:', counts2);

        // Assert: Row counts must be identical between runs
        // This verifies that no duplicates were created and existing rows were properly reused
        for (const table of tables) {
          console.log(`[IDEMPOTENCE TEST 1] ${table}: Run1=${counts1[table]}, Run2=${counts2[table]}`);
          expect(counts2[table]).toBe(counts1[table]);
        }

        // Additional verification: Report should show migrated=0, reused=N for tables in Run 2
        // (indicating that all rows were already processed)
        if (result2.report?.summaryByTable) {
          // For tables that had rows in Run 1, Run 2 should show them as reused (migrated=0)
          const patientsTableSummary = result2.report.summaryByTable['fichas'];
          if (patientsTableSummary && patientsTableSummary.migrated > 0) {
            // If there are patients in the dump, the second run should show them as reused
            console.log(
              `[IDEMPOTENCE TEST 1] Patients summary: migrated=${patientsTableSummary.migrated}, reused=${patientsTableSummary.reused}`,
            );
            expect(patientsTableSummary.reused).toBeGreaterThan(0);
          }
        }

        console.log('[IDEMPOTENCE TEST 1] ✓ Idempotence verified: row counts unchanged');
      } finally {
        await pool1.end();
      }

      // Cleanup
      try {
        const files = fs.readdirSync(reportDir);
        for (const file of files) {
          fs.unlinkSync(path.join(reportDir, file));
        }
        fs.rmdirSync(reportDir);
      } catch (err) {
        console.warn('[IDEMPOTENCE TEST 1] Report cleanup failed');
      }
    });

    /**
     * Test 2: E2E - Reset full mode allows re-processing from scratch
     *
     * Requirement 9.2, 9.3: Executing with --reset full mode clears the migration log
     * and destination tables, allowing a fresh reprocessing of all data without manual
     * intervention on the database. After reset and re-run, row counts should match
     * the first run (proving that the reset worked and data is repopulated correctly).
     */
    it.skipIf(!isDbAvailable)(
      'E2E: Reset full mode allows re-processing from scratch (Requirement 9.2, 9.3)',
      async () => {
        // Skip if sample dump is not available
        if (!fs.existsSync(SAMPLE_DUMP_PATH)) {
          console.warn('[ORCHESTRATOR TEST] Sample dump not found, skipping reset test');
          return;
        }

        // Setup: Create fresh test database with schema + seeds
        await setupTestDatabase();

        const reportDir = './test-reports-reset';
        if (!fs.existsSync(reportDir)) {
          fs.mkdirSync(reportDir, { recursive: true });
        }

        const configRun1: MigrationConfig = {
          dumpFilePath: SAMPLE_DUMP_PATH,
          databaseUrl: TEST_DATABASE_URL,
          matchConfidenceThreshold: 0.92,
          matchMinConsiderationThreshold: 0.75,
          resetMode: 'log-only',
          reportOutputDir: reportDir,
          insertBatchSize: 500,
        };

        const orchestrator = createMigrationOrchestrator();

        // Run 1: Execute the first migration
        console.log('[RESET TEST] Running first migration...');
        const result1 = await orchestrator.run(configRun1);
        if (!result1.success) {
          console.error('[RESET TEST] Migration failed:', result1.error);
        }
        expect(result1.success).toBe(true);

        // Capture row counts and verify migration_log has entries
        const pool1 = new Pool({ connectionString: TEST_DATABASE_URL });
        try {
          const logCountResult1 = await pool1.query<{ count: bigint }>('SELECT COUNT(*) as count FROM migration_log');
          const logCount1 = Number(logCountResult1.rows[0].count);
          console.log('[RESET TEST] migration_log entries after run 1:', logCount1);
          expect(logCount1).toBeGreaterThan(0);

          const patientsCountResult1 = await pool1.query<{ count: bigint }>('SELECT COUNT(*) as count FROM patients');
          const patientsCount1 = Number(patientsCountResult1.rows[0].count);
          console.log('[RESET TEST] patients count after run 1:', patientsCount1);

          // Run 2: Apply reset full mode and re-run
          console.log('[RESET TEST] Running second migration with reset full...');
          const configRun2: MigrationConfig = {
            ...configRun1,
            resetMode: 'full',
          };

          const result2 = await orchestrator.run(configRun2);
          expect(result2.success).toBe(true);

          // Verify: migration_log should be repopulated (not empty)
          const logCountResult2 = await pool1.query<{ count: bigint }>('SELECT COUNT(*) as count FROM migration_log');
          const logCount2 = Number(logCountResult2.rows[0].count);
          console.log('[RESET TEST] migration_log entries after reset+run 2:', logCount2);
          expect(logCount2).toBeGreaterThan(0);

          // Verify: patients count should be the same as after run 1
          const patientsCountResult2 = await pool1.query<{ count: bigint }>('SELECT COUNT(*) as count FROM patients');
          const patientsCount2 = Number(patientsCountResult2.rows[0].count);
          console.log('[RESET TEST] patients count after reset+run 2:', patientsCount2);
          console.log(`[RESET TEST] Count comparison: Run1=${patientsCount1}, Run2=${patientsCount2}`);
          expect(patientsCount2).toBe(patientsCount1);

          // Verify: Report should show migrated=N, reused=0 for Run 2 (after reset)
          if (result2.report?.summaryByTable) {
            const patientsTableSummary = result2.report.summaryByTable['fichas'];
            if (patientsTableSummary && patientsCount2 > 0) {
              // After reset, all rows should be migrated fresh (reused should be minimal or 0)
              expect(patientsTableSummary.migrated).toBeGreaterThan(0);
            }
          }

          console.log('[RESET TEST] ✓ Reset full mode verified: data reprocessed correctly');
        } finally {
          await pool1.end();
        }

        // Cleanup
        try {
          const files = fs.readdirSync(reportDir);
          for (const file of files) {
            fs.unlinkSync(path.join(reportDir, file));
          }
          fs.rmdirSync(reportDir);
        } catch (err) {
          console.warn('[RESET TEST] Report cleanup failed');
        }
      },
    );

    /**
     * Test 3: E2E - Patient matching results are deterministic
     *
     * Requirement 6.7, 9.5: Patient matching must produce deterministic results
     * when executed multiple times against the same input and same patient pool.
     * This test verifies that the fuzzy matching algorithm and decision logic
     * produce identical outcomes in repeated executions.
     */
    it.skipIf(!isDbAvailable)('E2E: Patient matching results are deterministic (Requirement 6.7, 9.5)', async () => {
      // Skip if sample dump is not available
      if (!fs.existsSync(SAMPLE_DUMP_PATH)) {
        console.warn('[ORCHESTRATOR TEST] Sample dump not found, skipping determinism test');
        return;
      }

      // Setup: Create fresh test database with schema + seeds
      await setupTestDatabase();

      const reportDir = './test-reports-determinism';
      if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true });
      }

      const config: MigrationConfig = {
        dumpFilePath: SAMPLE_DUMP_PATH,
        databaseUrl: TEST_DATABASE_URL,
        matchConfidenceThreshold: 0.92,
        matchMinConsiderationThreshold: 0.75,
        resetMode: 'log-only',
        reportOutputDir: reportDir,
        insertBatchSize: 500,
      };

      const orchestrator = createMigrationOrchestrator();

      // Run 1: Execute the first migration and capture matching outcomes
      console.log('[DETERMINISM TEST] Running first migration...');
      const result1 = await orchestrator.run(config);

      if (!result1.success) {
        console.error('[DETERMINISM TEST] Migration failed:', result1.error);
      }
      expect(result1.success).toBe(true);
      expect(result1.report).toBeDefined();

      // Extract patient matching outcomes from Run 1
      const matching1 = result1.report?.patientMatching;
      const autoLinkedCount1 = matching1?.autoLinked?.count ?? 0;
      const manualReviewCount1 = matching1?.manualReview?.count ?? 0;
      const noMatchCount1 = matching1?.noMatch?.count ?? 0;

      console.log('[DETERMINISM TEST] Run 1 matching outcomes:');
      console.log(`  - Auto-linked: ${autoLinkedCount1}`);
      console.log(`  - Manual review: ${manualReviewCount1}`);
      console.log(`  - No match: ${noMatchCount1}`);

      // Run 2: Execute the migration again
      console.log('[DETERMINISM TEST] Running second migration...');
      const result2 = await orchestrator.run(config);

      expect(result2.success).toBe(true);
      expect(result2.report).toBeDefined();

      // Extract patient matching outcomes from Run 2
      const matching2 = result2.report?.patientMatching;
      const autoLinkedCount2 = matching2?.autoLinked?.count ?? 0;
      const manualReviewCount2 = matching2?.manualReview?.count ?? 0;
      const noMatchCount2 = matching2?.noMatch?.count ?? 0;

      console.log('[DETERMINISM TEST] Run 2 matching outcomes:');
      console.log(`  - Auto-linked: ${autoLinkedCount2}`);
      console.log(`  - Manual review: ${manualReviewCount2}`);
      console.log(`  - No match: ${noMatchCount2}`);

      // Assert: Matching outcome counts must be identical
      console.log(`[DETERMINISM TEST] Auto-linked comparison: Run1=${autoLinkedCount1}, Run2=${autoLinkedCount2}`);
      console.log(
        `[DETERMINISM TEST] Manual review comparison: Run1=${manualReviewCount1}, Run2=${manualReviewCount2}`,
      );
      console.log(`[DETERMINISM TEST] No-match comparison: Run1=${noMatchCount1}, Run2=${noMatchCount2}`);
      expect(autoLinkedCount2).toBe(autoLinkedCount1);
      expect(manualReviewCount2).toBe(manualReviewCount1);
      expect(noMatchCount2).toBe(noMatchCount1);

      // Detailed verification: Check that specific patient matching results are identical
      // by verifying that the same patients were matched with the same scores
      if (autoLinkedCount1 > 0 && matching1?.autoLinked?.examples && matching2?.autoLinked?.examples) {
        // For determinism, the order and content should be identical
        const examples1 = matching1.autoLinked.examples;
        const examples2 = matching2.autoLinked.examples;
        for (let i = 0; i < Math.min(examples1.length, examples2.length); i++) {
          const link1 = examples1[i];
          const link2 = examples2[i];

          if (link1 && link2) {
            // Check that the same patient was linked with same (or very close) score
            console.log(`[DETERMINISM TEST] Comparing example ${i}: ${link1.sourceName} vs ${link2.sourceName}`);
            expect(link2.sourceName).toBe(link1.sourceName);
            // Allow minor floating point differences in score
            if (link1.score !== undefined && link2.score !== undefined) {
              expect(Math.abs(link2.score - link1.score)).toBeLessThan(0.0001);
            }
          }
        }
      }

      console.log('[DETERMINISM TEST] ✓ Patient matching is deterministic');

      // Cleanup
      try {
        const files = fs.readdirSync(reportDir);
        for (const file of files) {
          fs.unlinkSync(path.join(reportDir, file));
        }
        fs.rmdirSync(reportDir);
      } catch (err) {
        console.warn('[DETERMINISM TEST] Report cleanup failed');
      }
    });
  });

  describe('MigrationOrchestrator - Synthetic Volume Test (Requirement 10.3, 10.5)', () => {
    /**
     * Test: E2E - Handles 10x volume without errors
     *
     * Requirement 10.3: Verify that parser and streaming handle significantly larger volumes
     * Requirement 10.5: Verify that the same script works with 10x data without code changes
     * Requirement 10.2: Verify runner completes without timeout
     * Requirement 10.4: Verify row counts are correct at larger volume
     *
     * This test generates a synthetic MySQL dump with approximately 10x the volume of
     * the sample_dump.sql:
     * - fichas: ~500 rows (10x ~50 in sample)
     * - inst_turnos: ~200 rows (10x ~20 in sample)
     * - cirugias: ~100 rows (10x ~10 in sample)
     * - historiaclinica: ~300 rows (10x ~30 in sample)
     * - caja: ~400 rows (10x ~40 in sample)
     *
     * The test verifies:
     * 1. Parser handles multi-row INSERT statements without errors
     * 2. Batching with insertBatchSize works correctly (no OOM, no timeout)
     * 3. Final row counts are deterministic and match input
     * 4. Reports are generated successfully with valid structure
     * 5. Execution completes in reasonable time (<120s, ideally ~30-60s)
     * 6. No code changes needed for larger volume
     */
    it.skipIf(!isDbAvailable)('E2E: Handles 10x volume without errors and within reasonable time', async () => {
      // Require the synthetic fixture generator
      const { generateSyntheticMysqlDump } = await import('../../__tests__/fixtures/synthetic');

      // Setup: Create fresh test database with schema + seeds
      await setupTestDatabase();

      const reportDir = './test-reports-synthetic-volume';
      if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true });
      }

      // Generate synthetic dump with 10x volume
      console.log('[SYNTHETIC VOLUME TEST] Generating synthetic dump with 10x volume...');
      const syntheticDump = generateSyntheticMysqlDump({
        fichasCount: 500,
        turnosCount: 200,
        cirugiasCount: 100,
        historiaclinicaCount: 300,
        cajaCount: 400,
      });

      // Write synthetic dump to temporary file
      const tmpDir = require('os').tmpdir();
      const syntheticDumpPath = path.join(tmpDir, `synthetic-dump-${Date.now()}.sql`);

      try {
        fs.writeFileSync(syntheticDumpPath, syntheticDump, 'utf-8');
        console.log(`[SYNTHETIC VOLUME TEST] Synthetic dump generated (${syntheticDump.length} bytes)`);

        // Verify synthetic dump file size
        const dumpStats = fs.statSync(syntheticDumpPath);
        console.log(`[SYNTHETIC VOLUME TEST] Synthetic dump file size: ${(dumpStats.size / 1024).toFixed(2)} KB`);

        const config: MigrationConfig = {
          dumpFilePath: syntheticDumpPath,
          databaseUrl: TEST_DATABASE_URL,
          matchConfidenceThreshold: 0.92,
          matchMinConsiderationThreshold: 0.75,
          resetMode: 'log-only',
          reportOutputDir: reportDir,
          insertBatchSize: 500, // Standard batch size
        };

        // Execute orchestrator against synthetic dump
        console.log('[SYNTHETIC VOLUME TEST] Starting migration...');
        const startTime = Date.now();

        const orchestrator = createMigrationOrchestrator();
        const result = await orchestrator.run(config);

        const elapsedSeconds = (Date.now() - startTime) / 1000;
        console.log(`[SYNTHETIC VOLUME TEST] Migration completed in ${elapsedSeconds.toFixed(2)}s`);

        // Assertion 1: Migration must succeed
        expect(result.success).toBe(true);
        expect(result.error).toBeUndefined();
        if (!result.success) {
          console.error('[SYNTHETIC VOLUME TEST] Migration failed:', result.error);
        }

        // Assertion 2: Performance: Should complete within 120s (ideally 30-60s)
        expect(elapsedSeconds).toBeLessThan(120);
        console.log(`[SYNTHETIC VOLUME TEST] ✓ Performance acceptable: ${elapsedSeconds.toFixed(2)}s`);

        // Assertion 3: Reports must be generated
        expect(result.reportPaths).toBeDefined();
        if (result.reportPaths) {
          expect(fs.existsSync(result.reportPaths.jsonPath)).toBe(true);
          expect(fs.existsSync(result.reportPaths.mdPath)).toBe(true);
          console.log(`[SYNTHETIC VOLUME TEST] ✓ Reports generated successfully`);

          // Assertion 4: Report JSON is valid
          const jsonContent = fs.readFileSync(result.reportPaths.jsonPath, 'utf-8');
          expect(() => JSON.parse(jsonContent)).not.toThrow();

          const reportJson = JSON.parse(jsonContent);
          expect(reportJson).toHaveProperty('summaryByTable');
          expect(reportJson).toHaveProperty('excludedTables');
          expect(reportJson).toHaveProperty('patientMatching');
          expect(reportJson).toHaveProperty('errors');
          expect(reportJson).toHaveProperty('warnings');

          // Assertion 5: Report Markdown is well-formed
          const mdContent = fs.readFileSync(result.reportPaths.mdPath, 'utf-8');
          expect(mdContent.length).toBeGreaterThan(0);
          expect(mdContent).toContain('# Migration Report');
          expect(mdContent).toContain('##'); // Section headers
        }

        // Assertion 6: Verify row counts in database match expected values
        const pool = new Pool({ connectionString: TEST_DATABASE_URL });
        try {
          const queries = {
            patients: 'SELECT COUNT(*) as count FROM patients',
            appointments: 'SELECT COUNT(*) as count FROM appointments',
            clinical_records: 'SELECT COUNT(*) as count FROM clinical_records',
            surgeries: 'SELECT COUNT(*) as count FROM surgeries',
            cash_entries: 'SELECT COUNT(*) as count FROM cash_entries',
            doctors: 'SELECT COUNT(*) as count FROM doctors',
            health_insurances: 'SELECT COUNT(*) as count FROM health_insurances',
            visit_reasons: 'SELECT COUNT(*) as count FROM visit_reasons',
            surgery_diagnoses: 'SELECT COUNT(*) as count FROM surgery_diagnoses',
            body_parts: 'SELECT COUNT(*) as count FROM body_parts',
            surgery_techniques: 'SELECT COUNT(*) as count FROM surgery_techniques',
          };

          const counts: Record<string, number> = {};
          for (const [table, query] of Object.entries(queries)) {
            const result = await pool.query<{ count: bigint }>(query);
            counts[table] = Number(result.rows[0].count);
          }

          console.log('[SYNTHETIC VOLUME TEST] Final row counts:');
          console.log(`  patients: ${counts.patients}`);
          console.log(`  appointments: ${counts.appointments}`);
          console.log(`  clinical_records: ${counts.clinical_records}`);
          console.log(`  surgeries: ${counts.surgeries}`);
          console.log(`  cash_entries: ${counts.cash_entries}`);
          console.log(`  doctors: ${counts.doctors}`);
          console.log(`  health_insurances: ${counts.health_insurances}`);
          console.log(`  visit_reasons: ${counts.visit_reasons}`);
          console.log(`  surgery_diagnoses: ${counts.surgery_diagnoses}`);
          console.log(`  body_parts: ${counts.body_parts}`);
          console.log(`  surgery_techniques: ${counts.surgery_techniques}`);

          // Verify that data was actually inserted (non-zero counts for main tables)
          expect(counts.patients).toBeGreaterThan(0);
          expect(counts.appointments).toBeGreaterThan(0);
          expect(counts.clinical_records).toBeGreaterThan(0);
          expect(counts.surgeries).toBeGreaterThan(0);
          expect(counts.cash_entries).toBeGreaterThan(0);

          // Verify reference tables have data
          expect(counts.doctors).toBeGreaterThan(0);
          expect(counts.health_insurances).toBeGreaterThan(0);
          expect(counts.visit_reasons).toBeGreaterThan(0);

          // Verify lookup tables were populated from data
          expect(counts.surgery_diagnoses).toBeGreaterThan(0);
          expect(counts.body_parts).toBeGreaterThan(0);
          expect(counts.surgery_techniques).toBeGreaterThan(0);

          console.log('[SYNTHETIC VOLUME TEST] ✓ All tables populated with data');

          // Assertion 7: Verify migration_log has records (idempotency support)
          const logResult = await pool.query<{ count: bigint }>('SELECT COUNT(*) as count FROM migration_log');
          const logCount = Number(logResult.rows[0].count);
          expect(logCount).toBeGreaterThan(0);
          console.log(`[SYNTHETIC VOLUME TEST] ✓ migration_log has ${logCount} records (idempotency enabled)`);

          // Assertion 8: Verify report summary contains correct table names
          if (result.report?.summaryByTable) {
            const reportedTables = Object.keys(result.report.summaryByTable);
            expect(reportedTables).toContain('fichas');
            expect(reportedTables).toContain('inst_turnos');
            expect(reportedTables).toContain('cirugias');
            expect(reportedTables).toContain('historiaclinica');
            expect(reportedTables).toContain('caja');
            console.log(`[SYNTHETIC VOLUME TEST] ✓ Report contains all migrated source tables`);
          }

          console.log('[SYNTHETIC VOLUME TEST] ✓✓✓ Synthetic volume test PASSED - 10x volume handled successfully');
        } finally {
          await pool.end();
        }
      } finally {
        // Cleanup synthetic dump file
        if (fs.existsSync(syntheticDumpPath)) {
          fs.unlinkSync(syntheticDumpPath);
        }

        // Cleanup report directory
        try {
          const files = fs.readdirSync(reportDir);
          for (const file of files) {
            fs.unlinkSync(path.join(reportDir, file));
          }
          fs.rmdirSync(reportDir);
        } catch (err) {
          console.warn('[SYNTHETIC VOLUME TEST] Report cleanup failed');
        }
      }
    });
  });
});
