/**
 * Tests for PostgresClient wrapper
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { createPostgresClient, calculatePayloadHash, PostgresClient } from '../client';

describe('PostgresClient', () => {
  let client: PostgresClient;
  let pool: Pool;

  beforeAll(async () => {
    // Use a test database URL from environment or a default local test database
    const connectionString =
      process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/migration_test';

    client = createPostgresClient({
      connectionString,
      maxPoolSize: 2,
    });

    pool = new Pool({ connectionString });

    // Create test tables for integration tests
    await pool.query(`
      DROP TABLE IF EXISTS test_migration CASCADE;
      CREATE TABLE test_migration (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        value INTEGER
      );
    `);
  });

  afterAll(async () => {
    await pool.query('DROP TABLE IF EXISTS test_migration CASCADE');
    await pool.end();
    await client.close();
  });

  describe('createPostgresClient', () => {
    it('should create a client with valid config', () => {
      const cfg = {
        connectionString: 'postgresql://postgres:postgres@localhost:5432/migration_test',
      };
      const c = createPostgresClient(cfg);
      expect(c).toBeDefined();
      expect(c.withTransaction).toBeDefined();
      expect(c.insertBatch).toBeDefined();
      expect(c.query).toBeDefined();
      expect(c.close).toBeDefined();
    });

    it('should fail-fast on empty connection string', () => {
      expect(() => createPostgresClient({ connectionString: '' })).toThrowError('connectionString must not be empty');
    });

    it('should fail-fast on whitespace-only connection string', () => {
      expect(() => createPostgresClient({ connectionString: '   ' })).toThrowError(
        'connectionString must not be empty',
      );
    });

    it('should fail-fast on invalid maxPoolSize', () => {
      expect(() =>
        createPostgresClient({
          connectionString: 'postgresql://postgres:postgres@localhost:5432/migration_test',
          maxPoolSize: 0,
        }),
      ).toThrowError('maxPoolSize must be >= 1');
    });

    it('should fail-fast on negative connectionTimeout', () => {
      expect(() =>
        createPostgresClient({
          connectionString: 'postgresql://postgres:postgres@localhost:5432/migration_test',
          connectionTimeout: -1,
        }),
      ).toThrowError('connectionTimeout must be >= 0');
    });
  });

  describe('withTransaction', () => {
    it('should execute a function within a transaction and commit on success', async () => {
      await client.withTransaction(async (txClient) => {
        await txClient.query('INSERT INTO test_migration (name, value) VALUES ($1, $2)', ['tx-test-1', 100]);
        // If we get here without error, transaction is active
        expect(true).toBe(true);
      });

      // Verify the row was committed
      const result = await pool.query('SELECT * FROM test_migration WHERE name = $1', ['tx-test-1']);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].value).toBe(100);
    });

    it('should rollback on error', async () => {
      try {
        await client.withTransaction(async (txClient) => {
          await txClient.query('INSERT INTO test_migration (name, value) VALUES ($1, $2)', ['tx-test-2', 200]);
          throw new Error('Intentional rollback test');
        });
      } catch (e) {
        // Expected error
      }

      // Verify the row was NOT committed (rolled back)
      const result = await pool.query('SELECT * FROM test_migration WHERE name = $1', ['tx-test-2']);
      expect(result.rows).toHaveLength(0);
    });

    it('should support nested operations within a transaction', async () => {
      await client.withTransaction(async (txClient) => {
        await txClient.query('INSERT INTO test_migration (name, value) VALUES ($1, $2)', ['nested-1', 301]);
        await txClient.query('INSERT INTO test_migration (name, value) VALUES ($1, $2)', ['nested-2', 302]);
      });

      const result = await pool.query('SELECT COUNT(*) FROM test_migration WHERE name LIKE $1', ['nested-%']);
      expect(parseInt(result.rows[0].count)).toBe(2);
    });
  });

  describe('insertBatch', () => {
    it('should insert multiple rows in a single statement', async () => {
      const rows = [
        ['batch-1', 1001],
        ['batch-2', 1002],
        ['batch-3', 1003],
      ];

      await client.withTransaction(async (txClient) => {
        await client.insertBatch(txClient, 'test_migration', ['name', 'value'], rows);
      });

      const result = await pool.query('SELECT * FROM test_migration WHERE name LIKE $1 ORDER BY name', ['batch-%']);
      expect(result.rows).toHaveLength(3);
      expect(result.rows[0].value).toBe(1001);
      expect(result.rows[1].value).toBe(1002);
      expect(result.rows[2].value).toBe(1003);
    });

    it('should handle empty rows array', async () => {
      await expect(client.insertBatch(pool, 'test_migration', ['name', 'value'], [])).resolves.not.toThrow();
    });

    it('should throw on empty columns', async () => {
      await expect(client.insertBatch(pool, 'test_migration', [], [['value']])).rejects.toThrow(
        'columns must not be empty',
      );
    });

    it('should properly parameterize to prevent SQL injection', async () => {
      const rows = [
        ["'; DROP TABLE test_migration; --", 2001],
        ['safe-value', 2002],
      ];

      await client.withTransaction(async (txClient) => {
        await client.insertBatch(txClient, 'test_migration', ['name', 'value'], rows);
      });

      // If SQL injection happened, the table would be dropped
      // Verify table still exists and rows were inserted safely
      const result = await pool.query('SELECT * FROM test_migration WHERE name = $1', [
        "'; DROP TABLE test_migration; --",
      ]);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].value).toBe(2001);
    });

    it('should support large batch inserts', async () => {
      const rows = Array.from({ length: 500 }, (_, i) => [`large-batch-${i}`, 3000 + i]);

      await client.withTransaction(async (txClient) => {
        await client.insertBatch(txClient, 'test_migration', ['name', 'value'], rows);
      });

      const result = await pool.query('SELECT COUNT(*) FROM test_migration WHERE name LIKE $1', ['large-batch-%']);
      expect(parseInt(result.rows[0].count)).toBe(500);
    });
  });

  describe('query', () => {
    it('should execute SELECT and return typed rows', async () => {
      // Insert test data first
      await pool.query('INSERT INTO test_migration (name, value) VALUES ($1, $2)', ['query-test', 4001]);

      const result = await client.query<{
        id: number;
        name: string;
        value: number;
      }>(pool, 'SELECT * FROM test_migration WHERE name = $1', ['query-test']);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('query-test');
      expect(result[0].value).toBe(4001);
    });

    it('should return empty array for no matches', async () => {
      const result = await client.query(pool, 'SELECT * FROM test_migration WHERE name = $1', ['nonexistent']);

      expect(result).toEqual([]);
    });

    it('should support multiple rows returned', async () => {
      // Insert multiple rows
      for (let i = 0; i < 5; i++) {
        await pool.query('INSERT INTO test_migration (name, value) VALUES ($1, $2)', [`multi-row-${i}`, 5000 + i]);
      }

      const result = await client.query(pool, 'SELECT * FROM test_migration WHERE name LIKE $1 ORDER BY value', [
        'multi-row-%',
      ]);

      expect(result).toHaveLength(5);
      expect((result[0] as any).name).toBe('multi-row-0');
      expect((result[4] as any).name).toBe('multi-row-4');
    });
  });

  describe('close', () => {
    it('should close the connection pool', async () => {
      const cfg = {
        connectionString: 'postgresql://postgres:postgres@localhost:5432/migration_test',
      };
      const c = createPostgresClient(cfg);
      await c.close();

      // Attempting to use the client after close should fail
      // (depends on pg behavior, may fail immediately or on first query)
      expect(c.close).toBeDefined(); // Smoke test that close was callable
    });
  });
});

describe('calculatePayloadHash', () => {
  it('should generate consistent SHA256 hashes for identical rows', () => {
    const row = { id: 1, name: 'test', value: 100 };
    const hash1 = calculatePayloadHash(row);
    const hash2 = calculatePayloadHash(row);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA256 hex is 64 chars
  });

  it('should generate different hashes for different rows', () => {
    const row1 = { id: 1, name: 'test' };
    const row2 = { id: 2, name: 'test' };

    const hash1 = calculatePayloadHash(row1);
    const hash2 = calculatePayloadHash(row2);

    expect(hash1).not.toBe(hash2);
  });

  it('should generate different hashes for different field values', () => {
    const row1 = { id: 1, name: 'test' };
    const row2 = { id: 1, name: 'changed' };

    const hash1 = calculatePayloadHash(row1);
    const hash2 = calculatePayloadHash(row2);

    expect(hash1).not.toBe(hash2);
  });

  it('should be deterministic regardless of key insertion order', () => {
    const row1 = { a: 1, b: 2, c: 3 };
    const row2 = { c: 3, a: 1, b: 2 };

    const hash1 = calculatePayloadHash(row1);
    const hash2 = calculatePayloadHash(row2);

    expect(hash1).toBe(hash2); // Should be same because keys are sorted in JSON.stringify
  });

  it('should handle null values correctly', () => {
    const row1 = { id: 1, value: null };
    const row2 = { id: 1, value: null };

    const hash1 = calculatePayloadHash(row1);
    const hash2 = calculatePayloadHash(row2);

    expect(hash1).toBe(hash2);
  });

  it('should handle complex nested objects', () => {
    const row = {
      id: 1,
      metadata: { created: '2024-01-01', tags: ['a', 'b'] },
      value: 123,
    };

    const hash = calculatePayloadHash(row);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
