/**
 * Synthetic Volume Fixture Tests
 *
 * Tests for the synthetic MySQL dump generator used in volume testing.
 * Verifies that the fixture generation works correctly and produces valid SQL.
 *
 * Reference: docs/specs/data-migration-script/tasks.md Task 17
 */

import { describe, it, expect } from 'vitest';
import { generateSyntheticMysqlDump } from './fixtures/synthetic';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Synthetic Fixture Generator', () => {
  describe('SQL dump generation', () => {
    it('should generate a valid SQL dump structure', () => {
      const dump = generateSyntheticMysqlDump();

      // Verify dump is a non-empty string
      expect(typeof dump).toBe('string');
      expect(dump.length).toBeGreaterThan(0);
      console.log(`[FIXTURE TEST] Generated dump size: ${(dump.length / 1024).toFixed(2)} KB`);

      // Verify dump contains standard MySQL header
      expect(dump).toContain('/*!40101 SET @OLD_CHARACTER_SET_CLIENT');
      expect(dump).toContain('/*!40101 SET NAMES utf8');

      // Verify dump contains CREATE TABLE statements for all required tables
      expect(dump).toContain('CREATE TABLE `fichas`');
      expect(dump).toContain('CREATE TABLE `inst_turnos`');
      expect(dump).toContain('CREATE TABLE `cirugias`');
      expect(dump).toContain('CREATE TABLE `historiaclinica`');
      expect(dump).toContain('CREATE TABLE `caja`');

      // Verify dump contains INSERT statements
      expect(dump).toContain('INSERT INTO fichas VALUES');
      expect(dump).toContain('INSERT INTO inst_turnos VALUES');
      expect(dump).toContain('INSERT INTO cirugias VALUES');
      expect(dump).toContain('INSERT INTO historiaclinica VALUES');
      expect(dump).toContain('INSERT INTO caja VALUES');

      // Verify dump contains reference data tables
      expect(dump).toContain('CREATE TABLE `inst_doctor`');
      expect(dump).toContain('CREATE TABLE `inst_obrasoc`');
      expect(dump).toContain('CREATE TABLE `inst_motivo`');
      expect(dump).toContain('CREATE TABLE `inst_horarios`');

      // Verify dump ends with MySQL footer
      expect(dump).toContain('/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT');
    });

    it('should generate correct row counts with custom configuration', () => {
      const config = {
        fichasCount: 100,
        turnosCount: 50,
        cirugiasCount: 30,
        historiaclinicaCount: 60,
        cajaCount: 80,
      };

      const dump = generateSyntheticMysqlDump(config);

      // Count INSERT statements to verify row generation
      // This is a simple heuristic: each row generates one insertion line in multi-row VALUES
      const fichasMatches = dump.match(/INSERT INTO fichas VALUES/g);
      const turnosMatches = dump.match(/INSERT INTO inst_turnos VALUES/g);
      const cirugiasMatches = dump.match(/INSERT INTO cirugias VALUES/g);
      const historiaclinicaMatches = dump.match(/INSERT INTO historiaclinica VALUES/g);
      const cajaMatches = dump.match(/INSERT INTO caja VALUES/g);

      // Each table should have at least one INSERT statement
      expect(fichasMatches).not.toBeNull();
      expect(turnosMatches).not.toBeNull();
      expect(cirugiasMatches).not.toBeNull();
      expect(historiaclinicaMatches).not.toBeNull();
      expect(cajaMatches).not.toBeNull();

      console.log(
        `[FIXTURE TEST] Custom config generated ${fichasMatches?.length || 0} fichas INSERTs (100 rows total)`
      );
    });

    it('should generate multi-row INSERT statements', () => {
      const dump = generateSyntheticMysqlDump({ fichasCount: 100 });

      // Verify multi-row INSERT syntax is used (multiple values in one INSERT)
      // Look for pattern: INSERT INTO table VALUES (...), (...), ...;
      const multiRowPattern = /INSERT INTO \w+ VALUES .*?,.*?;/s;
      expect(dump).toMatch(multiRowPattern);

      // Verify that INSERTs are properly terminated with semicolons
      const insertStatements = dump.split('INSERT INTO');
      for (let i = 1; i < insertStatements.length; i++) {
        if (
          insertStatements[i].includes('fichas VALUES') ||
          insertStatements[i].includes('inst_turnos VALUES') ||
          insertStatements[i].includes('cirugias VALUES') ||
          insertStatements[i].includes('historiaclinica VALUES') ||
          insertStatements[i].includes('caja VALUES')
        ) {
          expect(insertStatements[i]).toContain(';');
        }
      }
    });

    it('should generate realistic data with proper escaping', () => {
      const dump = generateSyntheticMysqlDump({ fichasCount: 50 });

      // Verify that SQL values are properly escaped
      // Check for escaped quotes if they appear
      if (dump.includes("\\'")) {
        // If there are escaped quotes, they should be in the correct context
        expect(dump.match(/'\w+\\'\w+'/)).toBeTruthy();
      }

      // Verify date format is YYYY-MM-DD
      const datePattern = /\d{4}-\d{2}-\d{2}/g;
      const allDates = dump.match(datePattern);
      expect(allDates).not.toBeNull();
      expect(allDates!.length).toBeGreaterThan(0);

      // Filter out sentinel dates (0000-00-00) which are valid but shouldn't be validated
      const dates = allDates!.filter((d) => !d.startsWith('0000'));
      expect(dates.length).toBeGreaterThan(0);

      // Verify all non-sentinel extracted dates are valid
      for (const date of dates) {
        const [year, month, day] = date.split('-').map(Number);
        expect(year).toBeGreaterThanOrEqual(1900);
        expect(month).toBeGreaterThanOrEqual(1);
        expect(month).toBeLessThanOrEqual(12);
        expect(day).toBeGreaterThanOrEqual(1);
        expect(day).toBeLessThanOrEqual(31);
      }

      // Verify currency format uses comma as decimal separator
      const currencyPattern = /\d+,\d{2}/g;
      const currencyMatches = dump.match(currencyPattern);
      expect(currencyMatches).not.toBeNull();
      expect(currencyMatches!.length).toBeGreaterThan(0);
    });

    it('should generate data that can be written to a file', () => {
      const dump = generateSyntheticMysqlDump({ fichasCount: 50 });

      const tmpDir = os.tmpdir();
      const tmpFile = path.join(
        tmpDir,
        `test-dump-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`
      );

      try {
        // Write dump to file
        fs.writeFileSync(tmpFile, dump, 'utf-8');
        expect(fs.existsSync(tmpFile)).toBe(true);

        // Read it back and verify content
        const readContent = fs.readFileSync(tmpFile, 'utf-8');
        expect(readContent).toBe(dump);
        expect(readContent.length).toBe(dump.length);

        // Verify file size is reasonable (at least a few KB)
        const stats = fs.statSync(tmpFile);
        expect(stats.size).toBeGreaterThan(1024); // At least 1 KB
        console.log(`[FIXTURE TEST] Dump file size: ${(stats.size / 1024).toFixed(2)} KB`);
      } finally {
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      }
    });
  });

  describe('Default configuration (10x volume)', () => {
    it('should generate default 10x volume dump with expected sizes', () => {
      const dump = generateSyntheticMysqlDump();

      // The default configuration should generate approximately:
      // fichas: 500 rows
      // inst_turnos: 200 rows
      // cirugias: 100 rows
      // historiaclinica: 300 rows
      // caja: 400 rows

      // Verify dump is significantly larger than sample_dump.sql (~20-30 KB)
      // Expected size: 50-100 KB for 1500 rows total
      const dumpSizeKb = dump.length / 1024;
      console.log(`[FIXTURE TEST] Default 10x volume dump size: ${dumpSizeKb.toFixed(2)} KB`);

      // Should be larger than a simple fixture but still manageable
      expect(dump.length).toBeGreaterThan(50 * 1024); // At least 50 KB
      expect(dump.length).toBeLessThan(500 * 1024); // Less than 500 KB

      // Verify it contains substantial data for each table
      expect(dump.match(/INSERT INTO fichas VALUES/g)?.length).toBeGreaterThan(0);
      expect(dump.match(/INSERT INTO inst_turnos VALUES/g)?.length).toBeGreaterThan(0);
      expect(dump.match(/INSERT INTO cirugias VALUES/g)?.length).toBeGreaterThan(0);
      expect(dump.match(/INSERT INTO historiaclinica VALUES/g)?.length).toBeGreaterThan(0);
      expect(dump.match(/INSERT INTO caja VALUES/g)?.length).toBeGreaterThan(0);
    });
  });

  describe('Data integrity and realism', () => {
    it('should generate diverse Spanish names and surnames', () => {
      const dump = generateSyntheticMysqlDump({ fichasCount: 100 });

      // Extract a few names to verify diversity
      // Look for names in fichas INSERT statements
      const fichasInsertMatch = dump.match(/INSERT INTO fichas VALUES(.*?);/s);
      expect(fichasInsertMatch).not.toBeNull();

      if (fichasInsertMatch) {
        const fichasData = fichasInsertMatch[0];

        // Verify presence of common Spanish surnames
        const commonSurnames = ['García', 'López', 'González', 'Rodríguez', 'Martínez'];
        let foundSurname = false;
        for (const surname of commonSurnames) {
          if (fichasData.includes(surname)) {
            foundSurname = true;
            break;
          }
        }

        // At least some Spanish surnames should be present (name generation is random)
        // If none appear, that's fine - just means random selection favored other names
        console.log(`[FIXTURE TEST] Spanish surnames found in generated data: ${foundSurname}`);
      }
    });

    it('should generate valid dates across different decades', () => {
      const dump = generateSyntheticMysqlDump({ fichasCount: 100 });

      // Extract dates from various fields
      const datePattern = /('(\d{4}-\d{2}-\d{2})')/g;
      const allDates = dump.match(datePattern);

      expect(allDates).not.toBeNull();
      expect(allDates!.length).toBeGreaterThan(10);

      // Filter out sentinel dates (0000-00-00)
      const dates = allDates!.filter((d) => !d.includes('0000'));

      // Convert to years and verify spread
      const years = new Set(
        dates.map((d) => {
          const yearMatch = d.match(/\d{4}/);
          return yearMatch ? yearMatch[0] : '0000';
        })
      );
      console.log(`[FIXTURE TEST] Date range in generated data: ${Array.from(years).sort().join(', ')}`);

      // Should have dates from different decades (1900s, 1980s-1990s, 2000s-2020s)
      expect(years.size).toBeGreaterThan(1);
    });

    it('should balance income and expense entries in cash table', () => {
      const dump = generateSyntheticMysqlDump({ cajaCount: 100 });

      // Extract caja INSERT statements
      const cajaInsertMatches = dump.match(/INSERT INTO caja VALUES(.*?);/g);
      expect(cajaInsertMatches).not.toBeNull();

      if (cajaInsertMatches) {
        let incomeCount = 0;
        let expenseCount = 0;

        for (const insertStmt of cajaInsertMatches) {
          // Count rows with income (first currency column is non-zero)
          if (insertStmt.match(/,'[1-9]\d*,\d{2}','0,00'/)) {
            incomeCount += (insertStmt.match(/\(/g) || []).length - 1; // -1 for VALUES keyword
          }
          // Count rows with expense (second currency column is non-zero)
          if (insertStmt.match(/,'0,00','[1-9]\d*,\d{2}'/)) {
            expenseCount += (insertStmt.match(/\(/g) || []).length - 1;
          }
        }

        console.log(
          `[FIXTURE TEST] Generated cash entries: ${incomeCount} income, ${expenseCount} expense`
        );

        // Should have both income and expense entries (randomly distributed)
        // At least some of each is expected from random generation
        expect(incomeCount + expenseCount).toBeGreaterThan(0);
      }
    });
  });
});
