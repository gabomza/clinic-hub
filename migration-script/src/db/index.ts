/**
 * Database module
 *
 * Handles PostgreSQL connections and database operations.
 * Re-exports only: client implementations should import directly.
 */

export type { PostgresClient, PostgresClientConfig } from './client';
export { createPostgresClient, calculatePayloadHash } from './client';

export type { MigrationLogEntry, MigrationLogStore } from './migration-log';
export { createMigrationLogStore } from './migration-log';
