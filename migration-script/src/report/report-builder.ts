/**
 * ReportBuilder: Consolidates migration audit events and generates dual-format reports
 *
 * Implements Requirement 8 (auditable migration report) and 11.2 (explicitly excluded tables).
 * Produces:
 * - JSON report (machine-readable, structured, queryable)
 * - Markdown report (human-readable summary with dedicated sections)
 *
 * Both reports include timestamp to prevent accidental overwrites (Requirement 8.5).
 *
 * Reference: docs/specs/data-migration-script/design.md "ReportBuilder" section
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Audit event emitted by a migrator during processing.
 * Requirement 8.1, 8.2, 8.3
 */
export type AuditEvent = {
  type: 'success' | 'error' | 'warning' | 'skipped' | 'auto_linked' | 'manual_review' | 'no_match';
  table: string;
  sourceId: number | string;
  targetId?: number | string;
  message: string;
  timestamp: Date;
  details?: Record<string, unknown>;
};

/**
 * Summary of migration for a single table.
 * Requirement 8.2
 */
export type TableMigrationSummary = {
  tableName: string;
  migrated: number;
  reused: number;
  excluded: number;
  omitted: number;
  errors: number;
  warnings: number;
};

/**
 * Patient matching result grouped by outcome.
 * Requirement 8.2, 8.4
 */
export type PatientMatchResult = {
  outcome: 'auto_linked' | 'manual_review' | 'no_match';
  count: number;
  examples: Array<{ sourceName: string; score?: number; candidates?: string[] }>;
};

/**
 * Complete migration report.
 * Requirement 8.1, 8.4, 8.5
 */
export type MigrationReport = {
  startedAt: Date;
  completedAt: Date;
  duration: number; // milliseconds
  summaryByTable: Record<string, TableMigrationSummary>;
  excludedTables: Array<{ name: string; reason: string }>;
  patientMatching: {
    autoLinked: PatientMatchResult;
    manualReview: PatientMatchResult;
    noMatch: PatientMatchResult;
    possibleDuplicatesInTarget: Array<{ candidates: string[]; score: number }>;
  };
  errors: AuditEvent[];
  warnings: AuditEvent[];
};

/**
 * ReportBuilder interface: accumulates events and produces reports.
 * Requirement 8.1-8.6, 11.2
 */
export type ReportBuilder = {
  addTableSummary(summary: TableMigrationSummary): void;
  addExcludedTable(name: string, reason: string): void;
  addDuplicatePatientPairs(
    pairs: Array<{ candidates: string[]; score: number }>,
  ): void;
  addAuditEvent(event: AuditEvent): void;
  build(runStartedAt: Date): MigrationReport;
  writeToDisk(report: MigrationReport, reportDir: string): Promise<{
    jsonPath: string;
    mdPath: string;
  }>;
};

/**
 * Creates a new ReportBuilder instance.
 * Accumulates events from all migrators during a run and consolidates them
 * into a structured, dual-format report (JSON + Markdown).
 *
 * Requirement 8.1-8.6, 11.2
 */
