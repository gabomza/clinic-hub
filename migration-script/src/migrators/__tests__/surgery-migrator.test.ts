/**
 * Tests for SurgeryMigrator - populateLookups
 *
 * Covers Requirements 5.1 - 5.3:
 * - Extraction of distinct non-empty values from diagnostico → surgery_diagnoses
 * - Extraction of distinct non-empty values from miembro → body_parts
 * - Extraction of distinct non-empty values from tecnica1/2/3 → surgery_techniques
 * - Deduplication using normalizeText()
 * - Handling of empty/null/whitespace-only values
 * - Case-insensitive and accent-insensitive matching
 *
 * Test cases:
 * 1. Empty input (no rows) → empty result
 * 2. New values → inserted correctly
 * 3. Duplicate values in input → inserted once
 * 4. Case variations (e.g., "Cataratas" vs "cataratas") → merged into one
 * 5. Accent variations (e.g., "Córnea" vs "cornea") → merged into one
 * 6. Whitespace variations → merged into one
 * 7. Empty/null/whitespace-only values → ignored
 * 8. Multiple techniques per row → all extracted
 * 9. Partial techniques (e.g., only tecnica1 and tecnica3) → both extracted
 * 10. All three techniques empty → no technique entries
 * 11. Error on INSERT → recorded in errors array, processing continues
 * 12. Correct inserted/reused counts
 * 13. LookupIdMaps contain correct normalized → id mappings
 * 14. Determinism: same input → same output
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createSurgeryMigrator,
  SurgeryMigrator,
  SurgeryRow,
  PopulateLookupResult,
  LookupIdMaps,
  SurgeryMigrationResult,
} from '../surgery-migrator';
import { normalizeText } from '../../utils/normalize';
import { PatientCandidate } from '../../matcher/patient-matcher';

/**
 * Mock PostgresClient for unit tests
 */
function createMockPostgresClient() {
  const tableData: Record<string, Array<{ id: number; [key: string]: any }>> = {
    surgery_diagnoses: [],
    body_parts: [],
    surgery_techniques: [],
  };

  let nextId: Record<string, number> = {
    surgery_diagnoses: 1,
    body_parts: 1,
    surgery_techniques: 1,
  };

  let shouldFailInsertTable: string | null = null;

  return {
    withTransaction: vi.fn(async (fn: any) => {
      const mockTx = {};
      return fn(mockTx);
    }),

    query: vi.fn(async (client: any, sql: string, params?: any[]) => {
      // SELECT queries
      if (sql.includes('SELECT')) {
        if (sql.includes('FROM surgery_diagnoses')) {
          return tableData.surgery_diagnoses.map((row) => ({
            id: row.id,
            diagnosis: row.diagnosis,
          }));
        } else if (sql.includes('FROM body_parts')) {
          return tableData.body_parts.map((row) => ({
            id: row.id,
            body_part: row.body_part,
          }));
        } else if (sql.includes('FROM surgery_techniques')) {
          return tableData.surgery_techniques.map((row) => ({
            id: row.id,
            technique: row.technique,
          }));
        }
        return [];
      }

      // INSERT queries
      if (sql.includes('INSERT')) {
        // Determine table from INSERT query
        let table = '';
        if (sql.includes('surgery_diagnoses')) {
          table = 'surgery_diagnoses';
        } else if (sql.includes('body_parts')) {
          table = 'body_parts';
        } else if (sql.includes('surgery_techniques')) {
          table = 'surgery_techniques';
        }

        if (shouldFailInsertTable === table) {
          throw new Error(`Simulated INSERT failure on ${table}`);
        }

        if (table && params && params.length > 0) {
          const id = nextId[table];
          nextId[table]++;

          const columnName =
            table === 'surgery_diagnoses'
              ? 'diagnosis'
              : table === 'body_parts'
                ? 'body_part'
                : table === 'surgery_techniques'
                  ? 'technique'
                  : 'name';

          tableData[table].push({
            id,
            [columnName]: params[0],
          });

          return [{ id }];
        }
      }

      return [];
    }),

    close: vi.fn(),

    // Testing helpers
    _getTableData: (table: string) => tableData[table] || [],
    _getNextId: (table: string) => nextId[table],
    _resetData: () => {
      tableData.surgery_diagnoses = [];
      tableData.body_parts = [];
      tableData.surgery_techniques = [];
      nextId = {
        surgery_diagnoses: 1,
        body_parts: 1,
        surgery_techniques: 1,
      };
      shouldFailInsertTable = null;
    },
    _setShouldFailInsert: (table: string | null) => {
      shouldFailInsertTable = table;
    },
  };
}

/**
 * Mock MigrationLogStore for unit tests
 */
function createMockMigrationLogStore() {
  return {
    ensureSchema: vi.fn(),
    findExisting: vi.fn(async () => null),
    record: vi.fn(),
    reset: vi.fn(),
  };
}

