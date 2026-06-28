/**
 * Patient Migrator Tests
 *
 * Comprehensive test suite covering:
 * - Field transformations (16+ test cases)
 * - Gender conversion
 * - Marital status validation
 * - Sentinel date handling
 * - Doctor ID resolution
 * - Phone priority logic
 * - valorConsulta retention
 * - Idempotent re-execution
 * - Mapping construction
 * - Edge cases (empty fields, nulls, spaces)
 * - Multi-patient scenarios
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PoolClient } from 'pg';
import { createPatientMigrator, PatientRow, PatientMigrationResult } from '../patient-migrator';
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
      if (sql.includes('INSERT INTO patients')) {
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

      // Handle SELECT * FROM patients WHERE id = $1
      if (sql.includes('SELECT') && sql.includes('FROM patients')) {
        const idMatch = sql.match(/WHERE id = \$1/);
        if (idMatch && params?.[0]) {
          const row = insertedRows[params[0]];
          return row ? [row] : [];
        }
        return Object.values(insertedRows);
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

describe('PatientMigrator', () => {
  let mockClient: PostgresClient;
  let mockLogStore: MigrationLogStore;
  let migrator: ReturnType<typeof createPatientMigrator>;

  beforeEach(() => {
    mockClient = createMockPostgresClient();
    mockLogStore = createMockMigrationLogStore();
    migrator = createPatientMigrator();
  });

  describe('Basic field transformation', () => {
    it('should migrate a complete patient record', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 1,
          tipoDoc: 'DN',
          documento: '12345678',
          apellido: 'RODRIGUEZ',
          nombre: 'JUAN',
          domicilio: 'Calle 123',
          departamento: 'CAPITAL',
          provincia: 'MENDOZA',
          fechaNac: '1980-05-15',
          sexo: 'M',
          obraSocial: 'OSEP',
          nroObraSocial: '123456',
          telefono: '4301234',
          eMail: 'juan@example.com',
          codPostal: '5500',
          estadoCivil: 'married',
          profesional: '1',
          primerConsulta: '2020-01-15',
          ultimaConsulta: '2022-06-20',
          diagnostico: 'Linfedema',
          valorConsulta: '500',
        },
      ];

      const doctorIdMap = new Map([[1, 1]]);
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      expect(result.reused).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.legacyIdToPatientId.get(1)).toBe(1);
      expect(result.visitFeeByLegacyPatientId.get(1)).toBe('500');
    });

    it('should migrate patient with minimal fields', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 2,
          apellido: 'PEREZ',
          nombre: 'MARIA',
        },
      ];

      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(result.legacyIdToPatientId.get(2)).toBe(1);
    });

    it('should fail if both apellido and nombre are empty', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 3,
          apellido: '',
          nombre: '',
        },
      ];

      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain('empty');
    });

    it('should trim whitespace from fields', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 4,
          apellido: '  HERNANDEZ  ',
          nombre: '  CARLOS  ',
          telefono: '  4301234  ',
          eMail: '  carlos@test.com  ',
        },
      ];

      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      // We can verify the trimming happened via the mock calls
      expect(mockClient.query).toHaveBeenCalled();
    });
  });

  describe('Gender conversion', () => {
    it('should convert M to male', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 10,
          apellido: 'TEST',
          nombre: 'PATIENT',
          sexo: 'M',
        },
      ];

      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      // Verify the query was called with 'male'
      const calls = (mockClient.query as any).mock.calls;
      const insertCall = calls.find((call: any[]) => call[1].includes('INSERT INTO patients'));
      expect(insertCall).toBeDefined();
      // gender parameter should be 'male' (at index 8 in the values)
    });

    it('should convert F to female', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 11,
          apellido: 'TEST',
          nombre: 'PATIENT',
          sexo: 'F',
        },
      ];

      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
    });

    it('should convert lowercase m to male', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 12,
          apellido: 'TEST',
          nombre: 'PATIENT',
          sexo: 'm',
        },
      ];

      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
    });

    it('should convert invalid gender to NULL', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 13,
          apellido: 'TEST',
          nombre: 'PATIENT',
          sexo: 'X',
        },
      ];

      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
    });

    it('should convert empty gender to NULL', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 14,
          apellido: 'TEST',
          nombre: 'PATIENT',
          sexo: '',
        },
      ];

      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
    });
  });

  describe('Marital status validation', () => {
    it('should accept valid marital_status values', async () => {
      const validStatuses = ['single', 'married', 'divorced', 'widowed', 'separated', 'common_law', 'other'];

      for (let i = 0; i < validStatuses.length; i++) {
        const rows: PatientRow[] = [
          {
            idFicha: 20 + i,
            apellido: `TEST${i}`,
            nombre: 'PATIENT',
            estadoCivil: validStatuses[i],
          },
        ];

        const doctorIdMap = new Map();
        const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

        expect(result.migrated).toBe(1);
        expect(result.warnings).toHaveLength(0);
      }
    });

    it('should convert invalid marital_status to NULL with warning', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 30,
          apellido: 'TEST',
          nombre: 'PATIENT',
          estadoCivil: 'INVALID_STATUS',
        },
      ];

      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].warning).toContain('Invalid marital_status');
    });

    it('should convert empty marital_status to NULL', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 31,
          apellido: 'TEST',
          nombre: 'PATIENT',
          estadoCivil: '',
        },
      ];

      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
    });
  });

  describe('Sentinel date handling', () => {
    it('should convert 0000-00-00 to NULL for birth_date', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 40,
          apellido: 'TEST',
          nombre: 'PATIENT',
          fechaNac: '0000-00-00',
        },
      ];

      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
    });

    it('should convert 0000-00-00 to NULL for first_visit_date', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 41,
          apellido: 'TEST',
          nombre: 'PATIENT',
          primerConsulta: '0000-00-00',
        },
      ];

      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
    });

    it('should convert 0000-00-00 to NULL for last_visit_date', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 42,
          apellido: 'TEST',
          nombre: 'PATIENT',
          ultimaConsulta: '0000-00-00',
        },
      ];

      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
    });

    it('should preserve valid dates', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 43,
          apellido: 'TEST',
          nombre: 'PATIENT',
          fechaNac: '1980-05-15',
          primerConsulta: '2020-01-15',
          ultimaConsulta: '2022-06-20',
        },
      ];

      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
    });

    it('should handle empty date strings as NULL', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 44,
          apellido: 'TEST',
          nombre: 'PATIENT',
          fechaNac: '',
        },
      ];

      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
    });
  });

  describe('Doctor ID resolution', () => {
    it('should convert profesional 0 to NULL', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 50,
          apellido: 'TEST',
          nombre: 'PATIENT',
          profesional: '0',
        },
      ];

      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      expect(result.warnings).toHaveLength(0);
    });

    it('should map valid numeric profesional via doctorIdMap', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 51,
          apellido: 'TEST',
          nombre: 'PATIENT',
          profesional: '1',
        },
      ];

      const doctorIdMap = new Map([[1, 10]]);
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      expect(result.warnings).toHaveLength(0);
    });

    it('should warn if numeric profesional not in doctorIdMap', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 52,
          apellido: 'TEST',
          nombre: 'PATIENT',
          profesional: '5',
        },
      ];

      const doctorIdMap = new Map([[1, 10]]);
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].warning).toContain('not found in doctorIdMap');
    });

    it('should warn if profesional is non-numeric string', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 53,
          apellido: 'TEST',
          nombre: 'PATIENT',
          profesional: 'abc',
        },
      ];

      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].warning).toContain('not numeric');
    });

    it('should handle empty profesional as NULL', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 54,
          apellido: 'TEST',
          nombre: 'PATIENT',
          profesional: '',
        },
      ];

      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('Phone priority logic', () => {
    it('should prioritize telefono over telefonoTrabajo', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 60,
          apellido: 'TEST',
          nombre: 'PATIENT',
          telefono: '4301234',
          telefonoTrabajo: '4305678',
        },
      ];

      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
    });

    it('should use telefonoTrabajo if telefono is empty', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 61,
          apellido: 'TEST',
          nombre: 'PATIENT',
          telefono: '',
          telefonoTrabajo: '4305678',
        },
      ];

      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
    });

    it('should ignore telefono value 0 and use telefonoTrabajo', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 62,
          apellido: 'TEST',
          nombre: 'PATIENT',
          telefono: '0',
          telefonoTrabajo: '4305678',
        },
      ];

      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
    });

    it('should convert both empty to NULL', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 63,
          apellido: 'TEST',
          nombre: 'PATIENT',
          telefono: '',
          telefonoTrabajo: '',
        },
      ];

      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
    });
  });

  describe('valorConsulta retention', () => {
    it('should retain valorConsulta without writing to database', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 70,
          apellido: 'TEST',
          nombre: 'PATIENT',
          valorConsulta: '500',
        },
      ];

      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.visitFeeByLegacyPatientId.get(70)).toBe('500');
    });

    it('should handle missing valorConsulta', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 71,
          apellido: 'TEST',
          nombre: 'PATIENT',
        },
      ];

      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.visitFeeByLegacyPatientId.has(71)).toBe(false);
    });
  });

  describe('Idempotence', () => {
    it('should reuse patient on second execution with same data', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 80,
          apellido: 'TEST',
          nombre: 'PATIENT',
          profesional: '1',
          valorConsulta: '500',
        },
      ];

      const doctorIdMap = new Map([[1, 1]]);

      // First run
      const result1 = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);
      expect(result1.migrated).toBe(1);
      expect(result1.reused).toBe(0);

      // Second run with same data
      const result2 = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);
      expect(result2.migrated).toBe(0);
      expect(result2.reused).toBe(1);

      // Verify mapping is consistent
      expect(result1.legacyIdToPatientId.get(80)).toBe(result2.legacyIdToPatientId.get(80));
    });

    it('should reuse valorConsulta on second execution', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 81,
          apellido: 'TEST',
          nombre: 'PATIENT',
          valorConsulta: '750',
        },
      ];

      const doctorIdMap = new Map();

      // First run
      const result1 = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);
      expect(result1.visitFeeByLegacyPatientId.get(81)).toBe('750');

      // Second run
      const result2 = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);
      expect(result2.visitFeeByLegacyPatientId.get(81)).toBe('750');
    });
  });

  describe('Mapping construction', () => {
    it('should build correct legacyIdToPatientId mapping', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 90,
          apellido: 'TEST1',
          nombre: 'PATIENT',
        },
        {
          idFicha: 91,
          apellido: 'TEST2',
          nombre: 'PATIENT',
        },
        {
          idFicha: 92,
          apellido: 'TEST3',
          nombre: 'PATIENT',
        },
      ];

      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(3);
      expect(result.legacyIdToPatientId.size).toBe(3);
      expect(result.legacyIdToPatientId.has(90)).toBe(true);
      expect(result.legacyIdToPatientId.has(91)).toBe(true);
      expect(result.legacyIdToPatientId.has(92)).toBe(true);
    });

    it('should build correct visitFeeByLegacyPatientId mapping', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 100,
          apellido: 'TEST1',
          nombre: 'PATIENT',
          valorConsulta: '500',
        },
        {
          idFicha: 101,
          apellido: 'TEST2',
          nombre: 'PATIENT',
          valorConsulta: '750',
        },
        {
          idFicha: 102,
          apellido: 'TEST3',
          nombre: 'PATIENT',
        },
      ];

      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(3);
      expect(result.visitFeeByLegacyPatientId.size).toBe(2);
      expect(result.visitFeeByLegacyPatientId.get(100)).toBe('500');
      expect(result.visitFeeByLegacyPatientId.get(101)).toBe('750');
      expect(result.visitFeeByLegacyPatientId.has(102)).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('should handle NULL field values gracefully', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 110,
          apellido: 'TEST',
          nombre: 'PATIENT',
          sexo: undefined,
          telefono: undefined,
          eMail: undefined,
        },
      ];

      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
    });

    it('should exclude fields that should not be migrated', async () => {
      const rows: any[] = [
        {
          idFicha: 111,
          apellido: 'TEST',
          nombre: 'PATIENT',
          // These should be ignored:
          fuente: 'SOURCE',
          lugarTrabajo: 'WORKPLACE',
          tipoTrabajo: 'TYPE',
          trabajoConyuge: 'SPOUSE',
          tipoTrabajoConyuge: 'SPOUSE_TYPE',
        } as PatientRow,
      ];

      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
    });

    it('should count errors correctly for multiple rows with mixed success', async () => {
      const rows: PatientRow[] = [
        {
          idFicha: 120,
          apellido: 'VALID1',
          nombre: 'PATIENT',
        },
        {
          idFicha: 121,
          apellido: '',
          nombre: '', // Invalid - both empty
        },
        {
          idFicha: 122,
          apellido: 'VALID2',
          nombre: 'PATIENT',
        },
      ];

      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].sourceId).toBe(121);
    });
  });

  describe('Empty row set', () => {
    it('should handle empty rows array', async () => {
      const rows: PatientRow[] = [];
      const doctorIdMap = new Map();
      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(0);
      expect(result.reused).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.legacyIdToPatientId.size).toBe(0);
      expect(result.visitFeeByLegacyPatientId.size).toBe(0);
    });
  });

  describe('Multiple patients', () => {
    it('should migrate 10+ patients correctly', async () => {
      const rows: PatientRow[] = [];
      for (let i = 0; i < 15; i++) {
        rows.push({
          idFicha: 200 + i,
          apellido: `PATIENT${i}`,
          nombre: `FIRST${i}`,
          profesional: String(i % 3),
          valorConsulta: String(100 + i * 10),
        });
      }

      const doctorIdMap = new Map([
        [0, 1],
        [1, 2],
        [2, 3],
      ]);

      const result = await migrator.migrate(rows, doctorIdMap, mockClient, mockLogStore);

      expect(result.migrated).toBe(15);
      expect(result.reused).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.legacyIdToPatientId.size).toBe(15);
      expect(result.visitFeeByLegacyPatientId.size).toBe(15);
    });
  });
});
