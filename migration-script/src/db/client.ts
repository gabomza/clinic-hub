/**
 * PostgreSQL Client Wrapper
 *
 * Provides a delgado wrapper over pg.Pool with transaction support,
 * parametrized batch inserts, and type-safe query execution.
 */

import { Pool, PoolClient } from 'pg';
import crypto from 'crypto';

export type PostgresClientConfig = {
  /** PostgreSQL connection string */
  connectionString: string;
  /** Maximum pool size (default: 10) */
  maxPoolSize?: number;
  /** Connection timeout in milliseconds (default: 5000) */
  connectionTimeout?: number;
};

export type PostgresClient = {
  /**
   * Execute a function within an explicit transaction.
   * Provides a PoolClient bound to the transaction.
   * Automatically commits on success, rolls back on error.
   */
  withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;

  /**
   * Insert multiple rows in a single batched INSERT statement.
   * Constructs a parametrized INSERT with multi-VALUES syntax.
   * Respects insertBatchSize for large row sets.
   */
  insertBatch(
    client: PoolClient | Pool,
    table: string,
    columns: string[],
    rows: unknown[][],
  ): Promise<void>;

  /**
   * Execute a SELECT query with type safety.
   * Returns an array of rows matching the generic type.
   */
  query<T>(
    client: PoolClient | Pool,
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;

  /** Close the connection pool */
  close(): Promise<void>;
};

/**
 * Internal type for testing: provides access to the Pool for direct queries
 */
export type PostgresClientWithPool = PostgresClient & {
  _getPool(): Pool;
};

/**
 * Create a PostgreSQL client instance.
 * Validates configuration and initializes the pool.
 */
export function createPostgresClient(
  config: PostgresClientConfig,
): PostgresClientWithPool {
  // Fail-fast validation
  if (!config.connectionString || config.connectionString.trim() === '') {
    throw new Error(
      'PostgresClientConfig.connectionString must not be empty',
    );
  }

  if (config.maxPoolSize !== undefined && config.maxPoolSize < 1) {
    throw new Error('PostgresClientConfig.maxPoolSize must be >= 1');
  }

  if (config.connectionTimeout !== undefined && config.connectionTimeout < 0) {
    throw new Error('PostgresClientConfig.connectionTimeout must be >= 0');
  }

  const pool = new Pool({
    connectionString: config.connectionString,
    max: config.maxPoolSize ?? 10,
    idleTimeoutMillis: config.connectionTimeout ?? 5000,
    connectionTimeoutMillis: config.connectionTimeout ?? 5000,
  });

  return {
    async withTransaction<T>(
      fn: (client: PoolClient) => Promise<T>,
    ): Promise<T> {
      const client = await pool.connect();
      try {
        await (client as any).query('BEGIN');
        const result = await fn(client);
        await (client as any).query('COMMIT');
        return result;
      } catch (error) {
        await (client as any).query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },

    async insertBatch(
      client: PoolClient | Pool,
      table: string,
      columns: string[],
      rows: unknown[][],
    ): Promise<void> {
      if (rows.length === 0) {
        return;
      }

      if (columns.length === 0) {
        throw new Error('insertBatch: columns must not be empty');
      }

      // Build multi-VALUES INSERT statement with parameters
      const valuesSets = rows
        .map((_, rowIdx) => {
          const start = rowIdx * columns.length + 1;
          return `(${Array.from({ length: columns.length }, (_, i) => `$${start + i}`).join(', ')})`;
        })
        .join(', ');

      const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${valuesSets}`;

      // Flatten rows into a single parameter array
      const params = rows.flat();

      await (client as any).query(sql, params);
    },

    async query<T>(
      client: PoolClient | Pool,
      sql: string,
      params?: unknown[],
    ): Promise<T[]> {
      const result = await (client as any).query(sql, params);
      return result.rows as T[];
    },

    async close(): Promise<void> {
      await pool.end();
    },

    _getPool(): Pool {
      return pool;
    },
  };
}

/**
 * Calculate SHA256 hash of a normalized row.
 * Used for detecting if a migrated row's source content changed.
 */
export function calculatePayloadHash(row: Record<string, unknown>): string {
  // Normalize the row to JSON for consistent hashing
  const normalized = JSON.stringify(row, Object.keys(row).sort());
  return crypto.createHash('sha256').update(normalized).digest('hex');
}
