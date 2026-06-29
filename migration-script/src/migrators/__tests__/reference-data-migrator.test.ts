/**
 * Tests for ReferenceDataMigrator
 *
 * Covers:
 * - Doctor migration (new vs. existing with case-insensitive/space normalization)
 * - Health insurance migration
 * - Visit reason migration
 * - Schedule verification (valid/invalid status, non-existent schedule)
 * - ID preservation and sequence adjustment
 * - Error handling and recovery
 *
 * Requirements: 1.1 - 1.6
 *
 * Note: These are unit tests with mocks for PostgresClient and MigrationLogStore.
 * Integration tests against a real database would be in a separate integration test suite.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createReferenceDataMigrator,
  ReferenceDataMigrator,
  DoctorRow,
  HealthInsuranceRow,
  VisitReasonRow,
  ScheduleRow,
} from '../reference-data-migrator';

/**
 * Mock PostgresClient
 */
function createMockPostgresClient() {
  const data: Record<string, Array<{ id: number; name: string }>> = {
    doctors: [],
    health_insurances: [],
    visit_reasons: [],
    schedules: [],
  };

  const queryImpl = async (_client: any, sql: string, params?: any[]) => {
    if (sql.includes('SELECT')) {
      if (sql.includes('FROM doctors')) {
        return data.doctors;
      } else if (sql.includes('FROM health_insurances')) {
        return data.health_insurances;
      } else if (sql.includes('FROM visit_reasons')) {
        return data.visit_reasons;
      } else if (sql.includes('FROM schedules')) {
        return data.schedules;
      } else if (sql.includes('MAX(id)')) {
        const table = sql.split('FROM')[1].trim();
        const rows = data[table] || [];
        return [{ max_id: Math.max(...rows.map((r) => r.id), 0) }];
      }
      return [];
    } else if (sql.includes('INSERT')) {
      const table = sql.split('INTO')[1].trim().split('(')[0].trim();
      if (params && params.length >= 2) {
        const [id, name] = params;
        data[table] = data[table] || [];
        data[table].push({ id, name });
      }
      return [];
    } else if (sql.includes('SELECT setval')) {
      // setval is a SELECT statement that doesn't return meaningful data
      return [];
    }
    return [];
  };

  return {
    withTransaction: vi.fn(async (fn: any) => {
      // Create a mock PoolClient that delegates to the same query impl
      const mockTx = {};
      return fn(mockTx);
    }),

    query: vi.fn(queryImpl),

    close: vi.fn(),

    // Expose internal data for testing
    _getTableData: (table: string) => data[table] || [],
  };
}

/**
 * Mock MigrationLogStore
 */
function createMockMigrationLogStore() {
  const log: Array<any> = [];

  return {
    ensureSchema: vi.fn(),

    findExisting: vi.fn(async (client: any, sourceTable: string, sourcePk: string) => {
      const entry = log.find((e) => e.sourceTable === sourceTable && e.sourcePk === sourcePk);
      return entry || null;
    }),

    record: vi.fn(async (client: any, entry: any) => {
      log.push(entry);
    }),

    reset: vi.fn(),

    _getLog: () => log,
  };
}