export function createReportBuilder(): ReportBuilder {
  // Internal state
  const tableSummaries: Map<string, TableMigrationSummary> = new Map();
  const excludedTablesList: Array<{ name: string; reason: string }> = [];
  const duplicatePairsList: Array<{ candidates: string[]; score: number }> = [];
  const auditEvents: AuditEvent[] = [];

  // Categorized events for quick lookup
  const errorEvents: AuditEvent[] = [];
  const warningEvents: AuditEvent[] = [];
  const patientMatchingEvents: Map<
    'auto_linked' | 'manual_review' | 'no_match',
    AuditEvent[]
  > = new Map([
    ['auto_linked', []],
    ['manual_review', []],
    ['no_match', []],
  ]);

  /**
   * Add a table migration summary.
   * Requirement 8.2
   */
  function addTableSummary(summary: TableMigrationSummary): void {
    tableSummaries.set(summary.tableName, summary);
  }

  /**
   * Register an explicitly excluded table with reason.
   * Requirement 11.2
   */
  function addExcludedTable(name: string, reason: string): void {
    excludedTablesList.push({ name, reason });
  }

  /**
   * Register possible duplicate patient pairs detected in destination.
   * Requirement 8.4 (part of patientMatching)
   */
  function addDuplicatePatientPairs(
    pairs: Array<{ candidates: string[]; score: number }>,
  ): void {
    duplicatePairsList.push(...pairs);
  }

  /**
   * Add an audit event from a migrator.
   * Requirement 8.1, 8.2, 8.3
   */
  function addAuditEvent(event: AuditEvent): void {
    auditEvents.push(event);

    // Categorize for later retrieval
    if (event.type === 'error') {
      errorEvents.push(event);
    } else if (event.type === 'warning') {
      warningEvents.push(event);
    } else if (['auto_linked', 'manual_review', 'no_match'].includes(event.type)) {
      const matchType = event.type as 'auto_linked' | 'manual_review' | 'no_match';
      patientMatchingEvents.get(matchType)?.push(event);
    }
  }

  /**
   * Build the complete migration report.
   * Requirement 8.1, 8.2, 8.3, 8.4, 8.5
   */
  function build(runStartedAt: Date): MigrationReport {
    const completedAt = new Date();
    const duration = completedAt.getTime() - runStartedAt.getTime();

    // Build summaryByTable
    const summaryByTable: Record<string, TableMigrationSummary> = {};
    for (const [tableName, summary] of tableSummaries) {
      summaryByTable[tableName] = summary;
    }

    // Build patientMatching section
    // Requirement 8.2, 8.4: group matching events by outcome with examples
    const autoLinkedEvents = patientMatchingEvents.get('auto_linked') || [];
    const manualReviewEvents = patientMatchingEvents.get('manual_review') || [];
    const noMatchEvents = patientMatchingEvents.get('no_match') || [];

    const patientMatching = {
      autoLinked: buildPatientMatchResult('auto_linked', autoLinkedEvents),
      manualReview: buildPatientMatchResult('manual_review', manualReviewEvents),
      noMatch: buildPatientMatchResult('no_match', noMatchEvents),
      possibleDuplicatesInTarget: duplicatePairsList,
    };

    return {
      startedAt: runStartedAt,
      completedAt,
      duration,
      summaryByTable,
      excludedTables: excludedTablesList,
      patientMatching,
      errors: errorEvents,
      warnings: warningEvents,
    };
  }

  /**
   * Helper: build a PatientMatchResult from grouped events.
   * Requirement 8.2, 8.4: include count and examples
   */
  function buildPatientMatchResult(
    outcome: 'auto_linked' | 'manual_review' | 'no_match',
    events: AuditEvent[],
  ): PatientMatchResult {
    const examples: Array<{ sourceName: string; score?: number; candidates?: string[] }> =
      [];

    // Limit examples to avoid bloating report (up to 10 examples per outcome)
    const exampleCount = Math.min(10, events.length);
    for (let i = 0; i < exampleCount; i++) {
      const event = events[i];
      const example: { sourceName: string; score?: number; candidates?: string[] } = {
        sourceName: event.message,
      };

      if (outcome === 'auto_linked' && event.details?.score) {
        example.score = event.details.score as number;
      }

      if (
        (outcome === 'manual_review' || outcome === 'no_match') &&
        event.details?.candidates
      ) {
        example.candidates = event.details.candidates as string[];
      }

      examples.push(example);
    }

    return {
      outcome,
      count: events.length,
      examples,
    };
  }

  /**
   * Write report to disk in both JSON and Markdown formats.
   * Requirement 8.5, 8.6, 11.2
   *
   * Filenames include timestamp to prevent overwrites: migration-report-<YYYYMMDD-HHMMSS>.{json,md}
   */
  async function writeToDisk(
    report: MigrationReport,
    reportDir: string,
  ): Promise<{ jsonPath: string; mdPath: string }> {
    // Create report directory if it doesn't exist
    // Requirement 8.5
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    // Generate timestamp for filename (format: YYYYMMDD-HHMMSS)
    // Requirement 8.5, 11.2: ensures no collision between runs
    const timestamp = formatTimestamp(report.startedAt);
    const jsonFilename = `migration-report-${timestamp}.json`;
    const mdFilename = `migration-report-${timestamp}.md`;

    const jsonPath = path.join(reportDir, jsonFilename);
    const mdPath = path.join(reportDir, mdFilename);

    // Write JSON report (machine-readable, complete)
    // Requirement 8.5
    const jsonContent = serializeReport(report);
    fs.writeFileSync(jsonPath, jsonContent, 'utf-8');

    // Write Markdown report (human-readable, summarized)
    // Requirement 8.6
    const mdContent = renderMarkdownReport(report);
    fs.writeFileSync(mdPath, mdContent, 'utf-8');

    return { jsonPath, mdPath };
  }

  return {
    addTableSummary,
    addExcludedTable,
    addDuplicatePatientPairs,
    addAuditEvent,
    build,
    writeToDisk,
  };
}

