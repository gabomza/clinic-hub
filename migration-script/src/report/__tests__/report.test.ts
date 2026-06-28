import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  createReportBuilder,
  type MigrationReport,
  type AuditEvent,
  type TableMigrationSummary,
  formatTimestamp,
  serializeReport,
  renderMarkdownReport,
} from '../report-builder';

describe('ReportBuilder', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create temporary directory for test reports
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-test-'));
  });

  afterEach(() => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('createReportBuilder', () => {
    it('should create a new ReportBuilder instance', () => {
      const builder = createReportBuilder();
      expect(builder).toBeDefined();
      expect(builder.addTableSummary).toBeDefined();
      expect(builder.addExcludedTable).toBeDefined();
      expect(builder.addDuplicatePatientPairs).toBeDefined();
      expect(builder.addAuditEvent).toBeDefined();
      expect(builder.build).toBeDefined();
      expect(builder.writeToDisk).toBeDefined();
    });
  });

  describe('addTableSummary', () => {
    it('should add a table summary', () => {
      const builder = createReportBuilder();
      const summary: TableMigrationSummary = {
        tableName: 'patients',
        migrated: 10,
        reused: 2,
        excluded: 1,
        omitted: 0,
        errors: 0,
        warnings: 1,
      };

      builder.addTableSummary(summary);

      const report = builder.build(new Date());
      expect(report.summaryByTable['patients']).toEqual(summary);
    });

    it('should handle multiple table summaries', () => {
      const builder = createReportBuilder();
      const summaries: TableMigrationSummary[] = [
        {
          tableName: 'patients',
          migrated: 10,
          reused: 2,
          excluded: 1,
          omitted: 0,
          errors: 0,
          warnings: 1,
        },
        {
          tableName: 'appointments',
          migrated: 25,
          reused: 0,
          excluded: 0,
          omitted: 0,
          errors: 0,
          warnings: 0,
        },
      ];

      summaries.forEach((s) => builder.addTableSummary(s));

      const report = builder.build(new Date());
      expect(Object.keys(report.summaryByTable)).toHaveLength(2);
      expect(report.summaryByTable['patients']).toBeDefined();
      expect(report.summaryByTable['appointments']).toBeDefined();
    });
  });

  describe('addExcludedTable', () => {
    it('should add explicitly excluded table', () => {
      const builder = createReportBuilder();

      builder.addExcludedTable('inst_alt', 'Table without equivalent in new schema');
      builder.addExcludedTable('medias', 'Explicitly excluded from scope');
      builder.addExcludedTable('ventamedias', 'No migration path defined');

      const report = builder.build(new Date());

      expect(report.excludedTables).toHaveLength(3);
      expect(report.excludedTables).toContainEqual({
        name: 'inst_alt',
        reason: 'Table without equivalent in new schema',
      });
      expect(report.excludedTables).toContainEqual({
        name: 'medias',
        reason: 'Explicitly excluded from scope',
      });
      expect(report.excludedTables).toContainEqual({
        name: 'ventamedias',
        reason: 'No migration path defined',
      });
    });

    // Requirement 11.2: excluded tables must be listed with reason
    it('Requirement 11.2: should include all three excluded tables with reason', () => {
      const builder = createReportBuilder();

      builder.addExcludedTable('inst_alt', 'Requirement 11.1');
      builder.addExcludedTable('medias', 'Requirement 11.1');
      builder.addExcludedTable('ventamedias', 'Requirement 11.1');

      const report = builder.build(new Date());

      expect(report.excludedTables).toHaveLength(3);
      const tableNames = report.excludedTables.map((t) => t.name);
      expect(tableNames).toContain('inst_alt');
      expect(tableNames).toContain('medias');
      expect(tableNames).toContain('ventamedias');
    });
  });

  describe('addDuplicatePatientPairs', () => {
    it('should add possible duplicate patient pairs', () => {
      const builder = createReportBuilder();

      const pairs = [
        { candidates: ['Patient A', 'Patient B'], score: 0.95 },
        { candidates: ['Patient C', 'Patient D'], score: 0.92 },
      ];

      builder.addDuplicatePatientPairs(pairs);

      const report = builder.build(new Date());

      expect(report.patientMatching.possibleDuplicatesInTarget).toHaveLength(2);
      expect(report.patientMatching.possibleDuplicatesInTarget[0].score).toBe(0.95);
    });

    // Requirement 6.10: detect duplicates in target
    it('Requirement 6.10: should include possible duplicates in target section', () => {
      const builder = createReportBuilder();

      builder.addDuplicatePatientPairs([
        {
          candidates: ['GONZALEZ, JUAN', 'GONZALES, JUAN'],
          score: 0.93,
        },
      ]);

      const report = builder.build(new Date());

      expect(report.patientMatching.possibleDuplicatesInTarget).toHaveLength(1);
      expect(report.patientMatching.possibleDuplicatesInTarget[0].candidates).toContain(
        'GONZALEZ, JUAN',
      );
      expect(report.patientMatching.possibleDuplicatesInTarget[0].score).toBe(0.93);
    });
  });

  describe('addAuditEvent', () => {
    it('should add error events', () => {
      const builder = createReportBuilder();
      const now = new Date();

      const errorEvent: AuditEvent = {
        type: 'error',
        table: 'cash_entries',
        sourceId: 99,
        message: 'ingresosCaja and egresosCaja both non-zero',
        timestamp: now,
      };

      builder.addAuditEvent(errorEvent);

      const report = builder.build(new Date());

      expect(report.errors).toHaveLength(1);
      expect(report.errors[0].type).toBe('error');
      expect(report.errors[0].table).toBe('cash_entries');
    });

    it('should add warning events', () => {
      const builder = createReportBuilder();
      const now = new Date();

      const warningEvent: AuditEvent = {
        type: 'warning',
        table: 'patients',
        sourceId: 8,
        message: 'doctor_id does not resolve; setting to NULL',
        timestamp: now,
      };

      builder.addAuditEvent(warningEvent);

      const report = builder.build(new Date());

      expect(report.warnings).toHaveLength(1);
      expect(report.warnings[0].type).toBe('warning');
    });

    it('should add patient matching events (auto_linked)', () => {
      const builder = createReportBuilder();
      const now = new Date();

      const matchEvent: AuditEvent = {
        type: 'auto_linked',
        table: 'appointments',
        sourceId: 3,
        targetId: 57,
        message: 'AMADEI matched to patient 57',
        timestamp: now,
        details: { score: 0.95 },
      };

      builder.addAuditEvent(matchEvent);

      const report = builder.build(new Date());

      expect(report.patientMatching.autoLinked.count).toBe(1);
      expect(report.patientMatching.autoLinked.outcome).toBe('auto_linked');
    });

    it('should add patient matching events (manual_review)', () => {
      const builder = createReportBuilder();
      const now = new Date();

      const matchEvent: AuditEvent = {
        type: 'manual_review',
        table: 'surgeries',
        sourceId: 4,
        message: 'AGOSTINI, ESTHER DE - multiple candidates',
        timestamp: now,
        details: { candidates: ['Patient 12', 'Patient 30'] },
      };

      builder.addAuditEvent(matchEvent);

      const report = builder.build(new Date());

      expect(report.patientMatching.manualReview.count).toBe(1);
      expect(report.patientMatching.manualReview.outcome).toBe('manual_review');
    });

    it('should add patient matching events (no_match)', () => {
      const builder = createReportBuilder();
      const now = new Date();

      const matchEvent: AuditEvent = {
        type: 'no_match',
        table: 'surgeries',
        sourceId: 7,
        message: 'AGUILAR, MARIA - no match found',
        timestamp: now,
      };

      builder.addAuditEvent(matchEvent);

      const report = builder.build(new Date());

      expect(report.patientMatching.noMatch.count).toBe(1);
      expect(report.patientMatching.noMatch.outcome).toBe('no_match');
    });
  });

  describe('build', () => {
    it('should build a complete report', () => {
      const builder = createReportBuilder();
      const startTime = new Date('2026-06-20T10:00:00Z');

      builder.addTableSummary({
        tableName: 'patients',
        migrated: 13,
        reused: 0,
        excluded: 0,
        omitted: 0,
        errors: 0,
        warnings: 0,
      });

      builder.addExcludedTable('inst_alt', 'Not in scope');

      const report = builder.build(startTime);

      expect(report).toBeDefined();
      expect(report.startedAt).toBe(startTime);
      expect(report.completedAt).toBeInstanceOf(Date);
      expect(report.duration).toBeGreaterThanOrEqual(0);
      expect(report.summaryByTable['patients']).toBeDefined();
      expect(report.excludedTables).toHaveLength(1);
    });

    // Requirement 8.1: summary includes row counts per table
    it('Requirement 8.1: should include row counts for each table', () => {
      const builder = createReportBuilder();

      builder.addTableSummary({
        tableName: 'fichas',
        migrated: 13,
        reused: 0,
        excluded: 0,
        omitted: 0,
        errors: 0,
        warnings: 1,
      });

      const report = builder.build(new Date());

      expect(report.summaryByTable['fichas'].migrated).toBe(13);
      expect(report.summaryByTable['fichas'].warnings).toBe(1);
    });

    // Requirement 8.2: patient matching details included
    it('Requirement 8.2: should include patient matching details with examples', () => {
      const builder = createReportBuilder();

      builder.addAuditEvent({
        type: 'auto_linked',
        table: 'appointments',
        sourceId: 1,
        message: 'AMADEI',
        timestamp: new Date(),
        details: { score: 0.95 },
      });

      const report = builder.build(new Date());

      expect(report.patientMatching.autoLinked.count).toBe(1);
      expect(report.patientMatching.autoLinked.examples.length).toBeGreaterThan(0);
    });

    // Requirement 8.3: error/warning exclusions documented
    it('Requirement 8.3: should include errors and warnings with reasons', () => {
      const builder = createReportBuilder();

      builder.addAuditEvent({
        type: 'error',
        table: 'caja',
        sourceId: 99,
        message: 'Invalid data: both income and expense non-zero',
        timestamp: new Date(),
      });

      builder.addAuditEvent({
        type: 'warning',
        table: 'fichas',
        sourceId: 8,
        message: 'Doctor reference not found',
        timestamp: new Date(),
      });

      const report = builder.build(new Date());

      expect(report.errors.length).toBeGreaterThan(0);
      expect(report.warnings.length).toBeGreaterThan(0);
      expect(report.errors[0].message).toContain('Invalid data');
      expect(report.warnings[0].message).toContain('Doctor');
    });

    // Requirement 8.4: structured format with clear sections
    it('Requirement 8.4: should have structured sections', () => {
      const builder = createReportBuilder();
      const report = builder.build(new Date());

      expect(report).toHaveProperty('summaryByTable');
      expect(report).toHaveProperty('excludedTables');
      expect(report).toHaveProperty('patientMatching');
      expect(report.patientMatching).toHaveProperty('autoLinked');
      expect(report.patientMatching).toHaveProperty('manualReview');
      expect(report.patientMatching).toHaveProperty('noMatch');
      expect(report.patientMatching).toHaveProperty('possibleDuplicatesInTarget');
      expect(report).toHaveProperty('errors');
      expect(report).toHaveProperty('warnings');
    });
  });

  describe('writeToDisk', () => {
    // Requirement 8.5: write both JSON and Markdown files
    it('Requirement 8.5: should write both JSON and Markdown files', async () => {
      const builder = createReportBuilder();
      const startTime = new Date();

      builder.addTableSummary({
        tableName: 'patients',
        migrated: 10,
        reused: 0,
        excluded: 0,
        omitted: 0,
        errors: 0,
        warnings: 0,
      });

      const report = builder.build(startTime);
      const { jsonPath, mdPath } = await builder.writeToDisk(report, tempDir);

      expect(fs.existsSync(jsonPath)).toBe(true);
      expect(fs.existsSync(mdPath)).toBe(true);
      expect(jsonPath).toContain('migration-report-');
      expect(jsonPath).toContain('.json');
      expect(mdPath).toContain('migration-report-');
      expect(mdPath).toContain('.md');
    });

    // Requirement 8.5: filename includes timestamp
    it('Requirement 8.5: should include timestamp in filename (YYYYMMDD-HHMMSS)', async () => {
      const builder = createReportBuilder();
      const startTime = new Date('2026-06-20T14:59:30Z');

      const report = builder.build(startTime);
      const { jsonPath } = await builder.writeToDisk(report, tempDir);

      // Filename should match format migration-report-YYYYMMDD-HHMMSS.json
      const filename = path.basename(jsonPath);
      expect(filename).toMatch(/migration-report-\d{8}-\d{6}\.json/);
      // Verify it starts with the expected prefix
      expect(filename).toContain('migration-report-');
      expect(filename).toContain('.json');
    });

    // Requirement 8.5: no collision between runs
    it('Requirement 8.5: should prevent filename collision between consecutive runs', async () => {
      const builder1 = createReportBuilder();
      const startTime1 = new Date(2026, 5, 20, 14, 59, 30);
      builder1.addTableSummary({
        tableName: 'patients',
        migrated: 1,
        reused: 0,
        excluded: 0,
        omitted: 0,
        errors: 0,
        warnings: 0,
      });

      const report1 = builder1.build(startTime1);
      const { jsonPath: path1 } = await builder1.writeToDisk(report1, tempDir);

      // Simulate a second run (one minute later)
      const builder2 = createReportBuilder();
      const startTime2 = new Date(2026, 5, 20, 15, 0, 15);
      builder2.addTableSummary({
        tableName: 'patients',
        migrated: 2,
        reused: 0,
        excluded: 0,
        omitted: 0,
        errors: 0,
        warnings: 0,
      });

      const report2 = builder2.build(startTime2);
      const { jsonPath: path2 } = await builder2.writeToDisk(report2, tempDir);

      // Paths should be different (different timestamps)
      expect(path1).not.toBe(path2);
      expect(fs.existsSync(path1)).toBe(true);
      expect(fs.existsSync(path2)).toBe(true);
    });

    // Requirement 8.5: create directory if not exists
    it('Requirement 8.5: should create report directory if it does not exist', async () => {
      const builder = createReportBuilder();
      const nonExistentDir = path.join(tempDir, 'subdir', 'reports');

      expect(fs.existsSync(nonExistentDir)).toBe(false);

      const report = builder.build(new Date());
      await builder.writeToDisk(report, nonExistentDir);

      expect(fs.existsSync(nonExistentDir)).toBe(true);
    });
  });

  describe('JSON Report Validity', () => {
    // Requirement 8.5: JSON must be valid
    it('should generate valid JSON that parses without error', async () => {
      const builder = createReportBuilder();
      const startTime = new Date();

      builder.addTableSummary({
        tableName: 'patients',
        migrated: 10,
        reused: 2,
        excluded: 1,
        omitted: 0,
        errors: 0,
        warnings: 1,
      });

      builder.addExcludedTable('inst_alt', 'Test reason');

      builder.addAuditEvent({
        type: 'error',
        table: 'cash_entries',
        sourceId: 99,
        message: 'Test error',
        timestamp: new Date(),
      });

      const report = builder.build(startTime);
      const { jsonPath } = await builder.writeToDisk(report, tempDir);

      const content = fs.readFileSync(jsonPath, 'utf-8');
      const parsed = JSON.parse(content); // Should not throw

      expect(parsed).toBeDefined();
      expect(parsed.startedAt).toBeDefined();
      expect(parsed.completedAt).toBeDefined();
      expect(parsed.duration).toBeGreaterThanOrEqual(0);
      expect(parsed.summaryByTable).toBeDefined();
      expect(parsed.excludedTables).toBeDefined();
    });

    // Requirement 8.4: JSON structure must have all sections
    it('should include all required JSON sections', async () => {
      const builder = createReportBuilder();
      const report = builder.build(new Date());
      const { jsonPath } = await builder.writeToDisk(report, tempDir);

      const content = fs.readFileSync(jsonPath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed).toHaveProperty('startedAt');
      expect(parsed).toHaveProperty('completedAt');
      expect(parsed).toHaveProperty('duration');
      expect(parsed).toHaveProperty('summaryByTable');
      expect(parsed).toHaveProperty('excludedTables');
      expect(parsed).toHaveProperty('patientMatching');
      expect(parsed.patientMatching).toHaveProperty('autoLinked');
      expect(parsed.patientMatching).toHaveProperty('manualReview');
      expect(parsed.patientMatching).toHaveProperty('noMatch');
      expect(parsed.patientMatching).toHaveProperty('possibleDuplicatesInTarget');
      expect(parsed).toHaveProperty('errors');
      expect(parsed).toHaveProperty('warnings');
    });
  });

  describe('Markdown Report Validity', () => {
    // Requirement 8.6: Markdown must be well-formed
    it('should generate well-formed Markdown', async () => {
      const builder = createReportBuilder();
      const startTime = new Date();

      builder.addTableSummary({
        tableName: 'patients',
        migrated: 13,
        reused: 0,
        excluded: 0,
        omitted: 0,
        errors: 0,
        warnings: 0,
      });

      builder.addExcludedTable('inst_alt', 'No equivalent in new schema');

      const report = builder.build(startTime);
      const { mdPath } = await builder.writeToDisk(report, tempDir);

      const content = fs.readFileSync(mdPath, 'utf-8');

      // Check for Markdown structure
      expect(content).toContain('# Migration Report');
      expect(content).toContain('## Summary by Table');
      expect(content).toContain('## Excluded Tables');
      expect(content).toContain('## Patient Matching Summary');

      // Should have valid table syntax
      expect(content).toContain('| Table | Migrated | Reused | Excluded |');
    });

    // Requirement 8.6: Summary table properly formatted
    it('should include properly formatted summary table', async () => {
      const builder = createReportBuilder();

      builder.addTableSummary({
        tableName: 'patients',
        migrated: 10,
        reused: 2,
        excluded: 0,
        omitted: 0,
        errors: 0,
        warnings: 1,
      });

      builder.addTableSummary({
        tableName: 'appointments',
        migrated: 25,
        reused: 0,
        excluded: 0,
        omitted: 0,
        errors: 0,
        warnings: 0,
      });

      const report = builder.build(new Date());
      const { mdPath } = await builder.writeToDisk(report, tempDir);

      const content = fs.readFileSync(mdPath, 'utf-8');

      // Should have table with all columns
      expect(content).toContain('| patients | 10 | 2 | 0 | 0 | 0 | 1 |');
      expect(content).toContain('| appointments | 25 | 0 | 0 | 0 | 0 | 0 |');
    });

    // Requirement 8.6: Excluded tables section present
    it('Requirement 8.6: should include excluded tables section with reasons', async () => {
      const builder = createReportBuilder();

      builder.addExcludedTable('inst_alt', 'Requirement 11.1');
      builder.addExcludedTable('medias', 'Requirement 11.1');
      builder.addExcludedTable('ventamedias', 'Requirement 11.1');

      const report = builder.build(new Date());
      const { mdPath } = await builder.writeToDisk(report, tempDir);

      const content = fs.readFileSync(mdPath, 'utf-8');

      expect(content).toContain('## Excluded Tables');
      expect(content).toContain('inst_alt');
      expect(content).toContain('medias');
      expect(content).toContain('ventamedias');
      expect(content).toContain('Requirement 11.1');
    });

    // Requirement 8.6: Manual review section
    it('Requirement 8.6: should include manual review required section', async () => {
      const builder = createReportBuilder();

      builder.addAuditEvent({
        type: 'manual_review',
        table: 'surgeries',
        sourceId: 4,
        message: 'AGOSTINI, ESTHER DE',
        timestamp: new Date(),
        details: { candidates: ['Patient 12', 'Patient 30'] },
      });

      const report = builder.build(new Date());
      const { mdPath } = await builder.writeToDisk(report, tempDir);

      const content = fs.readFileSync(mdPath, 'utf-8');

      expect(content).toContain('## Manual Review Required');
      expect(content).toContain('AGOSTINI, ESTHER DE');
    });

    // Requirement 8.6: No match cases section
    it('Requirement 8.6: should include no match cases section', async () => {
      const builder = createReportBuilder();

      builder.addAuditEvent({
        type: 'no_match',
        table: 'surgeries',
        sourceId: 7,
        message: 'AGUILAR, MARIA',
        timestamp: new Date(),
      });

      const report = builder.build(new Date());
      const { mdPath } = await builder.writeToDisk(report, tempDir);

      const content = fs.readFileSync(mdPath, 'utf-8');

      expect(content).toContain('## No Match Cases');
      expect(content).toContain('AGUILAR, MARIA');
    });

    // Requirement 8.6, 6.10: Possible duplicates section
    it('Requirement 8.6, 6.10: should include possible duplicates section', async () => {
      const builder = createReportBuilder();

      builder.addDuplicatePatientPairs([
        {
          candidates: ['GONZALEZ, JUAN', 'GONZALES, JUAN'],
          score: 0.93,
        },
      ]);

      const report = builder.build(new Date());
      const { mdPath } = await builder.writeToDisk(report, tempDir);

      const content = fs.readFileSync(mdPath, 'utf-8');

      expect(content).toContain('## Possible Duplicates in Destination');
      expect(content).toContain('GONZALEZ, JUAN');
      expect(content).toContain('GONZALES, JUAN');
    });

    // Requirement 8.6: Errors table
    it('Requirement 8.6: should include errors table', async () => {
      const builder = createReportBuilder();

      builder.addAuditEvent({
        type: 'error',
        table: 'cash_entries',
        sourceId: 99,
        message: 'Both income and expense non-zero',
        timestamp: new Date(),
      });

      const report = builder.build(new Date());
      const { mdPath } = await builder.writeToDisk(report, tempDir);

      const content = fs.readFileSync(mdPath, 'utf-8');

      expect(content).toContain('## Errors');
      expect(content).toContain('| cash_entries | 99 |');
      expect(content).toContain('Both income and expense non-zero');
    });

    // Requirement 8.6: Warnings table
    it('Requirement 8.6: should include warnings table', async () => {
      const builder = createReportBuilder();

      builder.addAuditEvent({
        type: 'warning',
        table: 'fichas',
        sourceId: 8,
        message: 'Doctor reference not found',
        timestamp: new Date(),
      });

      const report = builder.build(new Date());
      const { mdPath } = await builder.writeToDisk(report, tempDir);

      const content = fs.readFileSync(mdPath, 'utf-8');

      expect(content).toContain('## Warnings');
      expect(content).toContain('| fichas | 8 |');
      expect(content).toContain('Doctor reference not found');
    });
  });

  describe('formatTimestamp', () => {
    it('should format date as YYYYMMDD-HHMMSS', () => {
      // Create date using components to avoid timezone issues
      const date = new Date(2026, 5, 20, 14, 59, 30); // June = 5 (0-indexed), local time
      const formatted = formatTimestamp(date);

      expect(formatted).toMatch(/^\d{8}-\d{6}$/);
      // Verify year, month, day
      expect(formatted).toContain('20260620');
    });

    it('should pad single-digit components', () => {
      // Create date using components
      const date = new Date(2026, 0, 5, 9, 5, 3); // January = 0, local time
      const formatted = formatTimestamp(date);

      expect(formatted).toMatch(/^\d{8}-\d{6}$/);
      // Verify year, month, day are correctly padded
      expect(formatted).toContain('20260105');
      // Hours should be padded
      expect(formatted).toContain('09');
    });
  });

  describe('serializeReport', () => {
    it('should serialize report to valid JSON', () => {
      const startTime = new Date();
      const completedTime = new Date(startTime.getTime() + 60000);
      const report: MigrationReport = {
        startedAt: startTime,
        completedAt: completedTime,
        duration: 60000,
        summaryByTable: {
          patients: {
            tableName: 'patients',
            migrated: 13,
            reused: 0,
            excluded: 0,
            omitted: 0,
            errors: 0,
            warnings: 0,
          },
        },
        excludedTables: [],
        patientMatching: {
          autoLinked: { outcome: 'auto_linked', count: 0, examples: [] },
          manualReview: { outcome: 'manual_review', count: 0, examples: [] },
          noMatch: { outcome: 'no_match', count: 0, examples: [] },
          possibleDuplicatesInTarget: [],
        },
        errors: [],
        warnings: [],
      };

      const json = serializeReport(report);
      const parsed = JSON.parse(json);

      expect(parsed).toBeDefined();
      expect(parsed.startedAt).toBe(startTime.toISOString());
      expect(parsed.completedAt).toBe(completedTime.toISOString());
      expect(parsed.duration).toBe(60000);
    });
  });

  describe('renderMarkdownReport', () => {
    it('should render complete Markdown report', () => {
      const startTime = new Date();
      const completedTime = new Date(startTime.getTime() + 300000);
      const report: MigrationReport = {
        startedAt: startTime,
        completedAt: completedTime,
        duration: 300000,
        summaryByTable: {
          patients: {
            tableName: 'patients',
            migrated: 13,
            reused: 0,
            excluded: 0,
            omitted: 0,
            errors: 0,
            warnings: 1,
          },
        },
        excludedTables: [
          { name: 'inst_alt', reason: 'No equivalent in new schema' },
        ],
        patientMatching: {
          autoLinked: { outcome: 'auto_linked', count: 45, examples: [] },
          manualReview: { outcome: 'manual_review', count: 3, examples: [] },
          noMatch: { outcome: 'no_match', count: 1, examples: [] },
          possibleDuplicatesInTarget: [],
        },
        errors: [],
        warnings: [],
      };

      const md = renderMarkdownReport(report);

      expect(md).toContain('# Migration Report');
      expect(md).toContain('Started at:');
      expect(md).toContain('Completed at:');
      expect(md).toContain('Duration:');
      expect(md).toContain('Summary:');
      expect(md).toContain('Summary by Table');
      expect(md).toContain('Excluded Tables');
      expect(md).toContain('Patient Matching Summary');
    });
  });

  describe('Complex Scenarios', () => {
    // Full integration test with multiple tables, events, and excluded tables
    it('should handle complex report with multiple tables and events', async () => {
      const builder = createReportBuilder();
      const startTime = new Date('2026-06-20T10:00:00Z');

      // Add multiple tables
      builder.addTableSummary({
        tableName: 'patients',
        migrated: 13,
        reused: 0,
        excluded: 0,
        omitted: 0,
        errors: 0,
        warnings: 1,
      });

      builder.addTableSummary({
        tableName: 'surgeries',
        migrated: 3,
        reused: 0,
        excluded: 0,
        omitted: 0,
        errors: 0,
        warnings: 0,
      });

      builder.addTableSummary({
        tableName: 'cash_entries',
        migrated: 50,
        reused: 0,
        excluded: 2,
        omitted: 1,
        errors: 1,
        warnings: 0,
      });

      // Add excluded tables
      builder.addExcludedTable('inst_alt', 'Requirement 11.1');
      builder.addExcludedTable('medias', 'Requirement 11.1');
      builder.addExcludedTable('ventamedias', 'Requirement 11.1');

      // Add various events
      builder.addAuditEvent({
        type: 'auto_linked',
        table: 'appointments',
        sourceId: 3,
        targetId: 57,
        message: 'AMADEI',
        timestamp: new Date(),
        details: { score: 0.95 },
      });

      builder.addAuditEvent({
        type: 'manual_review',
        table: 'surgeries',
        sourceId: 4,
        message: 'AGOSTINI, ESTHER DE',
        timestamp: new Date(),
        details: { candidates: ['Patient 12', 'Patient 30'] },
      });

      builder.addAuditEvent({
        type: 'error',
        table: 'cash_entries',
        sourceId: 99,
        message: 'Both income and expense non-zero',
        timestamp: new Date(),
      });

      builder.addAuditEvent({
        type: 'warning',
        table: 'fichas',
        sourceId: 8,
        message: 'Doctor not found',
        timestamp: new Date(),
      });

      builder.addDuplicatePatientPairs([
        {
          candidates: ['GONZALEZ, JUAN', 'GONZALES, JUAN'],
          score: 0.93,
        },
      ]);

      const report = builder.build(startTime);
      const { jsonPath, mdPath } = await builder.writeToDisk(report, tempDir);

      // Verify JSON
      const jsonContent = fs.readFileSync(jsonPath, 'utf-8');
      const jsonParsed = JSON.parse(jsonContent);

      expect(jsonParsed.summaryByTable).toHaveProperty('patients');
      expect(jsonParsed.summaryByTable).toHaveProperty('surgeries');
      expect(jsonParsed.summaryByTable).toHaveProperty('cash_entries');
      expect(jsonParsed.excludedTables).toHaveLength(3);
      expect(jsonParsed.errors).toHaveLength(1);
      expect(jsonParsed.warnings).toHaveLength(1);

      // Verify Markdown
      const mdContent = fs.readFileSync(mdPath, 'utf-8');

      expect(mdContent).toContain('# Migration Report');
      expect(mdContent).toContain('patients');
      expect(mdContent).toContain('surgeries');
      expect(mdContent).toContain('cash_entries');
      expect(mdContent).toContain('inst_alt');
      expect(mdContent).toContain('medias');
      expect(mdContent).toContain('ventamedias');
      // Note: auto-linked patients may not appear in markdown (only in JSON)
      // unless they're in the limited examples, so we check for the sections instead
      expect(mdContent).toContain('## Manual Review Required');
      expect(mdContent).toContain('AGOSTINI, ESTHER DE');
      expect(mdContent).toContain('GONZALEZ, JUAN');
    });
  });
});

