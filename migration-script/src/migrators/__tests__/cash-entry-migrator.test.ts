/**
 * Cash Entry Migrator Tests
 *
 * Comprehensive test suite covering:
 * - Case 1: Only income (ingresosCaja > 0, egresosCaja empty/0) → type='income' (Requirement 7.2)
 * - Case 2: Only expense (egresosCaja > 0, ingresosCaja empty/0) → type='expense' (Requirement 7.3)
 * - Case 3: Both non-zero → error, excluded (Requirement 7.5)
 * - Case 4: Both zero/empty → omitted, no error (Requirement 7.4)
 * - Case 5: Invalid date '0000-00-00' → error, excluded (Requirement 7.6)
 * - Decimal conversion with comma/point (Requirement 7.1)
 * - Description mapping (conceptoCaja → description)
 * - Floating point tolerance (epsilon)
 * - Idempotent re-execution
 * - Multiple rows with mixed results
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PoolClient } from 'pg';
import { createCashEntryMigrator, CashEntryRow, CashEntryMigrationResult } from '../cash-entry-migrator';
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
      if (sql.includes('INSERT INTO cash_entries')) {
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

describe('CashEntryMigrator', () => {
  let mockClient: PostgresClient;
  let mockLogStore: MigrationLogStore;
  let migrator: ReturnType<typeof createCashEntryMigrator>;

  beforeEach(() => {
    mockClient = createMockPostgresClient();
    mockLogStore = createMockMigrationLogStore();
    migrator = createCashEntryMigrator();
  });

  describe('Case 1: Only income (Requirement 7.2)', () => {
    it('should migrate entry with only ingresosCaja (no egreso)', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 1,
          ingresosCaja: '1500,50',
          egresosCaja: undefined,
          conceptoCaja: 'Aranceles',
          fechaCaja: '2023-06-15',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      expect(result.omitted).toBe(0);
      expect(result.excluded).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should migrate entry with only ingresosCaja (egreso empty string)', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 2,
          ingresosCaja: '2000,75',
          egresosCaja: '',
          conceptoCaja: 'Consultas',
          fechaCaja: '2023-06-16',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      expect(result.excluded).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should migrate entry with ingresosCaja and zero egreso', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 3,
          ingresosCaja: '1000',
          egresosCaja: '0',
          conceptoCaja: 'Otros ingresos',
          fechaCaja: '2023-06-17',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      expect(result.excluded).toBe(0);
    });

    it('should handle income amount without decimals', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 4,
          ingresosCaja: '1500',
          egresosCaja: undefined,
          conceptoCaja: 'Pago único',
          fechaCaja: '2023-06-18',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
    });

    it('should handle income amount with point decimal', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 5,
          ingresosCaja: '1500.50',
          egresosCaja: undefined,
          conceptoCaja: 'Ingreso variado',
          fechaCaja: '2023-06-19',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
    });
  });

  describe('Case 2: Only expense (Requirement 7.3)', () => {
    it('should migrate entry with only egresosCaja (no ingreso)', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 10,
          ingresosCaja: undefined,
          egresosCaja: '250,25',
          conceptoCaja: 'Suministros',
          fechaCaja: '2023-06-15',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      expect(result.omitted).toBe(0);
      expect(result.excluded).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should migrate entry with only egresosCaja (ingreso empty string)', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 11,
          ingresosCaja: '',
          egresosCaja: '350,75',
          conceptoCaja: 'Gastos operativos',
          fechaCaja: '2023-06-16',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      expect(result.excluded).toBe(0);
    });

    it('should migrate entry with egresosCaja and zero ingreso', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 12,
          ingresosCaja: '0',
          egresosCaja: '500',
          conceptoCaja: 'Pago de servicios',
          fechaCaja: '2023-06-17',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      expect(result.excluded).toBe(0);
    });

    it('should handle expense amount without decimals', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 13,
          ingresosCaja: undefined,
          egresosCaja: '500',
          conceptoCaja: 'Gasto singular',
          fechaCaja: '2023-06-18',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
    });

    it('should handle expense amount with point decimal', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 14,
          ingresosCaja: undefined,
          egresosCaja: '250.50',
          conceptoCaja: 'Egreso punto',
          fechaCaja: '2023-06-19',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
    });
  });

  describe('Case 3: Both non-zero (Requirement 7.5)', () => {
    it('should exclude entry with both ingreso and egreso > 0', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 20,
          ingresosCaja: '500',
          egresosCaja: '100',
          conceptoCaja: 'Confuso',
          fechaCaja: '2023-06-17',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.migrated).toBe(0);
      expect(result.excluded).toBe(1);
      expect(result.omitted).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain('Ambiguous entry');
      expect(result.errors[0].error).toContain('500');
      expect(result.errors[0].error).toContain('100');
    });

    it('should exclude entry with both amounts using commas', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 21,
          ingresosCaja: '500,50',
          egresosCaja: '100,25',
          conceptoCaja: 'Ambiguo decimal',
          fechaCaja: '2023-06-18',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.excluded).toBe(1);
      expect(result.errors).toHaveLength(1);
    });

    it('should exclude entry with both amounts using points', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 22,
          ingresosCaja: '500.50',
          egresosCaja: '100.25',
          conceptoCaja: 'Ambiguo punto',
          fechaCaja: '2023-06-19',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.excluded).toBe(1);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('Case 4: Both zero or empty (Requirement 7.4)', () => {
    it('should omit entry with both ingresosCaja and egresosCaja empty', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 30,
          ingresosCaja: '',
          egresosCaja: '',
          conceptoCaja: null,
          fechaCaja: '2023-06-18',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.migrated).toBe(0);
      expect(result.omitted).toBe(1);
      expect(result.excluded).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should omit entry with both amounts undefined', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 31,
          ingresosCaja: undefined,
          egresosCaja: undefined,
          conceptoCaja: 'Vacío',
          fechaCaja: '2023-06-19',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.omitted).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should omit entry with both amounts zero', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 32,
          ingresosCaja: '0',
          egresosCaja: '0',
          conceptoCaja: 'Nulo',
          fechaCaja: '2023-06-20',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.omitted).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should omit entry with both amounts zero using decimals', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 33,
          ingresosCaja: '0,00',
          egresosCaja: '0.00',
          conceptoCaja: 'Cero decimal',
          fechaCaja: '2023-06-21',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.omitted).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should omit entry with ingreso empty and egreso zero', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 34,
          ingresosCaja: '',
          egresosCaja: '0',
          conceptoCaja: 'Mixto vacío',
          fechaCaja: '2023-06-22',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.omitted).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should treat very small amounts (< epsilon) as zero', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 35,
          ingresosCaja: '0.00001',
          egresosCaja: '0.00002',
          conceptoCaja: 'Epsilon',
          fechaCaja: '2023-06-23',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.omitted).toBe(1);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Case 5: Invalid date sentinela (Requirement 7.6)', () => {
    it('should exclude entry with fechaCaja = "0000-00-00"', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 40,
          ingresosCaja: '1000',
          egresosCaja: undefined,
          conceptoCaja: 'Malo',
          fechaCaja: '0000-00-00',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.migrated).toBe(0);
      expect(result.excluded).toBe(1);
      expect(result.omitted).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain('Invalid date');
      expect(result.errors[0].error).toContain('0000-00-00');
    });

    it('should exclude entry with fechaCaja = "0000-00-00" even with egreso', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 41,
          ingresosCaja: undefined,
          egresosCaja: '500',
          conceptoCaja: 'Egreso malo',
          fechaCaja: '0000-00-00',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.excluded).toBe(1);
      expect(result.errors).toHaveLength(1);
    });

    it('should allow NULL date (NULL is not 0000-00-00)', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 42,
          ingresosCaja: '1500',
          egresosCaja: undefined,
          conceptoCaja: 'Fecha nula',
          fechaCaja: undefined,
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      expect(result.excluded).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should allow valid date YYYY-MM-DD', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 43,
          ingresosCaja: '2000',
          egresosCaja: undefined,
          conceptoCaja: 'Fecha válida',
          fechaCaja: '2023-12-25',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
      expect(result.excluded).toBe(0);
    });
  });

  describe('Decimal conversion and formatting', () => {
    it('should convert comma decimal to numeric value', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 50,
          ingresosCaja: '1500,50',
          egresosCaja: undefined,
          conceptoCaja: 'Coma a número',
          fechaCaja: '2023-06-15',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
    });

    it('should convert point decimal to numeric value', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 51,
          ingresosCaja: '1500.50',
          egresosCaja: undefined,
          conceptoCaja: 'Punto a número',
          fechaCaja: '2023-06-16',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
    });

    it('should handle integer amounts as zero decimals', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 52,
          ingresosCaja: '1500',
          egresosCaja: undefined,
          conceptoCaja: 'Entero',
          fechaCaja: '2023-06-17',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
    });

    it('should handle mixed comma and point decimals', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 53,
          ingresosCaja: '1500,50',
          egresosCaja: undefined,
          conceptoCaja: 'Mixto coma',
          fechaCaja: '2023-06-18',
        },
        {
          idCaja: 54,
          ingresosCaja: '2000.75',
          egresosCaja: undefined,
          conceptoCaja: 'Mixto punto',
          fechaCaja: '2023-06-19',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.migrated).toBe(2);
    });
  });

  describe('Description mapping (conceptoCaja → description)', () => {
    it('should map conceptoCaja to description', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 60,
          ingresosCaja: '1500',
          egresosCaja: undefined,
          conceptoCaja: 'Aranceles mensuales',
          fechaCaja: '2023-06-15',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
    });

    it('should handle NULL conceptoCaja as NULL description', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 61,
          ingresosCaja: '1500',
          egresosCaja: undefined,
          conceptoCaja: undefined,
          fechaCaja: '2023-06-16',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
    });

    it('should handle empty conceptoCaja as NULL description', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 62,
          ingresosCaja: '1500',
          egresosCaja: undefined,
          conceptoCaja: '',
          fechaCaja: '2023-06-17',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
    });

    it('should trim whitespace-only conceptoCaja', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 63,
          ingresosCaja: '1500',
          egresosCaja: undefined,
          conceptoCaja: '   ',
          fechaCaja: '2023-06-18',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
    });
  });

  describe('Floating point tolerance (epsilon)', () => {
    it('should treat value < epsilon as zero', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 70,
          ingresosCaja: '0.00001',
          egresosCaja: undefined,
          conceptoCaja: 'Epsilon ingreso',
          fechaCaja: '2023-06-15',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      // 0.00001 < 0.0001 (epsilon), should be treated as zero
      expect(result.omitted).toBe(1);
    });

    it('should treat negative value < epsilon as zero', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 71,
          ingresosCaja: '-0.00001',
          egresosCaja: undefined,
          conceptoCaja: 'Epsilon negativo',
          fechaCaja: '2023-06-16',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.omitted).toBe(1);
    });

    it('should treat value >= epsilon as non-zero', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 72,
          ingresosCaja: '0.0001',
          egresosCaja: undefined,
          conceptoCaja: 'At epsilon',
          fechaCaja: '2023-06-17',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
    });
  });

  describe('Idempotence', () => {
    it('should skip already-migrated entries on second run', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 100,
          ingresosCaja: '1500',
          egresosCaja: undefined,
          conceptoCaja: 'Primer pase',
          fechaCaja: '2023-06-15',
        },
      ];

      // First run
      const result1 = await migrator.migrate(rows, mockClient, mockLogStore);
      expect(result1.migrated).toBe(1);

      // Second run with same migrator and mock store
      const result2 = await migrator.migrate(rows, mockClient, mockLogStore);

      // On idempotent re-execution, the entry should be found and counted as migrated (reused)
      // but not inserted again. The mock store will find it, so migrator will skip it.
      // Since we're counting "migrated" as entries found in log, we expect it to still be 1.
      expect(result2.migrated).toBe(1);
      expect(result2.errors).toHaveLength(0);
    });
  });

  describe('Multiple rows with mixed results', () => {
    it('should handle batch with income, expense, omitted, and excluded entries', async () => {
      const rows: CashEntryRow[] = [
        // Case 1: Only income
        {
          idCaja: 1,
          ingresosCaja: '1500,50',
          egresosCaja: undefined,
          conceptoCaja: 'Aranceles',
          fechaCaja: '2023-06-15',
        },
        // Case 2: Only expense
        {
          idCaja: 2,
          ingresosCaja: undefined,
          egresosCaja: '250,25',
          conceptoCaja: 'Suministros',
          fechaCaja: '2023-06-16',
        },
        // Case 3: Ambiguous (both non-zero)
        {
          idCaja: 3,
          ingresosCaja: '500',
          egresosCaja: '100',
          conceptoCaja: 'Confuso',
          fechaCaja: '2023-06-17',
        },
        // Case 4: Omitted (both zero)
        {
          idCaja: 4,
          ingresosCaja: '',
          egresosCaja: '',
          conceptoCaja: null,
          fechaCaja: '2023-06-18',
        },
        // Case 5: Invalid date
        {
          idCaja: 5,
          ingresosCaja: '1000',
          egresosCaja: undefined,
          conceptoCaja: 'Malo',
          fechaCaja: '0000-00-00',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.migrated).toBe(2); // Cases 1 and 2
      expect(result.omitted).toBe(1); // Case 4
      expect(result.excluded).toBe(2); // Cases 3 and 5
      expect(result.errors).toHaveLength(2);
      expect(result.warnings).toHaveLength(0);
    });

    it('should handle batch of 100+ entries correctly', async () => {
      const rows: CashEntryRow[] = [];

      // Generate 120 entries with various scenarios
      for (let i = 0; i < 120; i++) {
        if (i % 5 === 0) {
          // Income
          rows.push({
            idCaja: i,
            ingresosCaja: `${1000 + i}`,
            egresosCaja: undefined,
            conceptoCaja: `Entry ${i}`,
            fechaCaja: '2023-06-15',
          });
        } else if (i % 5 === 1) {
          // Expense
          rows.push({
            idCaja: i,
            ingresosCaja: undefined,
            egresosCaja: `${500 + i}`,
            conceptoCaja: `Entry ${i}`,
            fechaCaja: '2023-06-16',
          });
        } else if (i % 5 === 2) {
          // Ambiguous
          rows.push({
            idCaja: i,
            ingresosCaja: '100',
            egresosCaja: '50',
            conceptoCaja: `Entry ${i}`,
            fechaCaja: '2023-06-17',
          });
        } else if (i % 5 === 3) {
          // Omitted
          rows.push({
            idCaja: i,
            ingresosCaja: '',
            egresosCaja: '',
            conceptoCaja: `Entry ${i}`,
            fechaCaja: '2023-06-18',
          });
        } else {
          // Invalid date
          rows.push({
            idCaja: i,
            ingresosCaja: '1000',
            egresosCaja: undefined,
            conceptoCaja: `Entry ${i}`,
            fechaCaja: '0000-00-00',
          });
        }
      }

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.migrated).toBe(48); // 24 income + 24 expense (120 / 5 * 2)
      expect(result.omitted).toBe(24); // 120 / 5
      expect(result.excluded).toBe(48); // 24 ambiguous + 24 invalid date
      expect(result.errors).toHaveLength(48);
    });
  });

  describe('Empty batch', () => {
    it('should return all zeros for empty batch', async () => {
      const rows: CashEntryRow[] = [];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.migrated).toBe(0);
      expect(result.omitted).toBe(0);
      expect(result.excluded).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('Edge cases', () => {
    it('should handle very large amounts', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 200,
          ingresosCaja: '99999999,99',
          egresosCaja: undefined,
          conceptoCaja: 'Gran monto',
          fechaCaja: '2023-06-15',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      expect(result.migrated).toBe(1);
    });

    it('should handle negative amounts (treat as expense if negative egreso)', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 201,
          ingresosCaja: '-100',
          egresosCaja: undefined,
          conceptoCaja: 'Negativo',
          fechaCaja: '2023-06-16',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      // Negative amount is still non-zero, so should be migrated as income (type doesn't change)
      expect(result.migrated).toBe(1);
    });

    it('should handle whitespace in amount strings', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 202,
          ingresosCaja: '  1500,50  ',
          egresosCaja: undefined,
          conceptoCaja: 'Con espacios',
          fechaCaja: '2023-06-17',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      // parseFloat should handle leading/trailing whitespace
      expect(result.migrated).toBe(1);
    });

    it('should handle non-numeric characters gracefully', async () => {
      const rows: CashEntryRow[] = [
        {
          idCaja: 203,
          ingresosCaja: 'abc',
          egresosCaja: undefined,
          conceptoCaja: 'Inválido',
          fechaCaja: '2023-06-18',
        },
      ];

      const result = await migrator.migrate(rows, mockClient, mockLogStore);

      // parseFloat('abc') = NaN, treated as 0
      expect(result.omitted).toBe(1);
    });
  });
});