describe('SurgeryMigrator - populateLookups', () => {
  let migrator: SurgeryMigrator;
  let mockClient: any;
  let mockLogStore: any;

  beforeEach(() => {
    migrator = createSurgeryMigrator();
    mockClient = createMockPostgresClient();
    mockLogStore = createMockMigrationLogStore();
  });

  afterEach(() => {
    mockClient._resetData();
  });

  describe('Basic functionality', () => {
    it('should return empty result for empty input', async () => {
      const result = await migrator.populateLookups([], mockClient, mockLogStore);

      expect(result.inserted).toBe(0);
      expect(result.reused).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.lookupIdMaps.diagnoses.size).toBe(0);
      expect(result.lookupIdMaps.bodyParts.size).toBe(0);
      expect(result.lookupIdMaps.techniques.size).toBe(0);
    });

    it('should insert new diagnosis value', async () => {
      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          diagnostico: 'Cataratas',
          miembro: '',
          tecnica1: '',
        },
      ];

      const result = await migrator.populateLookups(rows, mockClient, mockLogStore);

      expect(result.inserted).toBe(1);
      expect(result.reused).toBe(0);
      expect(result.errors).toHaveLength(0);

      const normalizedKey = normalizeText('Cataratas');
      expect(result.lookupIdMaps.diagnoses.has(normalizedKey)).toBe(true);
      expect(result.lookupIdMaps.diagnoses.get(normalizedKey)).toBe(1);
    });

    it('should insert new body_part value', async () => {
      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          diagnostico: '',
          miembro: 'Ojo derecho',
          tecnica1: '',
        },
      ];

      const result = await migrator.populateLookups(rows, mockClient, mockLogStore);

      expect(result.inserted).toBe(1);
      expect(result.reused).toBe(0);

      const normalizedKey = normalizeText('Ojo derecho');
      expect(result.lookupIdMaps.bodyParts.has(normalizedKey)).toBe(true);
      expect(result.lookupIdMaps.bodyParts.get(normalizedKey)).toBe(1);
    });

    it('should insert new technique values from tecnica1/2/3', async () => {
      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          diagnostico: '',
          miembro: '',
          tecnica1: 'Facoemulsificación',
          tecnica2: 'Sutura',
          tecnica3: 'Drenaje',
        },
      ];

      const result = await migrator.populateLookups(rows, mockClient, mockLogStore);

      expect(result.inserted).toBe(3);
      expect(result.reused).toBe(0);
      expect(result.lookupIdMaps.techniques.size).toBe(3);
    });
  });

  describe('Empty and whitespace handling', () => {
    it('should ignore empty string values', async () => {
      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          diagnostico: '',
          miembro: '',
          tecnica1: '',
          tecnica2: '',
          tecnica3: '',
        },
      ];

      const result = await migrator.populateLookups(rows, mockClient, mockLogStore);

      expect(result.inserted).toBe(0);
      expect(result.reused).toBe(0);
    });

    it('should ignore null values', async () => {
      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          diagnostico: null,
          miembro: null,
          tecnica1: null,
        },
      ];

      const result = await migrator.populateLookups(rows, mockClient, mockLogStore);

      expect(result.inserted).toBe(0);
      expect(result.reused).toBe(0);
    });

    it('should ignore undefined values', async () => {
      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          diagnostico: undefined,
          miembro: undefined,
          tecnica1: undefined,
        },
      ];

      const result = await migrator.populateLookups(rows, mockClient, mockLogStore);

      expect(result.inserted).toBe(0);
      expect(result.reused).toBe(0);
    });

    it('should ignore whitespace-only values', async () => {
      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          diagnostico: '   ',
          miembro: '\t',
          tecnica1: '\n',
        },
      ];

      const result = await migrator.populateLookups(rows, mockClient, mockLogStore);

      expect(result.inserted).toBe(0);
      expect(result.reused).toBe(0);
    });
  });

  describe('Deduplication and normalization', () => {
    it('should detect duplicate values in same column and insert only once', async () => {
      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          diagnostico: 'Cataratas',
          miembro: '',
          tecnica1: '',
        },
        {
          id_cirugia: 2,
          diagnostico: 'Cataratas',
          miembro: '',
          tecnica1: '',
        },
      ];

      const result = await migrator.populateLookups(rows, mockClient, mockLogStore);

      // Set deduplicates at extraction stage, so we only get one value to insert
      expect(result.inserted).toBe(1); // Only one insertion for both rows
      expect(result.reused).toBe(0); // No reuse since it's first time processing
      expect(result.lookupIdMaps.diagnoses.size).toBe(1);
    });

    it('should detect case-insensitive duplicates', async () => {
      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          diagnostico: 'CATARATAS',
          miembro: '',
          tecnica1: '',
        },
        {
          id_cirugia: 2,
          diagnostico: 'cataratas',
          miembro: '',
          tecnica1: '',
        },
      ];

      const result = await migrator.populateLookups(rows, mockClient, mockLogStore);

      // Set deduplicates original values, but they're different strings, so Set keeps both
      // However, normalizeText() makes them identical, so one gets inserted and one reused
      expect(result.inserted).toBe(1);
      expect(result.reused).toBe(1); // Second value detected as duplicate via normalization
      expect(result.lookupIdMaps.diagnoses.size).toBe(1);
    });

    it('should detect accent-insensitive duplicates', async () => {
      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          miembro: 'Córnea',
          diagnostico: '',
          tecnica1: '',
        },
        {
          id_cirugia: 2,
          miembro: 'cornea',
          diagnostico: '',
          tecnica1: '',
        },
      ];

      const result = await migrator.populateLookups(rows, mockClient, mockLogStore);

      expect(result.inserted).toBe(1);
      expect(result.reused).toBe(1);
      expect(result.lookupIdMaps.bodyParts.size).toBe(1);
    });

    it('should detect whitespace-normalized duplicates', async () => {
      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          miembro: 'Ojo   derecho',
          diagnostico: '',
          tecnica1: '',
        },
        {
          id_cirugia: 2,
          miembro: 'Ojo derecho',
          diagnostico: '',
          tecnica1: '',
        },
      ];

      const result = await migrator.populateLookups(rows, mockClient, mockLogStore);

      expect(result.inserted).toBe(1);
      expect(result.reused).toBe(1);
      expect(result.lookupIdMaps.bodyParts.size).toBe(1);
    });

    it('should preserve Ñ while removing other accents', async () => {
      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          diagnostico: 'Óñoño',
          miembro: '',
          tecnica1: '',
        },
      ];

      const result = await migrator.populateLookups(rows, mockClient, mockLogStore);

      expect(result.inserted).toBe(1);
      // The normalized key should preserve Ñ
      const normalizedKey = normalizeText('Óñoño');
      expect(normalizedKey).toContain('Ñ');
    });
  });

  describe('Multiple techniques handling', () => {
    it('should extract all three techniques when all present', async () => {
      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          diagnostico: '',
          miembro: '',
          tecnica1: 'Facoemulsificación',
          tecnica2: 'Sutura',
          tecnica3: 'Drenaje',
        },
      ];

      const result = await migrator.populateLookups(rows, mockClient, mockLogStore);

      expect(result.inserted).toBe(3);
      expect(result.lookupIdMaps.techniques.size).toBe(3);
    });

    it('should extract partial techniques (tecnica1 and tecnica3 only)', async () => {
      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          diagnostico: '',
          miembro: '',
          tecnica1: 'Facoemulsificación',
          tecnica2: '',
          tecnica3: 'Drenaje',
        },
      ];

      const result = await migrator.populateLookups(rows, mockClient, mockLogStore);

      expect(result.inserted).toBe(2);
      expect(result.lookupIdMaps.techniques.size).toBe(2);
    });

    it('should ignore empty techniques and not create lookup entries for them', async () => {
      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          diagnostico: '',
          miembro: '',
          tecnica1: 'Facoemulsificación',
          tecnica2: '',
          tecnica3: '',
        },
      ];

      const result = await migrator.populateLookups(rows, mockClient, mockLogStore);

      expect(result.inserted).toBe(1);
      expect(result.lookupIdMaps.techniques.size).toBe(1);
    });

    it('should deduplicate repeated techniques across rows', async () => {
      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          diagnostico: '',
          miembro: '',
          tecnica1: 'Facoemulsificación',
          tecnica2: '',
          tecnica3: '',
        },
        {
          id_cirugia: 2,
          diagnostico: '',
          miembro: '',
          tecnica1: 'Facoemulsificación',
          tecnica2: 'Sutura',
          tecnica3: '',
        },
      ];

      const result = await migrator.populateLookups(rows, mockClient, mockLogStore);

      // Set deduplicates original values, so we only get Facoemulsificación and Sutura
      expect(result.inserted).toBe(2); // Facoemulsificación, Sutura
      expect(result.reused).toBe(0); // All values are new (first time processing)
      expect(result.lookupIdMaps.techniques.size).toBe(2);
    });
  });

  describe('Realistic scenario from sample_dump.sql', () => {
    it('should handle realistic surgery data', async () => {
      // Simulating actual data from sample_dump.sql
      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          apellido: 'ABALLAY',
          nombre: 'ANGELA C.DE',
          diagnostico: 'I.V.S.',
          miembro: 'M.I.I.',
          tecnica1: 'REEX.CAY',
          tecnica2: 'EMI',
          tecnica3: 'SHERMAN',
        },
        {
          id_cirugia: 2,
          apellido: 'ACOSTA',
          nombre: 'EDELMIRA',
          diagnostico: 'I.V.S.',
          miembro: 'M.I.D.',
          tecnica1: 'S.I.',
          tecnica2: 'EMI',
          tecnica3: '',
        },
        {
          id_cirugia: 3,
          apellido: 'ACOSTA',
          nombre: 'ELISA ZEIER DE',
          diagnostico: 'I.V.S.',
          miembro: 'M.I.I.',
          tecnica1: 'S.I.',
          tecnica2: 'EMI',
          tecnica3: 'SHERMAN',
        },
      ];

      const result = await migrator.populateLookups(rows, mockClient, mockLogStore);

      // Expected: 2 diagnoses (I.V.S. appears in all 3), 2 body_parts (M.I.I, M.I.D.),
      // 5 techniques (REEX.CAY, EMI, SHERMAN, S.I., and one more)
      expect(result.inserted).toBeGreaterThan(0);
      expect(result.errors).toHaveLength(0);
      expect(result.lookupIdMaps.diagnoses.size).toBeGreaterThan(0);
      expect(result.lookupIdMaps.bodyParts.size).toBeGreaterThan(0);
      expect(result.lookupIdMaps.techniques.size).toBeGreaterThan(0);
    });
  });

  describe('Error handling', () => {
    it('should record error if INSERT fails and continue processing', async () => {
      mockClient._setShouldFailInsert('surgery_diagnoses');

      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          diagnostico: 'Cataratas',
          miembro: 'Ojo derecho',
          tecnica1: '',
        },
      ];

      const result = await migrator.populateLookups(rows, mockClient, mockLogStore);

      expect(result.errors.length).toBeGreaterThan(0);
      // Body part should still be inserted despite diagnosis error
      expect(result.inserted).toBeGreaterThan(0);
    });

    it('should record specific error details', async () => {
      mockClient._setShouldFailInsert('surgery_diagnoses');

      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          diagnostico: 'Cataratas',
          miembro: '',
          tecnica1: '',
        },
      ];

      const result = await migrator.populateLookups(rows, mockClient, mockLogStore);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].value).toBe('Cataratas');
      expect(result.errors[0].table).toBe('surgery_diagnoses');
      expect(result.errors[0].error).toContain('failure');
    });
  });

  describe('Mapping correctness', () => {
    it('should map normalized values to correct IDs', async () => {
      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          diagnostico: 'Cataratas',
          miembro: 'Ojo derecho',
          tecnica1: 'Facoemulsificación',
        },
        {
          id_cirugia: 2,
          diagnostico: 'CATARATAS', // Should reuse first
          miembro: 'OJO DERECHO', // Should reuse first
          tecnica1: 'FACOEMULSIFICACION', // Should reuse first
        },
      ];

      const result = await migrator.populateLookups(rows, mockClient, mockLogStore);

      const diagnosisKey = normalizeText('Cataratas');
      const bodyPartKey = normalizeText('Ojo derecho');
      const techniqueKey = normalizeText('Facoemulsificación');

      expect(result.lookupIdMaps.diagnoses.get(diagnosisKey)).toBe(
        result.lookupIdMaps.diagnoses.get(normalizeText('CATARATAS')),
      );
      expect(result.lookupIdMaps.bodyParts.get(bodyPartKey)).toBe(
        result.lookupIdMaps.bodyParts.get(normalizeText('OJO DERECHO')),
      );
      expect(result.lookupIdMaps.techniques.get(techniqueKey)).toBe(
        result.lookupIdMaps.techniques.get(normalizeText('FACOEMULSIFICACION')),
      );
    });

    it('should use normalized keys in lookup maps, not original values', async () => {
      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          diagnostico: 'Cataratas',
          miembro: '',
          tecnica1: '',
        },
      ];

      const result = await migrator.populateLookups(rows, mockClient, mockLogStore);

      const normalizedKey = normalizeText('Cataratas');
      expect(result.lookupIdMaps.diagnoses.has(normalizedKey)).toBe(true);
      // Original value should NOT be a key
      expect(result.lookupIdMaps.diagnoses.has('Cataratas')).toBe(false);
    });
  });

  describe('Determinism', () => {
    it('should produce same result for same input on repeated calls', async () => {
      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          diagnostico: 'Cataratas',
          miembro: 'Ojo derecho',
          tecnica1: 'Facoemulsificación',
          tecnica2: 'Sutura',
          tecnica3: '',
        },
      ];

      const result1 = await migrator.populateLookups(rows, mockClient, mockLogStore);

      // Reset and try again
      mockClient._resetData();
      const result2 = await migrator.populateLookups(rows, mockClient, mockLogStore);

      expect(result1.inserted).toBe(result2.inserted);
      expect(result1.reused).toBe(result2.reused);
      expect(result1.errors).toHaveLength(result2.errors.length);
      expect(result1.lookupIdMaps.diagnoses.size).toBe(result2.lookupIdMaps.diagnoses.size);
    });
  });

  describe('Mixed scenarios', () => {
    it('should handle mix of new, duplicate, and case-insensitive values', async () => {
      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          diagnostico: 'Cataratas',
          miembro: 'Ojo derecho',
          tecnica1: 'Facoemulsificación',
        },
        {
          id_cirugia: 2,
          diagnostico: 'CATARATAS', // Different string (case-insensitive duplicate detected via normalization)
          miembro: 'Córnea', // New
          tecnica1: 'Facoemulsificación', // Same string, deduped by Set
        },
        {
          id_cirugia: 3,
          diagnostico: '', // Empty, ignored
          miembro: 'OJO DERECHO', // Different string (case-insensitive duplicate detected via normalization)
          tecnica1: 'Keratoplastia', // New
        },
      ];

      const result = await migrator.populateLookups(rows, mockClient, mockLogStore);

      // Set extracts: Cataratas, CATARATAS, Ojo derecho, Córnea, OJO DERECHO, Facoemulsificación, Keratoplastia (7 values)
      // Processing:
      // - Cataratas (normalized) → inserted (1)
      // - CATARATAS (normalized same as Cataratas) → reused (1)
      // - Ojo derecho (normalized) → inserted (1)
      // - Córnea (normalized) → inserted (1)
      // - OJO DERECHO (normalized same as Ojo derecho) → reused (1)
      // - Facoemulsificación → inserted (1)
      // - Keratoplastia → inserted (1)
      expect(result.inserted).toBe(5); // Cataratas, Ojo derecho, Córnea, Facoemulsificación, Keratoplastia
      expect(result.reused).toBe(2); // CATARATAS, OJO DERECHO
      expect(result.errors).toHaveLength(0);
    });

    it('should handle rows with multiple fields populated', async () => {
      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          diagnostico: 'Cataratas',
          miembro: 'Ojo derecho',
          tecnica1: 'Facoemulsificación',
          tecnica2: 'Sutura',
          tecnica3: 'Drenaje',
        },
      ];

      const result = await migrator.populateLookups(rows, mockClient, mockLogStore);

      // Set extracts: Cataratas, Ojo derecho, Facoemulsificación, Sutura, Drenaje (5 values)
      expect(result.inserted).toBe(5); // 1 diagnosis + 1 body_part + 3 techniques
      expect(result.reused).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });
});

