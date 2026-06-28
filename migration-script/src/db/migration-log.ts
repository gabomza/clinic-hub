/**
 * Migration Log Store
 *
 * Manages the migration_log table for idempotent re-execution tracking.
 * Records which source rows have been migrated, to which target, and their status.
 */

import { PoolClient, Pool } from 'pg';
import { PostgresClient, calculatePayloadHash } from './client';

export type MigrationLogEntry = {
  sourceTable: string;
  sourcePk: string;
  targetTable: string;
  targetId: number | string | null;
  status: 'migrated' | 'excluded' | 'warning';
  payloadHash: string;
  migratedAt: Date;
};

export type MigrationLogStore = {
  /**
   * Create the migration_log table if it doesn't exist (idempotent).
   * Also creates the lookup index.
   */
  ensureSchema(client: PoolClient | Pool): Promise<void>;

  /**
   * Find an existing migration log entry by source table and primary key.
   * Returns null if not found.
   */
  findExisting(
    client: PoolClient | Pool,
    sourceTable: string,
    sourcePk: string,
  ): Promise<MigrationLogEntry | null>;

  /**
   * Record a migration result (new entry or update).
   * Throws if a unique constraint violation occurs (duplicate source_table, source_pk).
   */
  record(
    client: PoolClient | Pool,
    entry: MigrationLogEntry,
  ): Promise<void>;

  /**
   * Reset the migration log.
   * 'log-only': truncate only migration_log
   * 'full': truncate migration_log and clear target tables (requires schema knowledge)
   */
  reset(
    client: PoolClient | Pool,
    scope: 'log-only' | 'full',
  ): Promise<void>;
};

const MIGRATION_LOG_DDL = `
CREATE TABLE IF NOT EXISTS migration_log (
  id SERIAL PRIMARY KEY,
  source_table VARCHAR(255) NOT NULL,
  source_pk VARCHAR(255) NOT NULL,
  target_table VARCHAR(255) NOT NULL,
  target_id TEXT,
  status VARCHAR(50) NOT NULL CHECK (status IN ('migrated', 'excluded', 'warning')),
  payload_hash VARCHAR(64) NOT NULL,
  migrated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_table, source_pk)
);

CREATE INDEX IF NOT EXISTS idx_migration_log_lookup
  ON migration_log (source_table, source_pk);
`;

/**
 * Create a migration log store backed by PostgreSQL.
 */
export function createMigrationLogStore(
  _client: PostgresClient,
): MigrationLogStore {
  return {
    async ensureSchema(client: PoolClient | Pool): Promise<void> {
      // Split DDL into separate statements and execute each
      const statements = MIGRATION_LOG_DDL.split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const statement of statements) {
        await (client as any).query(statement);
      }
    },

    async findExisting(
      client: PoolClient | Pool,
      sourceTable: string,
      sourcePk: string,
    ): Promise<MigrationLogEntry | null> {
      const result = await (client as any).query(
        `
        SELECT source_table, source_pk, target_table, target_id, status, payload_hash, migrated_at
        FROM migration_log
        WHERE source_table = $1 AND source_pk = $2
        LIMIT 1
      `,
        [sourceTable, sourcePk],
      );

      if (result.length === 0) {
        return null;
      }

      const row = result[0];
      return {
        sourceTable: row.source_table,
        sourcePk: row.source_pk,
        targetTable: row.target_table,
        targetId: row.target_id,
        status: row.status,
        payloadHash: row.payload_hash,
        migratedAt: new Date(row.migrated_at),
      };
    },

    async record(
      client: PoolClient | Pool,
      entry: MigrationLogEntry,
    ): Promise<void> {
      await (client as any).query(
        `
        INSERT INTO migration_log (source_table, source_pk, target_table, target_id, status, payload_hash)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (source_table, source_pk) DO UPDATE SET
          target_id = $4,
          status = $5,
          payload_hash = $6,
          migrated_at = CURRENT_TIMESTAMP
      `,
        [
          entry.sourceTable,
          entry.sourcePk,
          entry.targetTable,
          entry.targetId,
          entry.status,
          entry.payloadHash,
        ],
      );
    },

    async reset(
      client: PoolClient | Pool,
      scope: 'log-only' | 'full',
    ): Promise<void> {
      if (scope === 'log-only') {
        await (client as any).query('TRUNCATE TABLE migration_log');
      } else if (scope === 'full') {
        // Truncate both migration_log and all target tables with CASCADE
        // to handle any foreign key dependencies
        const targetTables = [
          'cash_entries',
          'surgery_applied_techniques',
          'surgeries',
          'surgery_diagnoses',
          'body_parts',
          'surgery_techniques',
          'clinical_records',
          'appointments',
          'patients',
          'migration_log',
        ];

        for (const table of targetTables) {
          await (client as any).query(`TRUNCATE TABLE IF EXISTS ${table} CASCADE`);
        }
      } else {
        throw new Error(`Unknown reset scope: ${scope}`);
      }
    },
  };
}
