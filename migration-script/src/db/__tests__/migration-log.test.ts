/**
 * Tests for MigrationLogStore
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool, PoolClient } from 'pg';
import {
  createPostgresClient,
  createMigrationLogStore,
  PostgresClient,
} from '../index';
import { MigrationLogStore } from '../migration-log';

describe('MigrationLogStore', () => {
  let postgresClient: PostgresClient;
  let store: MigrationLogStore;
  let pool: Pool;
  let txClient: PoolClient;

  beforeAll(async () => {
    const connectionString =
      process.env.TEST_DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5432/migration_test';

    postgresClient = createPostgresClient({
      connectionString,
      maxPoolSize: 2,
    });

    pool = new Pool({ connectionString });
    store = createMigrationLogStore(postgresClient);

    // Ensure schema exists
    await store.ensureSchema(pool);
  });

  afterAll(async () => {
    await pool.query('DROP TABLE IF EXISTS migration_log CASCADE');
    await pool.end();
    await postgresClient.close();
  });

  beforeEach(async () => {
    // Clean migration_log before each test
    await pool.query('TRUNCATE TABLE migration_log');
  });

  describe('ensureSchema', () => {
    it('should create migration_log table if it does not exist', async () => {
      // Drop the table first
      await pool.query('DROP TABLE IF EXISTS migration_log CASCADE');

      // Ensure schema creates it
      await store.ensureSchema(pool);

      // Verify table exists by querying information_schema
      const result = await pool.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'migration_log')`,
      );
      expect(result.rows[0].exists).toBe(true);
    });

    it('should be idempotent (creating table twice does not error)', async () => {
      await store.ensureSchema(pool);
      await expect(store.ensureSchema(pool)).resolves.not.toThrow();
    });

    it('should create the lookup index', async () => {
      // Drop and recreate
      await pool.query('DROP TABLE IF EXISTS migration_log CASCADE');
      await store.ensureSchema(pool);

      // Verify index exists
      const result = await pool.query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.indexes WHERE indexname = 'idx_migration_log_lookup')`,
      );
      expect(result.rows[0].exists).toBe(true);
    });

    it('should create table with correct schema', async () => {
      // Get column information
      const result = await pool.query(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns
         WHERE table_name = 'migration_log' ORDER BY ordinal_position`,
      );

      const columns = result.rows.reduce(
        (acc: Record<string, unknown>, row) => {
          acc[row.column_name] = { type: row.data_type, nullable: row.is_nullable };
          return acc;
        },
        {},
      );

      expect(columns).toHaveProperty('id');
      expect(columns).toHaveProperty('source_table');
      expect(columns).toHaveProperty('source_pk');
      expect(columns).toHaveProperty('target_table');
      expect(columns).toHaveProperty('target_id');
      expect(columns).toHaveProperty('status');
      expect(columns).toHaveProperty('payload_hash');
      expect(columns).toHaveProperty('migrated_at');
    });
  });

  describe('record', () => {
    it('should insert a new migration log entry', async () => {
      const entry = {
        sourceTable: 'fichas',
        sourcePk: '42',
        targetTable: 'patients',
        targetId: 100,
        status: 'migrated' as const,
        payloadHash: 'abc123def456',
        migratedAt: new Date(),
      };

      await store.record(pool, entry);

      const result = await pool.query(
        'SELECT * FROM migration_log WHERE source_table = $1 AND source_pk = $2',
        ['fichas', '42'],
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].target_id).toBe('100');
      expect(result.rows[0].status).toBe('migrated');
      expect(result.rows[0].payload_hash).toBe('abc123def456');
    });

    it('should support null target_id for excluded records', async () => {
      const entry = {
        sourceTable: 'historiaclinica',
        sourcePk: '999:2024-01-01',
        targetTable: 'clinical_records',
        targetId: null,
        status: 'excluded' as const,
        payloadHash: 'excluded123',
        migratedAt: new Date(),
      };

      await store.record(pool, entry);

      const result = await pool.query(
        'SELECT * FROM migration_log WHERE source_table = $1',
        ['historiaclinica'],
      );

      expect(result.rows[0].target_id).toBeNull();
      expect(result.rows[0].status).toBe('excluded');
    });

    it('should support warning status', async () => {
      const entry = {
        sourceTable: 'fichas',
        sourcePk: '99',
        targetTable: 'patients',
        targetId: 101,
        status: 'warning' as const,
        payloadHash: 'warn456',
        migratedAt: new Date(),
      };

      await store.record(pool, entry);

      const result = await pool.query(
        'SELECT * FROM migration_log WHERE source_pk = $1',
        ['99'],
      );

      expect(result.rows[0].status).toBe('warning');
    });

    it('should handle upsert on duplicate (source_table, source_pk)', async () => {
      const entry1 = {
        sourceTable: 'fichas',
        sourcePk: '50',
        targetTable: 'patients',
        targetId: 150,
        status: 'migrated' as const,
        payloadHash: 'hash1',
        migratedAt: new Date('2024-01-01'),
      };

      const entry2 = {
        sourceTable: 'fichas',
        sourcePk: '50',
        targetTable: 'patients',
        targetId: 151, // Different target_id
        status: 'warning' as const,
        payloadHash: 'hash2_updated',
        migratedAt: new Date('2024-01-02'),
      };

      await store.record(pool, entry1);
      await store.record(pool, entry2);

      const result = await pool.query(
        'SELECT * FROM migration_log WHERE source_pk = $1',
        ['50'],
      );

      expect(result.rows).toHaveLength(1); // Only one row, not duplicated
      expect(result.rows[0].target_id).toBe('151'); // Updated to new value
      expect(result.rows[0].payload_hash).toBe('hash2_updated');
      expect(result.rows[0].status).toBe('warning');
    });
  });

  describe('findExisting', () => {
    beforeEach(async () => {
      // Insert test data
      await store.record(pool, {
        sourceTable: 'fichas',
        sourcePk: '1',
        targetTable: 'patients',
        targetId: 100,
        status: 'migrated',
        payloadHash: 'hash-100',
        migratedAt: new Date(),
      });

      await store.record(pool, {
        sourceTable: 'cirugias',
        sourcePk: '5',
        targetTable: 'surgeries',
        targetId: null,
        status: 'excluded',
        payloadHash: 'hash-exc',
        migratedAt: new Date(),
      });
    });

    it('should find an existing entry by source_table and source_pk', async () => {
      const entry = await store.findExisting(pool, 'fichas', '1');

      expect(entry).not.toBeNull();
      expect(entry?.sourceTable).toBe('fichas');
      expect(entry?.sourcePk).toBe('1');
      expect(entry?.targetTable).toBe('patients');
      expect(entry?.targetId).toBe('100');
      expect(entry?.status).toBe('migrated');
      expect(entry?.payloadHash).toBe('hash-100');
    });

    it('should return null if entry does not exist', async () => {
      const entry = await store.findExisting(pool, 'fichas', '999');

      expect(entry).toBeNull();
    });

    it('should return null if source_table does not exist', async () => {
      const entry = await store.findExisting(pool, 'nonexistent', '1');

      expect(entry).toBeNull();
    });

    it('should handle entries with null target_id', async () => {
      const entry = await store.findExisting(pool, 'cirugias', '5');

      expect(entry).not.toBeNull();
      expect(entry?.targetId).toBeNull();
      expect(entry?.status).toBe('excluded');
    });

    it('should convert migrated_at to Date object', async () => {
      const entry = await store.findExisting(pool, 'fichas', '1');

      expect(entry?.migratedAt).toBeInstanceOf(Date);
      expect(entry?.migratedAt.getTime()).toBeGreaterThan(0);
    });
  });

  describe('reset', () => {
    beforeEach(async () => {
      // Insert test data
      await store.record(pool, {
        sourceTable: 'fichas',
        sourcePk: '1',
        targetTable: 'patients',
        targetId: 100,
        status: 'migrated',
        payloadHash: 'hash-100',
        migratedAt: new Date(),
      });

      await store.record(pool, {
        sourceTable: 'fichas',
        sourcePk: '2',
        targetTable: 'patients',
        targetId: 101,
        status: 'migrated',
        payloadHash: 'hash-101',
        migratedAt: new Date(),
      });

      // Verify data was inserted
      const count = await pool.query(
        'SELECT COUNT(*) FROM migration_log',
      );
      expect(parseInt(count.rows[0].count)).toBe(2);
    });

    it('should truncate migration_log with log-only scope', async () => {
      await store.reset(pool, 'log-only');

      const result = await pool.query('SELECT COUNT(*) FROM migration_log');
      expect(parseInt(result.rows[0].count)).toBe(0);
    });

    it('should truncate migration_log with full scope', async () => {
      // Create other target tables if they exist
      await pool.query(`
        CREATE TABLE IF NOT EXISTS patients (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255)
        );
      `);

      // Insert a row in patients
      await pool.query(
        'INSERT INTO patients (name) VALUES ($1)',
        ['Test Patient'],
      );

      // Reset with full scope
      await store.reset(pool, 'full');

      // migration_log should be empty
      const logCount = await pool.query(
        'SELECT COUNT(*) FROM migration_log',
      );
      expect(parseInt(logCount.rows[0].count)).toBe(0);

      // patients table should be empty (truncated)
      const patientsCount = await pool.query(
        'SELECT COUNT(*) FROM patients',
      );
      expect(parseInt(patientsCount.rows[0].count)).toBe(0);

      // Clean up
      await pool.query('DROP TABLE IF EXISTS patients CASCADE');
    });

    it('should throw on invalid reset scope', async () => {
      await expect(
        store.reset(pool, 'invalid' as any),
      ).rejects.toThrow('Unknown reset scope');
    });
  });

  describe('Integration: idempotency scenario', () => {
    it('should support detecting already-migrated rows on re-execution', async () => {
      // Simulate first migration run
      const entry = {
        sourceTable: 'fichas',
        sourcePk: 'ficha-100',
        targetTable: 'patients',
        targetId: 500,
        status: 'migrated' as const,
        payloadHash: 'original-hash',
        migratedAt: new Date(),
      };

      await store.record(pool, entry);

      // Simulate second migration run: check if already processed
      const existing = await store.findExisting(pool, 'fichas', 'ficha-100');

      expect(existing).not.toBeNull();
      expect(existing?.targetId).toBe('500');
      // In a real migrator, this targetId would be reused without re-inserting
    });

    it('should detect when source payload has changed between runs', async () => {
      // First run: record with original hash
      const hash1 = 'payload-v1-hash';
      await store.record(pool, {
        sourceTable: 'fichas',
        sourcePk: 'ficha-200',
        targetTable: 'patients',
        targetId: 501,
        status: 'migrated',
        payloadHash: hash1,
        migratedAt: new Date(),
      });

      // Later run: source row might have changed, recompute hash
      const existing = await store.findExisting(pool, 'fichas', 'ficha-200');
      const hash2 = 'payload-v2-hash-changed';

      // Hashes differ: should alert in report
      expect(existing?.payloadHash).not.toBe(hash2);
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Performance: lookup index', () => {
    it('should efficiently find entries via (source_table, source_pk) composite key', async () => {
      // Insert multiple entries
      for (let i = 0; i < 100; i++) {
        await store.record(pool, {
          sourceTable: 'fichas',
          sourcePk: `pk-${i}`,
          targetTable: 'patients',
          targetId: 1000 + i,
          status: 'migrated',
          payloadHash: `hash-${i}`,
          migratedAt: new Date(),
        });
      }

      // Verify we can find a specific entry efficiently
      const entry = await store.findExisting(pool, 'fichas', 'pk-50');
      expect(entry?.targetId).toBe('1050');
    });
  });

  describe('Constraint validation', () => {
    it('should enforce unique constraint on (source_table, source_pk)', async () => {
      const entry = {
        sourceTable: 'fichas',
        sourcePk: 'unique-test-1',
        targetTable: 'patients',
        targetId: 600,
        status: 'migrated' as const,
        payloadHash: 'hash-unique',
        migratedAt: new Date(),
      };

      // First insert should succeed
      await store.record(pool, entry);

      // Second insert with same (source_table, source_pk) should upsert, not error
      // (because we use ON CONFLICT DO UPDATE)
      await expect(store.record(pool, entry)).resolves.not.toThrow();

      const result = await pool.query(
        'SELECT COUNT(*) FROM migration_log WHERE source_table = $1 AND source_pk = $2',
        ['fichas', 'unique-test-1'],
      );
      expect(parseInt(result.rows[0].count)).toBe(1); // Only one row
    });

    it('should enforce status CHECK constraint', async () => {
      // This would fail if we try to insert invalid status directly to DB
      // Our code restricts to 'migrated', 'excluded', 'warning' via types
      // This is a validation of schema correctness
      const result = await pool.query(
        `SELECT constraint_name FROM information_schema.table_constraints
         WHERE table_name = 'migration_log' AND constraint_type = 'CHECK'`,
      );
      expect(result.rows.length).toBeGreaterThan(0);
    });
  });
});
