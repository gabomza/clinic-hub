/**
 * Orchestrator module
 *
 * Coordinates the overall migration process across all modules.
 * Only re-exports public interfaces from migrator-orchestrator.
 */

export type { MigrationOrchestrator, MigrationOrchestrationResult } from './migrator-orchestrator';
export { createMigrationOrchestrator } from './migrator-orchestrator';