/**
 * Tests for SurgeryMigrator - migrate (Task 10)
 *
 * Covers Requirements 5.4-5.8, 6.7:
 * - Field mapping: fecha → date, evolucion → outcome, diagnostico → diagnosis_id, miembro → body_part_id
 * - Surgery applied techniques insertion with correct order_index (1/2/3)
 * - Patient matching via PatientMatcher (auto_linked, manual_review, no_match)
 * - Handling of empty/NULL fields
 * - Idempotent re-execution
 * - Error handling and warnings
 */

/**
 * Mock PatientMatcher for unit tests
 */
function createMockPatientMatcher() {
  const matchResults: Record<string, any> = {};

  return {
    match: vi.fn((input: any, mode: string, candidatePool: any[]) => {
      const key = `${input.lastName || ''}|${input.firstName || ''}`;
      if (matchResults[key]) {
        return matchResults[key];
      }
      // Default: no_match
      return {
        outcome: 'no_match',
        reason: 'No default result configured',
      };
    }),

    detectDuplicatesInPool: vi.fn(() => []),

    // Test helper
    _setMatchResult: (lastName: string, firstName: string, result: any) => {
      const key = `${lastName}|${firstName}`;
      matchResults[key] = result;
    },
  };
}

/**
 * Enhanced mock PostgresClient for testing migrate() method
 */
