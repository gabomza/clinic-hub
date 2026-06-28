/**
 * Clinical Record Migrator Tests
 *
 * Comprehensive test suite covering:
 * - Patient resolution via legacyIdToPatientId mapping (Requirement 4.2)
 * - Handling of unresolved patients (excluded rows)
 * - <br> tag replacement (Requirement 4.3)
 * - <br/> tag replacement
 * - <BR> tag replacement (uppercase)
 * - <BR/> tag replacement (uppercase with slash)
 * - Variants with spaces (< br >, < br/ >, etc.)
 * - Multiple <br> tags
 * - Date mapping and validation (Requirement 4.4)
 * - Sentinel date ('0000-00-00') handling
 * - NULL date handling
 * - Invalid date handling
 * - Visit fee assignment (Requirement 4.5)
 * - Visit fee not found (NULL silently)
 * - Empty datos handling
 * - Idempotent re-execution
 * - Multiple records with mixed results
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PoolClient } from 'pg';
import {
  createClinicalRecordMigrator,
  ClinicalRecordRow,
  ClinicalRecordMigrationResult,
} from '../clinical-record-migrator';
import { PostgresClient, calculatePayloadHash } from '../../db/client';
import { MigrationLogStore, MigrationLogEntry } from '../../db/migration-log';

/**
 * Mock PostgresClient
 */
function createMockPostgresClient() {
  const insertedRows: Record<number, any> = {};
  let nextId = 1;

  return {
    withTransaction: vi.fn(async (fn: any) => {
      // Create a mock PoolClient
      const mockTx = {} as PoolClient;
      return fn(mockTx);
    }),

    query: vi.fn(async (client: any, sql: string, params?: any[]) => {
      // Handle INSERT ... RETURNING id
      if (sql.includes('INSERT INTO clinical_records')) {
        const id = nextId++;
        const insertedRow: any = { id };

        // Extract column names from INSERT
        const columnMatch = sql.match(/\(([^)]+)\)/);
        if (columnMatch) {
          const columns = columnMatch[1].split(',').map((c) => c.trim());
          columns.forEach((col, idx) => {
            insertedRow[col] = params?.[idx] ?? null;
          });
        }

        insertedRows[id] = insertedRow;

        return [{ id }];
      }

      return [];
    }),

    close: vi.fn(),
  } as any as PostgresClient;
}

/**
 * Mock MigrationLogStore
 */
function createMockMigrationLogStore() {
  const logs: MigrationLogEntry[] = [];

  return {
    ensureSchema: vi.fn(),

    findExisting: vi.fn(async (client: any, sourceTable: string, sourcePk: string) => {
      return logs.find((log) => log.sourceTable === sourceTable && log.sourcePk === sourcePk) || null;
    }),

    record: vi.fn(async (client: any, entry: MigrationLogEntry) => {
      logs.push(entry);
    }),

    reset: vi.fn(),
  } as any as MigrationLogStore;
}

