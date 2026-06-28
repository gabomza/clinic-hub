/**
 * Integration tests for PostgreSQL database layer
 *
 * These tests require a PostgreSQL database running.
 * Set TEST_DATABASE_URL environment variable to connect to a test database.
 *
 * Example setup:
 *   docker run --rm -d -e POSTGRES_HOST_AUTH_METHOD=trust \
 *     -p 5432:5432 postgres:latest
 *   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/postgres npm test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import {
  createPostgresClient,
  createMigrationLogStore,
  PostgresClient,
  MigrationLogStore,
  MigrationLogEntry,
} from '../index';

describe('Database Integration Tests', () => {
  let postgresClient: PostgresClient;
  let store: MigrationLogStore;
  let pool: Pool;

  beforeAll(async () => {
    const connectionString =
      process.env.TEST_DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5432/migration_test';

    postgresClient = createPostgresClient({
      connectionString,
      maxPoolSize: 5,
    });

    pool = new Pool({ connectionString });

    // Initialize store
    store = createMigrationLogStore(postgresClient);

    // Setup: create migration_log table
    await store.ensureSchema(pool);
  });

  afterAll(async () => {
    await pool.query('DROP TABLE IF EXISTS migration_log CASCADE');
    await pool.end();
    await postgresClient.close();
  });

  describe('Full workflow: record and retrieve', () => {

    it('should complete a full record-retrieve cycle', async () => {
      // Record a migration
      const entry = {
        sourceTable: 'fichas',
        sourcePk: 'ficha-1',
        targetTable: 'patients',
        targetId: 100,
        status: 'migrated' as const,
        payloadHash: 'hash-abc123',
        migratedAt: new Date(),
      };

      await store.record(pool, entry);

      // Retrieve it
      const retrieved = await store.findExisting(pool, 'fichas', 'ficha-1');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.targetId).toBe('100');
      expect(retrieved?.status).toBe('migrated');
      expect(retrieved?.payloadHash).toBe('hash-abc123');
    });
  });

  describe('Transaction safety', () => {
    beforeAll(async () => {
      await store.reset(pool, 'log-only');
    });

    it('should maintain data consistency with transactions', async () => {
      const entries = [
        {
          sourceTable: 'fichas',
          sourcePk: 'tx-1',
          targetTable: 'patients',
          targetId: 200,
          status: 'migrated' as const,
          payloadHash: 'tx-hash-1',
          migratedAt: new Date(),
        },
        {
          sourceTable: 'fichas',
          sourcePk: 'tx-2',
          targetTable: 'patients',
          targetId: 201,
          status: 'migrated' as const,
          payloadHash: 'tx-hash-2',
          migratedAt: new Date(),
        },
      ];

      // Record both entries within a transaction
      await postgresClient.withTransaction(async (txClient) => {
        for (const entry of entries) {
          await store.record(txClient, entry);
        }
      });

      // Verify both are committed
      const result = await pool.query(
        'SELECT COUNT(*) FROM migration_log WHERE source_table = $1',
        ['fichas'],
      );
      expect(parseInt((result.rows[0] as any).count)).toBe(2);
    });

    it('should rollback on transaction error', async () => {
      const entry = {
        sourceTable: 'cirugias',
        sourcePk: 'circ-1',
        targetTable: 'surgeries',
        targetId: 300,
        status: 'migrated' as const,
        payloadHash: 'circ-hash',
        migratedAt: new Date(),
      };

      // Try to record within a transaction that fails
      try {
        await postgresClient.withTransaction(async (txClient) => {
          await store.record(txClient, entry);
          throw new Error('Simulated failure');
        });
      } catch (e) {
        // Expected
      }

      // Verify entry was rolled back
      const result = await pool.query(
        'SELECT COUNT(*) FROM migration_log WHERE source_table = $1',
        ['cirugias'],
      );
      expect(parseInt((result.rows[0] as any).count)).toBe(0);
    });
  });

  describe('Batch operations', () => {
    beforeAll(async () => {
      await store.reset(pool, 'log-only');
    });

    it('should handle batch inserts efficiently', async () => {
      // Create a test table
      await pool.query(`
        DROP TABLE IF EXISTS test_batch;
        CREATE TABLE test_batch (
          id SERIAL,
          source_id TEXT NOT NULL,
          value INTEGER
        );
      `);

      // Insert batch of rows
      const rows = Array.from({ length: 100 }, (_, i) => [
        `src-${i}`,
        1000 + i,
      ]);

      await postgresClient.withTransaction(async (txClient) => {
        await postgresClient.insertBatch(
          txClient,
          'test_batch',
          ['source_id', 'value'],
          rows,
        );
      });

      // Verify all rows were inserted
      const result = await pool.query('SELECT COUNT(*) FROM test_batch');
      expect(parseInt((result.rows[0] as any).count)).toBe(100);

      // Cleanup
      await pool.query('DROP TABLE test_batch');
    });
  });

  describe('Reset operations', () => {

    it('should support log-only reset', async () => {
      // Insert entries
      for (let i = 0; i < 5; i++) {
        await store.record(pool, {
          sourceTable: 'test',
          sourcePk: `pk-${i}`,
          targetTable: 'test_target',
          targetId: 400 + i,
          status: 'migrated',
          payloadHash: `hash-${i}`,
          migratedAt: new Date(),
        });
      }

      // Reset log-only
      await store.reset(pool, 'log-only');

      // Verify log is empty
      const result = await pool.query(
        'SELECT COUNT(*) FROM migration_log',
      );
      expect(parseInt((result.rows[0] as any).count)).toBe(0);
    });

    it('should support full reset', async () => {
      // Create a target table (if it exists in the reset list)
      // For this test, we just verify the log is cleared
      // (full reset would also truncate target tables)

      // Insert entries
      await store.record(pool, {
        sourceTable: 'test2',
        sourcePk: 'pk-full',
        targetTable: 'test_target',
        targetId: 500,
        status: 'migrated',
        payloadHash: 'hash-full',
        migratedAt: new Date(),
      });

      // Reset full (will try to truncate target tables if they exist)
      await store.reset(pool, 'full');

      // Verify log is empty
      const result = await pool.query(
        'SELECT COUNT(*) FROM migration_log',
      );
      expect(parseInt((result.rows[0] as any).count)).toBe(0);
    });
  });

  describe('Idempotency scenario', () => {
    beforeAll(async () => {
      await store.reset(pool, 'log-only');
    });

    it('should detect and reuse already-migrated rows', async () => {
      // First run: record a migration
      const entry: MigrationLogEntry = {
        sourceTable: 'fichas',
        sourcePk: 'idempotent-test-1',
        targetTable: 'patients',
        targetId: 600,
        status: 'migrated',
        payloadHash: 'original-hash',
        migratedAt: new Date(),
      };

      await store.record(pool, entry);

      // Second run (re-execution): check if already processed
      const existing = await store.findExisting(
        pool,
        'fichas',
        'idempotent-test-1',
      );

      expect(existing).not.toBeNull();
      expect(existing?.targetId).toBe('600');
      // In a real migrator, targetId would be reused without re-inserting
    });

    it('should detect when source payload changed', async () => {
      // First migration with hash v1
      const hash1 = 'source-payload-hash-v1';
      const entry: MigrationLogEntry = {
        sourceTable: 'fichas',
        sourcePk: 'hash-change-test',
        targetTable: 'patients',
        targetId: 601,
        status: 'migrated',
        payloadHash: hash1,
        migratedAt: new Date(),
      };
      await store.record(pool, entry);

      // Later: verify hash can be compared
      const existing = await store.findExisting(
        pool,
        'fichas',
        'hash-change-test',
      );

      const hash2 = 'source-payload-hash-v2-changed';
      expect(existing?.payloadHash).toBe(hash1);
      expect(existing?.payloadHash).not.toBe(hash2);
      // A migrator would detect this mismatch and alert
    });
  });

  describe('Error handling and edge cases', () => {
    beforeAll(async () => {
      await store.reset(pool, 'log-only');
    });

    it('should handle null target_id for excluded rows', async () => {
      const entry: MigrationLogEntry = {
        sourceTable: 'historiaclinica',
        sourcePk: 'hc-excluded-1',
        targetTable: 'clinical_records',
        targetId: null,
        status: 'excluded',
        payloadHash: 'excluded-hash',
        migratedAt: new Date(),
      };

      await store.record(pool, entry);

      const retrieved = await store.findExisting(
        pool,
        'historiaclinica',
        'hc-excluded-1',
      );
      expect(retrieved?.targetId).toBeNull();
      expect(retrieved?.status).toBe('excluded');
    });

    it('should handle complex source_pk values', async () => {
      // Composite key example (historiaclinica uses id:date format)
      const compositePk = 'hc-id:2024-01-15T10:30:00Z';
      const entry: MigrationLogEntry = {
        sourceTable: 'historiaclinica',
        sourcePk: compositePk,
        targetTable: 'clinical_records',
        targetId: 700,
        status: 'migrated',
        payloadHash: 'composite-hash',
        migratedAt: new Date(),
      };

      await store.record(pool, entry);

      const retrieved = await store.findExisting(
        pool,
        'historiaclinica',
        compositePk,
      );
      expect(retrieved).not.toBeNull();
      expect(retrieved?.sourcePk).toBe(compositePk);
    });

    it('should handle large payload hashes', async () => {
      // SHA256 produces 64-char hex strings
      const largeHash = 'a'.repeat(64);
      const entry: MigrationLogEntry = {
        sourceTable: 'test_hash',
        sourcePk: 'hash-test-1',
        targetTable: 'test_target',
        targetId: 800,
        status: 'migrated',
        payloadHash: largeHash,
        migratedAt: new Date(),
      };

      await store.record(pool, entry);

      const retrieved = await store.findExisting(
        pool,
        'test_hash',
        'hash-test-1',
      );
      expect(retrieved?.payloadHash).toBe(largeHash);
    });
  });
});
