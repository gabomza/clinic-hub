/**
 * Report module - Re-exports ReportBuilder and types
 *
 * Consolidates audit events from all migrators and generates
 * dual-format reports (JSON + Markdown) for human and machine consumption.
 *
 * Covers Requirements 8.1-8.6, 11.2
 * Reference: docs/specs/data-migration-script/design.md "ReportBuilder" section
 */

export {
  type AuditEvent,
  type TableMigrationSummary,
  type PatientMatchResult,
  type MigrationReport,
  type ReportBuilder,
  createReportBuilder,
} from './report-builder';