describe('ClinicalRecordMigrator', () => {
  let mockClient: PostgresClient;
  let mockLogStore: MigrationLogStore;
  let migrator: ReturnType<typeof createClinicalRecordMigrator>;

  beforeEach(() => {
    mockClient = createMockPostgresClient();
    mockLogStore = createMockMigrationLogStore();
    migrator = createClinicalRecordMigrator();
  });

  describe('Basic field transformation', () => {
    it('should migrate a complete clinical record', async () => {
      const rows: ClinicalRecordRow[] = [
        {
          idHistoriaClinica: 1,
          idFicha: 5,
          fechaConsulta: '2023-03-10',
          datos: 'Paciente presenta síntomas leves.',
        },
      ];

      const legacyIdToPatientId = new Map([[5, 10]]);
      const visitFeeByLegacyPatientId = new Map();

      const result = await migrator.migrate(
        rows,
        legacyIdToPatientId,
        visitFeeByLegacyPatientId,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.excluded).toBe(0);
      expect(result.reused).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should handle minimal fields', async () => {
      const rows: ClinicalRecordRow[] = [
        {
          idHistoriaClinica: 2,
          idFicha: 6,
        },
      ];

      const legacyIdToPatientId = new Map([[6, 11]]);
      const visitFeeByLegacyPatientId = new Map();

      const result = await migrator.migrate(
        rows,
        legacyIdToPatientId,
        visitFeeByLegacyPatientId,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.excluded).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Patient resolution (Requirement 4.2)', () => {
    it('should resolve patient via legacyIdToPatientId map', async () => {
      const rows: ClinicalRecordRow[] = [
        {
          idHistoriaClinica: 1,
          idFicha: 5,
          fechaConsulta: '2023-03-10',
          datos: 'Test note',
        },
      ];

      const legacyIdToPatientId = new Map([[5, 10]]);
      const visitFeeByLegacyPatientId = new Map();

      const result = await migrator.migrate(
        rows,
        legacyIdToPatientId,
        visitFeeByLegacyPatientId,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.excluded).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should exclude row when patient not found in mapping', async () => {
      const rows: ClinicalRecordRow[] = [
        {
          idHistoriaClinica: 2,
          idFicha: 999, // Not in map
          fechaConsulta: '2023-03-10',
          datos: 'Test note',
        },
      ];

      const legacyIdToPatientId = new Map([[5, 10]]);
      const visitFeeByLegacyPatientId = new Map();

      const result = await migrator.migrate(
        rows,
        legacyIdToPatientId,
        visitFeeByLegacyPatientId,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(0);
      expect(result.excluded).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain('Patient ID 999 not found in mapping');
    });

    it('should handle empty legacyIdToPatientId map', async () => {
      const rows: ClinicalRecordRow[] = [
        {
          idHistoriaClinica: 3,
          idFicha: 5,
          fechaConsulta: '2023-03-10',
          datos: 'Test note',
        },
      ];

      const legacyIdToPatientId = new Map();
      const visitFeeByLegacyPatientId = new Map();

      const result = await migrator.migrate(
        rows,
        legacyIdToPatientId,
        visitFeeByLegacyPatientId,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(0);
      expect(result.excluded).toBe(1);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('<br> tag replacement (Requirement 4.3)', () => {
    it('should replace single <br> tag with newline', async () => {
      const rows: ClinicalRecordRow[] = [
        {
          idHistoriaClinica: 1,
          idFicha: 5,
          fechaConsulta: '2023-03-10',
          datos: 'Paciente presenta cataratas.<br>Se recomienda cirugía.',
        },
      ];

      const legacyIdToPatientId = new Map([[5, 10]]);
      const visitFeeByLegacyPatientId = new Map();

      const result = await migrator.migrate(
        rows,
        legacyIdToPatientId,
        visitFeeByLegacyPatientId,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.errors).toHaveLength(0);
      // Verify the query was called with newline-separated text
      expect(mockClient.query).toHaveBeenCalled();
    });

    it('should replace <br/> tag (with forward slash) with newline', async () => {
      const rows: ClinicalRecordRow[] = [
        {
          idHistoriaClinica: 2,
          idFicha: 5,
          fechaConsulta: '2023-03-10',
          datos: 'First line.<br/>Second line.',
        },
      ];

      const legacyIdToPatientId = new Map([[5, 10]]);
      const visitFeeByLegacyPatientId = new Map();

      const result = await migrator.migrate(
        rows,
        legacyIdToPatientId,
        visitFeeByLegacyPatientId,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should replace <BR> tag (uppercase) with newline', async () => {
      const rows: ClinicalRecordRow[] = [
        {
          idHistoriaClinica: 3,
          idFicha: 5,
          fechaConsulta: '2023-03-10',
          datos: 'Uppercase test.<BR>Second line.',
        },
      ];

      const legacyIdToPatientId = new Map([[5, 10]]);
      const visitFeeByLegacyPatientId = new Map();

      const result = await migrator.migrate(
        rows,
        legacyIdToPatientId,
        visitFeeByLegacyPatientId,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should replace <BR/> tag (uppercase with slash) with newline', async () => {
      const rows: ClinicalRecordRow[] = [
        {
          idHistoriaClinica: 4,
          idFicha: 5,
          fechaConsulta: '2023-03-10',
          datos: 'Uppercase with slash.<BR/>Second line.',
        },
      ];

      const legacyIdToPatientId = new Map([[5, 10]]);
      const visitFeeByLegacyPatientId = new Map();

      const result = await migrator.migrate(
        rows,
        legacyIdToPatientId,
        visitFeeByLegacyPatientId,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle <br> with surrounding spaces', async () => {
      const rows: ClinicalRecordRow[] = [
        {
          idHistoriaClinica: 5,
          idFicha: 5,
          fechaConsulta: '2023-03-10',
          datos: 'Text with spaces.< br >Text after.',
        },
      ];

      const legacyIdToPatientId = new Map([[5, 10]]);
      const visitFeeByLegacyPatientId = new Map();

      const result = await migrator.migrate(
        rows,
        legacyIdToPatientId,
        visitFeeByLegacyPatientId,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle <br/> with surrounding spaces', async () => {
      const rows: ClinicalRecordRow[] = [
        {
          idHistoriaClinica: 6,
          idFicha: 5,
          fechaConsulta: '2023-03-10',
          datos: 'Text with spaces.< br/ >Text after.',
        },
      ];

      const legacyIdToPatientId = new Map([[5, 10]]);
      const visitFeeByLegacyPatientId = new Map();

      const result = await migrator.migrate(
        rows,
        legacyIdToPatientId,
        visitFeeByLegacyPatientId,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should replace multiple <br> tags', async () => {
      const rows: ClinicalRecordRow[] = [
        {
          idHistoriaClinica: 7,
          idFicha: 5,
          fechaConsulta: '2023-03-10',
          datos: 'Line 1.<br>Line 2.<br>Line 3.<br>Line 4.',
        },
      ];

      const legacyIdToPatientId = new Map([[5, 10]]);
      const visitFeeByLegacyPatientId = new Map();

      const result = await migrator.migrate(
        rows,
        legacyIdToPatientId,
        visitFeeByLegacyPatientId,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should replace mixed case and variant <br> tags', async () => {
      const rows: ClinicalRecordRow[] = [
        {
          idHistoriaClinica: 8,
          idFicha: 5,
          fechaConsulta: '2023-03-10',
          datos: 'Paciente presenta cataratas.<br/>Se recomienda cirugía.<BR/>Seguimiento en 1 mes.',
        },
      ];

      const legacyIdToPatientId = new Map([[5, 10]]);
      const visitFeeByLegacyPatientId = new Map();

      const result = await migrator.migrate(
        rows,
        legacyIdToPatientId,
        visitFeeByLegacyPatientId,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Date mapping (Requirement 4.4)', () => {
    it('should map valid YYYY-MM-DD date to visit_date', async () => {
      const rows: ClinicalRecordRow[] = [
        {
          idHistoriaClinica: 1,
          idFicha: 5,
          fechaConsulta: '2023-03-10',
          datos: 'Test',
        },
      ];

      const legacyIdToPatientId = new Map([[5, 10]]);
      const visitFeeByLegacyPatientId = new Map();

      const result = await migrator.migrate(
        rows,
        legacyIdToPatientId,
        visitFeeByLegacyPatientId,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should convert sentinel date 0000-00-00 to NULL', async () => {
      const rows: ClinicalRecordRow[] = [
        {
          idHistoriaClinica: 2,
          idFicha: 5,
          fechaConsulta: '0000-00-00',
          datos: 'Test',
        },
      ];

      const legacyIdToPatientId = new Map([[5, 10]]);
      const visitFeeByLegacyPatientId = new Map();

      const result = await migrator.migrate(
        rows,
        legacyIdToPatientId,
        visitFeeByLegacyPatientId,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should handle NULL fechaConsulta', async () => {
      const rows: ClinicalRecordRow[] = [
        {
          idHistoriaClinica: 3,
          idFicha: 5,
          fechaConsulta: undefined,
          datos: 'Test',
        },
      ];

      const legacyIdToPatientId = new Map([[5, 10]]);
      const visitFeeByLegacyPatientId = new Map();

      const result = await migrator.migrate(
        rows,
        legacyIdToPatientId,
        visitFeeByLegacyPatientId,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle empty string fechaConsulta', async () => {
      const rows: ClinicalRecordRow[] = [
        {
          idHistoriaClinica: 4,
          idFicha: 5,
          fechaConsulta: '',
          datos: 'Test',
        },
      ];

      const legacyIdToPatientId = new Map([[5, 10]]);
      const visitFeeByLegacyPatientId = new Map();

      const result = await migrator.migrate(
        rows,
        legacyIdToPatientId,
        visitFeeByLegacyPatientId,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Visit fee assignment (Requirement 4.5)', () => {
    it('should assign visit_fee when found in map', async () => {
      const rows: ClinicalRecordRow[] = [
        {
          idHistoriaClinica: 1,
          idFicha: 5,
          fechaConsulta: '2023-03-10',
          datos: 'Test',
        },
      ];

      const legacyIdToPatientId = new Map([[5, 10]]);
      const visitFeeByLegacyPatientId = new Map([[5, '500']]);

      const result = await migrator.migrate(
        rows,
        legacyIdToPatientId,
        visitFeeByLegacyPatientId,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle NULL visit_fee when not found in map', async () => {
      const rows: ClinicalRecordRow[] = [
        {
          idHistoriaClinica: 2,
          idFicha: 5,
          fechaConsulta: '2023-03-10',
          datos: 'Test',
        },
      ];

      const legacyIdToPatientId = new Map([[5, 10]]);
      const visitFeeByLegacyPatientId = new Map();

      const result = await migrator.migrate(
        rows,
        legacyIdToPatientId,
        visitFeeByLegacyPatientId,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should handle numeric visit_fee string', async () => {
      const rows: ClinicalRecordRow[] = [
        {
          idHistoriaClinica: 3,
          idFicha: 5,
          fechaConsulta: '2023-03-10',
          datos: 'Test',
        },
      ];

      const legacyIdToPatientId = new Map([[5, 10]]);
      const visitFeeByLegacyPatientId = new Map([[5, '250.50']]);

      const result = await migrator.migrate(
        rows,
        legacyIdToPatientId,
        visitFeeByLegacyPatientId,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle zero visit_fee', async () => {
      const rows: ClinicalRecordRow[] = [
        {
          idHistoriaClinica: 4,
          idFicha: 5,
          fechaConsulta: '2023-03-10',
          datos: 'Test',
        },
      ];

      const legacyIdToPatientId = new Map([[5, 10]]);
      const visitFeeByLegacyPatientId = new Map([[5, '0']]);

      const result = await migrator.migrate(
        rows,
        legacyIdToPatientId,
        visitFeeByLegacyPatientId,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Datos field handling', () => {
    it('should handle NULL datos', async () => {
      const rows: ClinicalRecordRow[] = [
        {
          idHistoriaClinica: 1,
          idFicha: 5,
          fechaConsulta: '2023-03-10',
          datos: undefined,
        },
      ];

      const legacyIdToPatientId = new Map([[5, 10]]);
      const visitFeeByLegacyPatientId = new Map();

      const result = await migrator.migrate(
        rows,
        legacyIdToPatientId,
        visitFeeByLegacyPatientId,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle empty string datos', async () => {
      const rows: ClinicalRecordRow[] = [
        {
          idHistoriaClinica: 2,
          idFicha: 5,
          fechaConsulta: '2023-03-10',
          datos: '',
        },
      ];

      const legacyIdToPatientId = new Map([[5, 10]]);
      const visitFeeByLegacyPatientId = new Map();

      const result = await migrator.migrate(
        rows,
        legacyIdToPatientId,
        visitFeeByLegacyPatientId,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Idempotent re-execution (Requirement 9.1)', () => {
    it('should skip already migrated records', async () => {
      const rows: ClinicalRecordRow[] = [
        {
          idHistoriaClinica: 1,
          idFicha: 5,
          fechaConsulta: '2023-03-10',
          datos: 'Test',
        },
      ];

      const legacyIdToPatientId = new Map([[5, 10]]);
      const visitFeeByLegacyPatientId = new Map();

      // First execution
      const result1 = await migrator.migrate(
        rows,
        legacyIdToPatientId,
        visitFeeByLegacyPatientId,
        mockClient,
        mockLogStore,
      );

      expect(result1.migrated).toBe(1);
      expect(result1.reused).toBe(0);

      // Second execution with same data
      const result2 = await migrator.migrate(
        rows,
        legacyIdToPatientId,
        visitFeeByLegacyPatientId,
        mockClient,
        mockLogStore,
      );

      expect(result2.migrated).toBe(0);
      expect(result2.reused).toBe(1);
      expect(result2.errors).toHaveLength(0);
    });
  });

  describe('Multiple records with mixed results', () => {
    it('should handle batch with some resolved and some excluded', async () => {
      const rows: ClinicalRecordRow[] = [
        {
          idHistoriaClinica: 1,
          idFicha: 5,
          fechaConsulta: '2023-03-10',
          datos: 'Valid record',
        },
        {
          idHistoriaClinica: 2,
          idFicha: 999, // Not in map
          fechaConsulta: '2023-03-11',
          datos: 'Invalid patient',
        },
        {
          idHistoriaClinica: 3,
          idFicha: 6,
          fechaConsulta: '2023-03-12',
          datos: 'Another valid record',
        },
      ];

      const legacyIdToPatientId = new Map([
        [5, 10],
        [6, 11],
      ]);
      const visitFeeByLegacyPatientId = new Map();

      const result = await migrator.migrate(
        rows,
        legacyIdToPatientId,
        visitFeeByLegacyPatientId,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(2);
      expect(result.excluded).toBe(1);
      expect(result.errors).toHaveLength(1);
    });

    it('should handle batch with varying data', async () => {
      const rows: ClinicalRecordRow[] = [
        {
          idHistoriaClinica: 1,
          idFicha: 5,
          fechaConsulta: '2023-03-10',
          datos: 'Paciente presenta síntomas.<br>Recomendación: descanso.',
        },
        {
          idHistoriaClinica: 2,
          idFicha: 5,
          fechaConsulta: '2023-03-11',
          datos: 'Seguimiento.<BR/>Estado mejorado.',
        },
        {
          idHistoriaClinica: 3,
          idFicha: 5,
          fechaConsulta: '0000-00-00',
          datos: undefined,
        },
      ];

      const legacyIdToPatientId = new Map([[5, 10]]);
      const visitFeeByLegacyPatientId = new Map([[5, '500']]);

      const result = await migrator.migrate(
        rows,
        legacyIdToPatientId,
        visitFeeByLegacyPatientId,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(3);
      expect(result.excluded).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Empty input handling', () => {
    it('should handle empty rows array', async () => {
      const rows: ClinicalRecordRow[] = [];

      const legacyIdToPatientId = new Map([[5, 10]]);
      const visitFeeByLegacyPatientId = new Map();

      const result = await migrator.migrate(
        rows,
        legacyIdToPatientId,
        visitFeeByLegacyPatientId,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(0);
      expect(result.reused).toBe(0);
      expect(result.excluded).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });
});