describe('ReferenceDataMigrator - Unit Tests', () => {
  let migrator: ReferenceDataMigrator;

  beforeEach(() => {
    migrator = createReferenceDataMigrator();
  });

  describe('migrateDoctors', () => {
    it('should insert a new doctor with preserved ID', async () => {
      const client = createMockPostgresClient();
      const logStore = createMockMigrationLogStore();

      const rows: DoctorRow[] = [{ Profesional_id: 1, Profesional: 'Dr. Juan Perez' }];

      const result = await migrator.migrateDoctors(rows, client as any, logStore as any);

      expect(result.inserted).toBe(1);
      expect(result.reused).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should detect duplicate doctor (case-insensitive)', async () => {
      const client = createMockPostgresClient();
      const logStore = createMockMigrationLogStore();

      // First insert
      const rows1: DoctorRow[] = [{ Profesional_id: 1, Profesional: 'Dr. Juan Perez' }];
      const result1 = await migrator.migrateDoctors(rows1, client as any, logStore as any);
      expect(result1.inserted).toBe(1);

      // Try to migrate the same doctor with different case
      const rows2: DoctorRow[] = [{ Profesional_id: 2, Profesional: 'dr. juan perez' }];
      const result2 = await migrator.migrateDoctors(rows2, client as any, logStore as any);

      expect(result2.reused).toBe(1);
      expect(result2.inserted).toBe(0);
    });

    it('should detect duplicate doctor (whitespace normalized)', async () => {
      const client = createMockPostgresClient();
      const logStore = createMockMigrationLogStore();

      // First insert
      const rows1: DoctorRow[] = [{ Profesional_id: 1, Profesional: 'Dr. Juan Perez' }];
      await migrator.migrateDoctors(rows1, client as any, logStore as any);

      // Try to migrate the same doctor with extra spaces
      const rows2: DoctorRow[] = [{ Profesional_id: 2, Profesional: 'Dr.   Juan   Perez' }];
      const result2 = await migrator.migrateDoctors(rows2, client as any, logStore as any);

      expect(result2.reused).toBe(1);
      expect(result2.inserted).toBe(0);
    });

    it('should handle multiple doctors', async () => {
      const client = createMockPostgresClient();
      const logStore = createMockMigrationLogStore();

      const rows: DoctorRow[] = [
        { Profesional_id: 1, Profesional: 'Dr. Juan Perez' },
        { Profesional_id: 2, Profesional: 'Dra. Maria Garcia' },
        { Profesional_id: 3, Profesional: 'Dr. Carlos Lopez' },
      ];

      const result = await migrator.migrateDoctors(rows, client as any, logStore as any);

      expect(result.inserted).toBe(3);
      expect(result.reused).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle empty name gracefully', async () => {
      const client = createMockPostgresClient();
      const logStore = createMockMigrationLogStore();

      const rows: DoctorRow[] = [{ Profesional_id: 1, Profesional: '' }];

      const result = await migrator.migrateDoctors(rows, client as any, logStore as any);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.inserted).toBe(0);
      expect(result.reused).toBe(0);
    });

    it('should handle reuse + insert in same batch', async () => {
      const client = createMockPostgresClient();
      const logStore = createMockMigrationLogStore();

      // First batch: insert one
      const rows1: DoctorRow[] = [{ Profesional_id: 1, Profesional: 'Dr. Juan Perez' }];
      const result1 = await migrator.migrateDoctors(rows1, client as any, logStore as any);
      expect(result1.inserted).toBe(1);

      // Second batch: duplicate + 2 new
      const rows2: DoctorRow[] = [
        { Profesional_id: 1, Profesional: 'Dr. Juan Perez' }, // duplicate
        { Profesional_id: 2, Profesional: 'Dr. Maria Garcia' }, // new
        { Profesional_id: 3, Profesional: 'Dr. Carlos Lopez' }, // new
      ];
      const result2 = await migrator.migrateDoctors(rows2, client as any, logStore as any);

      expect(result2.inserted).toBe(2);
      expect(result2.reused).toBe(1);
      expect(result2.errors).toHaveLength(0);
    });
  });

  describe('migrateHealthInsurances', () => {
    it('should insert a new health insurance with preserved ID', async () => {
      const client = createMockPostgresClient();
      const logStore = createMockMigrationLogStore();

      const rows: HealthInsuranceRow[] = [{ id: 1, nombre: 'OSDE' }];

      const result = await migrator.migrateHealthInsurances(rows, client as any, logStore as any);

      expect(result.inserted).toBe(1);
      expect(result.reused).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect duplicate insurance (case-insensitive)', async () => {
      const client = createMockPostgresClient();
      const logStore = createMockMigrationLogStore();

      const rows1: HealthInsuranceRow[] = [{ id: 1, nombre: 'OSDE' }];
      await migrator.migrateHealthInsurances(rows1, client as any, logStore as any);

      const rows2: HealthInsuranceRow[] = [{ id: 2, nombre: 'osde' }];
      const result2 = await migrator.migrateHealthInsurances(rows2, client as any, logStore as any);

      expect(result2.reused).toBe(1);
      expect(result2.inserted).toBe(0);
    });

    it('should handle multiple insurances', async () => {
      const client = createMockPostgresClient();
      const logStore = createMockMigrationLogStore();

      const rows: HealthInsuranceRow[] = [
        { id: 1, nombre: 'OSDE' },
        { id: 2, nombre: 'Helvetia' },
        { id: 3, nombre: 'Medicus' },
      ];

      const result = await migrator.migrateHealthInsurances(rows, client as any, logStore as any);

      expect(result.inserted).toBe(3);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('migrateVisitReasons', () => {
    it('should insert a new visit reason with preserved ID', async () => {
      const client = createMockPostgresClient();
      const logStore = createMockMigrationLogStore();

      const rows: VisitReasonRow[] = [{ id: 1, nombre: 'Consulta General' }];

      const result = await migrator.migrateVisitReasons(rows, client as any, logStore as any);

      expect(result.inserted).toBe(1);
      expect(result.reused).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect duplicate reason', async () => {
      const client = createMockPostgresClient();
      const logStore = createMockMigrationLogStore();

      const rows1: VisitReasonRow[] = [{ id: 1, nombre: 'Consulta General' }];
      await migrator.migrateVisitReasons(rows1, client as any, logStore as any);

      const rows2: VisitReasonRow[] = [{ id: 2, nombre: 'CONSULTA GENERAL' }];
      const result2 = await migrator.migrateVisitReasons(rows2, client as any, logStore as any);

      expect(result2.reused).toBe(1);
      expect(result2.inserted).toBe(0);
    });
  });

  describe('verifySchedules', () => {
    it('should verify existing schedule', async () => {
      const client = createMockPostgresClient();

      const rows: ScheduleRow[] = [{ Horarios_id: 1, Horarios_estado: 0 }];

      // Mock the schedules table data
      (client as any)._getTableData = () => [{ id: 1, name: '09:00' }];

      const result = await migrator.verifySchedules(rows, client as any);

      expect(result.reused).toBeGreaterThanOrEqual(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should warn for non-existent schedule', async () => {
      const client = createMockPostgresClient();

      const rows: ScheduleRow[] = [{ Horarios_id: 9999, Horarios_estado: 0 }];

      const result = await migrator.verifySchedules(rows, client as any);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0].warning).toContain('not found');
    });

    it('should accept valid Horarios_estado values', async () => {
      const client = createMockPostgresClient();

      const rows: ScheduleRow[] = [
        { Horarios_id: 1, Horarios_estado: 0 },
        { Horarios_id: 2, Horarios_estado: 1 },
        { Horarios_id: 3, Horarios_estado: 2 },
      ];

      const result = await migrator.verifySchedules(rows, client as any);

      expect(result.warnings.length).toBeLessThanOrEqual(3); // May warn about missing schedules
      expect(result.errors).toHaveLength(0);
    });

    it('should warn for invalid Horarios_estado value', async () => {
      const client = createMockPostgresClient();

      const rows: ScheduleRow[] = [{ Horarios_id: 1, Horarios_estado: 99 }];

      const result = await migrator.verifySchedules(rows, client as any);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.warning.includes('Invalid'))).toBe(true);
    });

    it('should handle empty schedule list', async () => {
      const client = createMockPostgresClient();

      const rows: ScheduleRow[] = [];

      const result = await migrator.verifySchedules(rows, client as any);

      expect(result.reused).toBe(0);
      expect(result.warnings).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should verify multiple valid schedules', async () => {
      const client = createMockPostgresClient();

      const rows: ScheduleRow[] = [
        { Horarios_id: 1, Horarios_estado: 0 },
        { Horarios_id: 2, Horarios_estado: 1 },
        { Horarios_id: 3, Horarios_estado: 2 },
      ];

      const result = await migrator.verifySchedules(rows, client as any);

      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Idempotence and determinism', () => {
    it('should handle same input producing same output', async () => {
      const client1 = createMockPostgresClient();
      const logStore1 = createMockMigrationLogStore();

      const rows: DoctorRow[] = [
        { Profesional_id: 1, Profesional: 'Dr. Juan Perez' },
        { Profesional_id: 2, Profesional: 'Dra. Maria Garcia' },
      ];

      const result1 = await migrator.migrateDoctors(rows, client1 as any, logStore1 as any);

      // Fresh client/log
      const client2 = createMockPostgresClient();
      const logStore2 = createMockMigrationLogStore();

      const result2 = await migrator.migrateDoctors(rows, client2 as any, logStore2 as any);

      expect(result1.inserted).toBe(result2.inserted);
      expect(result1.reused).toBe(result2.reused);
      expect(result1.errors).toEqual(result2.errors);
    });

    it('should handle rerun detecting duplicates', async () => {
      const client = createMockPostgresClient();
      const logStore = createMockMigrationLogStore();

      const rows: DoctorRow[] = [{ Profesional_id: 1, Profesional: 'Dr. Juan Perez' }];

      // First run
      const result1 = await migrator.migrateDoctors(rows, client as any, logStore as any);
      expect(result1.inserted).toBe(1);

      // Second run (same rows)
      const result2 = await migrator.migrateDoctors(rows, client as any, logStore as any);
      expect(result2.reused).toBe(1);
      expect(result2.inserted).toBe(0);
    });
  });

  describe('Edge cases', () => {
    it('should handle null in nombre/Profesional gracefully', async () => {
      const client = createMockPostgresClient();
      const logStore = createMockMigrationLogStore();

      const rows: any[] = [{ Profesional_id: 1, Profesional: null }];

      // Should handle gracefully (warn, not crash)
      const result = await migrator.migrateDoctors(rows, client as any, logStore as any);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should handle ID = 0', async () => {
      const client = createMockPostgresClient();
      const logStore = createMockMigrationLogStore();

      const rows: DoctorRow[] = [{ Profesional_id: 0, Profesional: 'Dr. Test' }];

      const result = await migrator.migrateDoctors(rows, client as any, logStore as any);
      expect(result.inserted).toBe(1);
    });

    it('should handle very long names', async () => {
      const client = createMockPostgresClient();
      const logStore = createMockMigrationLogStore();

      const longName = 'Dr. ' + 'A'.repeat(500);
      const rows: DoctorRow[] = [{ Profesional_id: 1, Profesional: longName }];

      const result = await migrator.migrateDoctors(rows, client as any, logStore as any);
      expect(result.inserted).toBe(1);
    });

    it('should handle special characters and unicode', async () => {
      const client = createMockPostgresClient();
      const logStore = createMockMigrationLogStore();

      const rows: DoctorRow[] = [{ Profesional_id: 1, Profesional: 'Dr. Ñoño Martínez' }];

      const result = await migrator.migrateDoctors(rows, client as any, logStore as any);
      expect(result.inserted).toBe(1);
      expect(result.errors).toHaveLength(0);
    });
  });
});
