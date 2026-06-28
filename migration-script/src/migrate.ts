/**
 * Main entry point for the data migration script
 *
 * This script orchestrates the migration of data from MySQL to PostgreSQL (Supabase).
 *
 * Usage:
 *   node migrate.ts --dump-file <path> [--reset <full|log-only>] [--match-threshold <0-1>] [--match-min-threshold <0-1>]
 *
 * Environment variables:
 *   DATABASE_URL: PostgreSQL connection string (required)
 *   DUMP_FILE_PATH: Path to MySQL dump file (optional, overridden by --dump-file)
 *   RESET_MODE: 'full' or 'log-only' (optional, default: log-only)
 *   MATCH_CONFIDENCE_THRESHOLD: Patient matching threshold (optional, default: 0.92)
 *   MATCH_MIN_CONSIDERATION_THRESHOLD: Minimum consideration threshold (optional, default: 0.75)
 *   REPORT_OUTPUT_DIR: Output directory for reports (optional, default: ./reports)
 *   INSERT_BATCH_SIZE: Batch size for inserts (optional, default: 500)
 */

import { loadConfig } from './config/index';
import { createMigrationOrchestrator } from './orchestrator/index';

async function main(): Promise<void> {
  try {
    // Parse CLI arguments and environment variables
    const config = loadConfig(process.argv.slice(2), process.env);

    console.log('='.repeat(60));
    console.log('DATA MIGRATION SCRIPT - MySQL to PostgreSQL (Supabase)');
    console.log('='.repeat(60));
    console.log('');

    // Create orchestrator and run migration
    const orchestrator = createMigrationOrchestrator();
    const result = await orchestrator.run(config);

    console.log('');

    if (result.success && result.reportPaths) {
      console.log('✅ Migration completed successfully');
      console.log(`   JSON report: ${result.reportPaths.jsonPath}`);
      console.log(`   Markdown report: ${result.reportPaths.mdPath}`);
      if (result.executionTimeMs) {
        console.log(`   Execution time: ${(result.executionTimeMs / 1000).toFixed(2)}s`);
      }
      console.log('');
      console.log('Review the reports for detailed migration audit information.');
      process.exit(0);
    } else {
      console.error('❌ Migration failed');
      if (result.error) {
        console.error(`   Error: ${result.error}`);
      }
      if (result.executionTimeMs) {
        console.error(`   Execution time: ${(result.executionTimeMs / 1000).toFixed(2)}s`);
      }
      console.error('');
      console.error('Review the error details above for more information.');
      process.exit(1);
    }
  } catch (error) {
    console.error('Fatal error during migration setup:');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