/**
 * Format a Date to YYYYMMDD-HHMMSS for use in filenames.
 * Requirement 8.5, 11.2
 */
export function formatTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

/**
 * Serialize MigrationReport to JSON string.
 * Requirement 8.5: machine-readable, valid JSON structure
 */
export function serializeReport(report: MigrationReport): string {
  // Convert Date objects to ISO8601 strings for JSON serialization
  const serialized = {
    startedAt: report.startedAt.toISOString(),
    completedAt: report.completedAt.toISOString(),
    duration: report.duration,
    summaryByTable: report.summaryByTable,
    excludedTables: report.excludedTables,
    patientMatching: report.patientMatching,
    errors: report.errors.map((e) => ({
      ...e,
      timestamp: e.timestamp.toISOString(),
    })),
    warnings: report.warnings.map((w) => ({
      ...w,
      timestamp: w.timestamp.toISOString(),
    })),
  };

  return JSON.stringify(serialized, null, 2);
}

/**
 * Render MigrationReport as Markdown.
 * Requirement 8.6: human-readable summary with dedicated sections
 */
export function renderMarkdownReport(report: MigrationReport): string {
  const lines: string[] = [];

  // Header
  // Requirement 8.6: timestamp, duration, summary line
  lines.push('# Migration Report');
  lines.push('');
  lines.push(`**Started at:** ${report.startedAt.toISOString()}`);
  lines.push(`**Completed at:** ${report.completedAt.toISOString()}`);
  lines.push(`**Duration:** ${formatDuration(report.duration)}`);
  lines.push('');

  // Summary statistics
  const totalMigrated = Object.values(report.summaryByTable).reduce(
    (sum, s) => sum + s.migrated,
    0,
  );
  const totalErrors = report.errors.length;
  const totalWarnings = report.warnings.length;
  lines.push(`**Summary:** ${totalMigrated} migrated, ${totalErrors} errors, ${totalWarnings} warnings`);
  lines.push('');

  // Summary Table: by table
  // Requirement 8.6: table with columns Table | Migrated | Reused | Excluded | Omitted | Errors | Warnings
  lines.push('## Summary by Table');
  lines.push('');
  lines.push('| Table | Migrated | Reused | Excluded | Omitted | Errors | Warnings |');
  lines.push('|-------|----------|--------|----------|---------|--------|----------|');

  for (const [tableName, summary] of Object.entries(report.summaryByTable)) {
    lines.push(
      `| ${tableName} | ${summary.migrated} | ${summary.reused} | ${summary.excluded} | ${summary.omitted} | ${summary.errors} | ${summary.warnings} |`,
    );
  }

  lines.push('');

  // Excluded Tables
  // Requirement 8.6, 11.2: list explicitly excluded tables with reason
  if (report.excludedTables.length > 0) {
    lines.push('## Excluded Tables');
    lines.push('');
    lines.push('The following tables were explicitly excluded from migration:');
    lines.push('');
    for (const excluded of report.excludedTables) {
      lines.push(`- **${excluded.name}**: ${excluded.reason}`);
    }
    lines.push('');
  }

  // Patient Matching Summary
  // Requirement 8.6: recap by outcome
  lines.push('## Patient Matching Summary');
  lines.push('');
  lines.push(`- **Auto-linked:** ${report.patientMatching.autoLinked.count} patients`);
  lines.push(`- **Manual Review Required:** ${report.patientMatching.manualReview.count} patients`);
  lines.push(`- **No Match:** ${report.patientMatching.noMatch.count} patients`);
  lines.push('');

  // Manual Review Required
  // Requirement 8.6: dedicated section for ambiguous cases
  if (report.patientMatching.manualReview.count > 0) {
    lines.push('## Manual Review Required');
    lines.push('');
    lines.push('The following patient references could not be automatically matched:');
    lines.push('');

    for (const example of report.patientMatching.manualReview.examples) {
      lines.push(`- **${example.sourceName}**`);
      if (example.candidates && example.candidates.length > 0) {
        lines.push(`  Candidates: ${example.candidates.join(', ')}`);
      }
    }

    if (report.patientMatching.manualReview.count > report.patientMatching.manualReview.examples.length) {
      const remaining =
        report.patientMatching.manualReview.count -
        report.patientMatching.manualReview.examples.length;
      lines.push(`- ... and ${remaining} more cases (see JSON report for complete list)`);
    }

    lines.push('');
  }

  // No Match Cases
  // Requirement 8.6: dedicated section for unmatched cases
  if (report.patientMatching.noMatch.count > 0) {
    lines.push('## No Match Cases');
    lines.push('');
    lines.push('The following patient references could not be matched to any patient:');
    lines.push('');

    for (const example of report.patientMatching.noMatch.examples) {
      lines.push(`- ${example.sourceName}`);
    }

    if (report.patientMatching.noMatch.count > report.patientMatching.noMatch.examples.length) {
      const remaining =
        report.patientMatching.noMatch.count -
        report.patientMatching.noMatch.examples.length;
      lines.push(`... and ${remaining} more cases (see JSON report for complete list)`);
    }

    lines.push('');
  }

  // Possible Duplicates in Destination
  // Requirement 8.6, 6.10: dedicated section for duplicates detected in target
  if (report.patientMatching.possibleDuplicatesInTarget.length > 0) {
    lines.push('## Possible Duplicates in Destination');
    lines.push('');
    lines.push(
      'The following pairs of patients in the destination may be duplicates (same or very similar names):',
    );
    lines.push('');

    for (const dup of report.patientMatching.possibleDuplicatesInTarget) {
      lines.push(`- ${dup.candidates.join(' <-> ')} (similarity: ${(dup.score * 100).toFixed(1)}%)`);
    }

    lines.push('');
  }

  // Errors
  // Requirement 8.6: table with errors
  if (report.errors.length > 0) {
    lines.push('## Errors');
    lines.push('');
    lines.push(
      'The following rows could not be migrated due to errors and were excluded:',
    );
    lines.push('');
    lines.push('| Table | Source ID | Message |');
    lines.push('|-------|-----------|---------|');

    for (const error of report.errors) {
      const msg = error.message.replace(/\|/g, '\\|'); // Escape pipe in message
      lines.push(`| ${error.table} | ${error.sourceId} | ${msg} |`);
    }

    lines.push('');
  }

  // Warnings
  // Requirement 8.6: table with warnings
  if (report.warnings.length > 0) {
    lines.push('## Warnings');
    lines.push('');
    lines.push('The following rows were migrated but with warnings:');
    lines.push('');
    lines.push('| Table | Source ID | Message |');
    lines.push('|-------|-----------|---------|');

    for (const warning of report.warnings) {
      const msg = warning.message.replace(/\|/g, '\\|'); // Escape pipe in message
      lines.push(`| ${warning.table} | ${warning.sourceId} | ${msg} |`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format duration in milliseconds to human-readable string.
 * Helper for markdown report header.
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}