function createMockPostgresClientForMigrate() {
  const mockClient = createMockPostgresClient();
  let nextSurgeryId = 1;

  const originalQuery = mockClient.query as any;
  mockClient.query = vi.fn(async (client: any, sql: string, params?: any[]) => {
    // INSERT INTO surgeries
    if (sql.includes('INSERT INTO surgeries')) {
      const surgeryId = nextSurgeryId++;
      return [{ id: surgeryId }];
    }
    // All other queries delegate to original
    return originalQuery(client, sql, params);
  });

  return mockClient;
}

describe('SurgeryMigrator - migrate (Task 10)', () => {
  let migrator: SurgeryMigrator;
  let mockClient: any;
  let mockLogStore: any;
  let mockPatientMatcher: any;
  let lookups: LookupIdMaps;
  let patientPool: PatientCandidate[];

  beforeEach(() => {
    migrator = createSurgeryMigrator();
    mockClient = createMockPostgresClientForMigrate();
    mockLogStore = createMockMigrationLogStore();
    mockPatientMatcher = createMockPatientMatcher();

    // Set up sample lookups
    lookups = {
      diagnoses: new Map([
        [normalizeText('Cataratas'), 1],
        [normalizeText('I.V.S.'), 2],
      ]),
      bodyParts: new Map([
        [normalizeText('Ojo derecho'), 1],
        [normalizeText('M.I.D.'), 2],
      ]),
      techniques: new Map([
        [normalizeText('Facoemulsificación'), 1],
        [normalizeText('Sutura'), 2],
      ]),
    };

    // Set up sample patient pool
    patientPool = [
      { id: 1, lastName: 'ABALLAY', firstName: 'ANGELA' },
      { id: 2, lastName: 'ACOSTA', firstName: 'EDELMIRA' },
      { id: 3, lastName: 'AMADEI', firstName: 'JUAN' },
    ];
  });

  describe('Basic field mapping', () => {
    it('should migrate surgery with basic field mapping', async () => {
      // Mock auto_linked patient
      mockPatientMatcher._setMatchResult('ABALLAY', 'ANGELA', {
        outcome: 'auto_linked',
        candidateId: 1,
        score: 0.95,
      });

      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          apellido: 'ABALLAY',
          nombre: 'ANGELA',
          diagnostico: 'Cataratas',
          miembro: 'Ojo derecho',
          tecnica1: 'Facoemulsificación',
          tecnica2: '',
          tecnica3: '',
          fecha: '2023-05-15',
          evolucion: 'Exitosa',
        },
      ];

      const result = await migrator.migrate(rows, lookups, patientPool, mockPatientMatcher, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should map fecha to date field correctly', async () => {
      mockPatientMatcher._setMatchResult('ABALLAY', 'ANGELA', {
        outcome: 'auto_linked',
        candidateId: 1,
      });

      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          apellido: 'ABALLAY',
          nombre: 'ANGELA',
          diagnostico: 'Cataratas',
          miembro: 'Ojo derecho',
          tecnica1: '',
          fecha: '2023-05-15',
          evolucion: 'Exitosa',
        },
      ];

      await migrator.migrate(rows, lookups, patientPool, mockPatientMatcher, mockClient, mockLogStore);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('INSERT INTO surgeries'),
        expect.arrayContaining(['2023-05-15']),
      );
    });

    it('should convert sentinel date 0000-00-00 to NULL', async () => {
      mockPatientMatcher._setMatchResult('ABALLAY', 'ANGELA', {
        outcome: 'auto_linked',
        candidateId: 1,
      });

      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          apellido: 'ABALLAY',
          nombre: 'ANGELA',
          diagnostico: 'Cataratas',
          miembro: 'Ojo derecho',
          tecnica1: '',
          fecha: '0000-00-00',
          evolucion: 'Exitosa',
        },
      ];

      await migrator.migrate(rows, lookups, patientPool, mockPatientMatcher, mockClient, mockLogStore);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('INSERT INTO surgeries'),
        expect.arrayContaining([null]), // NULL for date
      );
    });

    it('should map evolucion to outcome field', async () => {
      mockPatientMatcher._setMatchResult('ABALLAY', 'ANGELA', {
        outcome: 'auto_linked',
        candidateId: 1,
      });

      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          apellido: 'ABALLAY',
          nombre: 'ANGELA',
          diagnostico: 'Cataratas',
          miembro: 'Ojo derecho',
          tecnica1: '',
          fecha: '2023-05-15',
          evolucion: 'Satisfactoria',
        },
      ];

      await migrator.migrate(rows, lookups, patientPool, mockPatientMatcher, mockClient, mockLogStore);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('INSERT INTO surgeries'),
        expect.arrayContaining(['Satisfactoria']),
      );
    });
  });

  describe('Lookup resolution and NULL handling', () => {
    it('should resolve diagnostico to diagnosis_id via lookup', async () => {
      mockPatientMatcher._setMatchResult('ABALLAY', 'ANGELA', {
        outcome: 'auto_linked',
        candidateId: 1,
      });

      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          apellido: 'ABALLAY',
          nombre: 'ANGELA',
          diagnostico: 'Cataratas',
          miembro: '',
          tecnica1: '',
          fecha: '2023-05-15',
        },
      ];

      await migrator.migrate(rows, lookups, patientPool, mockPatientMatcher, mockClient, mockLogStore);
      // Should contain diagnosis_id = 1 (from lookups)
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('INSERT INTO surgeries'),
        expect.arrayContaining([1]), // diagnosis_id
      );
    });

    it('should resolve miembro to body_part_id via lookup', async () => {
      mockPatientMatcher._setMatchResult('ABALLAY', 'ANGELA', {
        outcome: 'auto_linked',
        candidateId: 1,
      });

      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          apellido: 'ABALLAY',
          nombre: 'ANGELA',
          diagnostico: '',
          miembro: 'Ojo derecho',
          tecnica1: '',
          fecha: '2023-05-15',
        },
      ];

      await migrator.migrate(rows, lookups, patientPool, mockPatientMatcher, mockClient, mockLogStore);
      // Should contain body_part_id = 1 (from lookups)
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('INSERT INTO surgeries'),
        expect.arrayContaining([1]), // body_part_id
      );
    });

    it('should handle empty diagnostico by setting diagnosis_id to NULL', async () => {
      mockPatientMatcher._setMatchResult('ABALLAY', 'ANGELA', {
        outcome: 'auto_linked',
        candidateId: 1,
      });

      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          apellido: 'ABALLAY',
          nombre: 'ANGELA',
          diagnostico: '',
          miembro: 'Ojo derecho',
          tecnica1: '',
          fecha: '2023-05-15',
        },
      ];

      const result = await migrator.migrate(rows, lookups, patientPool, mockPatientMatcher, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      expect(result.errors).toHaveLength(0);
      // Query should have NULL for diagnosis_id
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('INSERT INTO surgeries'),
        expect.arrayContaining([null]), // NULL for diagnosis_id
      );
    });

    it('should handle empty miembro by setting body_part_id to NULL', async () => {
      mockPatientMatcher._setMatchResult('ABALLAY', 'ANGELA', {
        outcome: 'auto_linked',
        candidateId: 1,
      });

      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          apellido: 'ABALLAY',
          nombre: 'ANGELA',
          diagnostico: 'Cataratas',
          miembro: '',
          tecnica1: '',
          fecha: '2023-05-15',
        },
      ];

      const result = await migrator.migrate(rows, lookups, patientPool, mockPatientMatcher, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should warn when diagnostico not found in lookup', async () => {
      mockPatientMatcher._setMatchResult('ABALLAY', 'ANGELA', {
        outcome: 'auto_linked',
        candidateId: 1,
      });

      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          apellido: 'ABALLAY',
          nombre: 'ANGELA',
          diagnostico: 'UnknownDisease',
          miembro: 'Ojo derecho',
          tecnica1: '',
          fecha: '2023-05-15',
        },
      ];

      const result = await migrator.migrate(rows, lookups, patientPool, mockPatientMatcher, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0].warning).toContain('Diagnosis lookup failed');
    });

    it('should warn when miembro not found in lookup', async () => {
      mockPatientMatcher._setMatchResult('ABALLAY', 'ANGELA', {
        outcome: 'auto_linked',
        candidateId: 1,
      });

      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          apellido: 'ABALLAY',
          nombre: 'ANGELA',
          diagnostico: 'Cataratas',
          miembro: 'UnknownBodyPart',
          tecnica1: '',
          fecha: '2023-05-15',
        },
      ];

      const result = await migrator.migrate(rows, lookups, patientPool, mockPatientMatcher, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0].warning).toContain('Body part lookup failed');
    });
  });

  describe('Technique handling (Requirement 5.6)', () => {
    it('should insert surgery_applied_techniques with correct order_index for tecnica1', async () => {
      mockPatientMatcher._setMatchResult('ABALLAY', 'ANGELA', {
        outcome: 'auto_linked',
        candidateId: 1,
      });

      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          apellido: 'ABALLAY',
          nombre: 'ANGELA',
          diagnostico: 'Cataratas',
          miembro: 'Ojo derecho',
          tecnica1: 'Facoemulsificación',
          tecnica2: '',
          tecnica3: '',
          fecha: '2023-05-15',
        },
      ];

      const result = await migrator.migrate(rows, lookups, patientPool, mockPatientMatcher, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      // Verify INSERT into surgery_applied_techniques was called with order_index = 1
      const surgeryTechniqueCall = mockClient.query.mock.calls.find((call: any) =>
        call[1].includes('surgery_applied_techniques'),
      );
      expect(surgeryTechniqueCall).toBeDefined();
      expect(surgeryTechniqueCall[2]).toContain(1); // order_index
    });

    it('should insert multiple techniques with correct order_index', async () => {
      mockPatientMatcher._setMatchResult('ABALLAY', 'ANGELA', {
        outcome: 'auto_linked',
        candidateId: 1,
      });

      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          apellido: 'ABALLAY',
          nombre: 'ANGELA',
          diagnostico: 'Cataratas',
          miembro: 'Ojo derecho',
          tecnica1: 'Facoemulsificación',
          tecnica2: 'Sutura',
          tecnica3: '',
          fecha: '2023-05-15',
        },
      ];

      const result = await migrator.migrate(rows, lookups, patientPool, mockPatientMatcher, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      // Should have 2 technique insertions
      const techniqueCalls = mockClient.query.mock.calls.filter((call: any) =>
        call[1].includes('surgery_applied_techniques'),
      );
      expect(techniqueCalls.length).toBe(2);
    });

    it('should handle partial techniques (tecnica1 and tecnica3, skip tecnica2)', async () => {
      mockPatientMatcher._setMatchResult('ABALLAY', 'ANGELA', {
        outcome: 'auto_linked',
        candidateId: 1,
      });

      // Add tecnica3 to lookups
      lookups.techniques.set(normalizeText('Drenaje'), 3);

      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          apellido: 'ABALLAY',
          nombre: 'ANGELA',
          diagnostico: 'Cataratas',
          miembro: 'Ojo derecho',
          tecnica1: 'Facoemulsificación',
          tecnica2: '',
          tecnica3: 'Drenaje',
          fecha: '2023-05-15',
        },
      ];

      const result = await migrator.migrate(rows, lookups, patientPool, mockPatientMatcher, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      // Should have 2 technique insertions (order_index 1 and 3)
      const techniqueCalls = mockClient.query.mock.calls.filter((call: any) =>
        call[1].includes('surgery_applied_techniques'),
      );
      expect(techniqueCalls.length).toBe(2);
    });

    it('should ignore empty techniques', async () => {
      mockPatientMatcher._setMatchResult('ABALLAY', 'ANGELA', {
        outcome: 'auto_linked',
        candidateId: 1,
      });

      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          apellido: 'ABALLAY',
          nombre: 'ANGELA',
          diagnostico: 'Cataratas',
          miembro: 'Ojo derecho',
          tecnica1: '',
          tecnica2: '',
          tecnica3: '',
          fecha: '2023-05-15',
        },
      ];

      const result = await migrator.migrate(rows, lookups, patientPool, mockPatientMatcher, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      // No technique insertions
      const techniqueCalls = mockClient.query.mock.calls.filter((call: any) =>
        call[1].includes('surgery_applied_techniques'),
      );
      expect(techniqueCalls.length).toBe(0);
    });

    it('should warn when technique not found in lookup', async () => {
      mockPatientMatcher._setMatchResult('ABALLAY', 'ANGELA', {
        outcome: 'auto_linked',
        candidateId: 1,
      });

      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          apellido: 'ABALLAY',
          nombre: 'ANGELA',
          diagnostico: 'Cataratas',
          miembro: 'Ojo derecho',
          tecnica1: 'UnknownTechnique',
          tecnica2: '',
          tecnica3: '',
          fecha: '2023-05-15',
        },
      ];

      const result = await migrator.migrate(rows, lookups, patientPool, mockPatientMatcher, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0].warning).toContain('Technique lookup failed');
    });
  });

  describe('Patient matching (Requirement 6.7)', () => {
    it('should use auto_linked patient when matched', async () => {
      mockPatientMatcher._setMatchResult('ABALLAY', 'ANGELA', {
        outcome: 'auto_linked',
        candidateId: 1,
        score: 0.95,
      });

      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          apellido: 'ABALLAY',
          nombre: 'ANGELA',
          diagnostico: 'Cataratas',
          miembro: 'Ojo derecho',
          tecnica1: '',
          fecha: '2023-05-15',
        },
      ];

      const result = await migrator.migrate(rows, lookups, patientPool, mockPatientMatcher, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
      // Verify patient_id = 1 was used
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('INSERT INTO surgeries'),
        expect.arrayContaining([1]), // patient_id
      );
    });

    it('should set patient_id to NULL for manual_review outcome', async () => {
      mockPatientMatcher._setMatchResult('ABALLAY', 'ANGELA', {
        outcome: 'manual_review',
        candidates: [
          { id: 1, score: 0.88 },
          { id: 2, score: 0.86 },
        ],
      });

      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          apellido: 'ABALLAY',
          nombre: 'ANGELA',
          diagnostico: 'Cataratas',
          miembro: 'Ojo derecho',
          tecnica1: '',
          fecha: '2023-05-15',
        },
      ];

      const result = await migrator.migrate(rows, lookups, patientPool, mockPatientMatcher, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0].warning).toContain('manual review');
      // Verify patient_id = NULL was used
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('INSERT INTO surgeries'),
        expect.arrayContaining([null]), // patient_id = NULL
      );
    });

    it('should set patient_id to NULL for no_match outcome', async () => {
      mockPatientMatcher._setMatchResult('UNKNOWN', 'PATIENT', {
        outcome: 'no_match',
        reason: 'No candidates found',
      });

      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          apellido: 'UNKNOWN',
          nombre: 'PATIENT',
          diagnostico: 'Cataratas',
          miembro: 'Ojo derecho',
          tecnica1: '',
          fecha: '2023-05-15',
        },
      ];

      const result = await migrator.migrate(rows, lookups, patientPool, mockPatientMatcher, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0].warning).toContain('No patient match found');
    });

    it('should warn when patient reference is empty', async () => {
      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          apellido: '',
          nombre: '',
          diagnostico: 'Cataratas',
          miembro: 'Ojo derecho',
          tecnica1: '',
          fecha: '2023-05-15',
        },
      ];

      const result = await migrator.migrate(rows, lookups, patientPool, mockPatientMatcher, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0].warning).toContain('empty');
    });
  });

  describe('Idempotence', () => {
    it('should skip already migrated surgeries', async () => {
      mockPatientMatcher._setMatchResult('ABALLAY', 'ANGELA', {
        outcome: 'auto_linked',
        candidateId: 1,
      });

      // Mock logStore to return existing entry
      mockLogStore.findExisting = vi.fn(async () => ({
        sourceTable: 'cirugias',
        sourcePk: '1',
        targetTable: 'surgeries',
        targetId: 100,
        status: 'migrated',
        payloadHash: 'hash123',
        migratedAt: new Date(),
      }));

      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          apellido: 'ABALLAY',
          nombre: 'ANGELA',
          diagnostico: 'Cataratas',
          miembro: 'Ojo derecho',
          tecnica1: '',
          fecha: '2023-05-15',
        },
      ];

      const result = await migrator.migrate(rows, lookups, patientPool, mockPatientMatcher, mockClient, mockLogStore);

      expect(result.migrated).toBe(0);
      // Patient matcher should not be called
      expect(mockPatientMatcher.match).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should record error and continue processing remaining rows', async () => {
      mockPatientMatcher._setMatchResult('ABALLAY', 'ANGELA', {
        outcome: 'auto_linked',
        candidateId: 1,
      });
      mockPatientMatcher._setMatchResult('ACOSTA', 'EDELMIRA', {
        outcome: 'auto_linked',
        candidateId: 2,
      });

      // Mock client to throw error on first INSERT
      let callCount = 0;
      const originalQuery = mockClient.query;
      mockClient.query = vi.fn(async (client: any, sql: string, params?: any[]) => {
        if (sql.includes('INSERT INTO surgeries') && callCount === 0) {
          callCount++;
          throw new Error('Simulated INSERT error');
        }
        return originalQuery(client, sql, params);
      });

      const rows: SurgeryRow[] = [
        {
          id_cirugia: 1,
          apellido: 'ABALLAY',
          nombre: 'ANGELA',
          diagnostico: 'Cataratas',
          miembro: 'Ojo derecho',
          tecnica1: '',
          fecha: '2023-05-15',
        },
        {
          id_cirugia: 2,
          apellido: 'ACOSTA',
          nombre: 'EDELMIRA',
          diagnostico: 'Cataratas',
          miembro: 'Ojo derecho',
          tecnica1: '',
          fecha: '2023-05-15',
        },
      ];

      const result = await migrator.migrate(rows, lookups, patientPool, mockPatientMatcher, mockClient, mockLogStore);

      // First row should error, second should succeed (after retry)
      expect(result.migrated).toBeGreaterThan(0);
      expect(result.errors).toHaveLength(1);
    });

    it('should return empty result for empty input', async () => {
      const result = await migrator.migrate([], lookups, patientPool, mockPatientMatcher, mockClient, mockLogStore);

      expect(result.migrated).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });
});
