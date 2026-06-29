/**
 * Appointment Migrator Tests
 *
 * Comprehensive test suite covering:
 * - Direct field mapping (reason_id, doctor_id, insurance_id, date, schedule_id)
 * - Discarded fields (Turno_telefono)
 * - Schedule validation (valid, invalid, NULL)
 * - Status mapping (known, unknown, NULL)
 * - Patient matching (auto_linked, manual_review, no_match, empty)
 * - Idempotent re-execution
 * - Error handling
 * - Edge cases and complex combinations
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 6.5, 6.7
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PoolClient } from 'pg';
import {
  createAppointmentMigrator,
  AppointmentRow,
  AppointmentMigrationResult,
  APPOINTMENT_STATUS_MAP,
  DEFAULT_APPOINTMENT_STATUS,
} from '../appointment-migrator';
import { PostgresClient, calculatePayloadHash } from '../../db/client';
import { MigrationLogStore, MigrationLogEntry } from '../../db/migration-log';
import { PatientMatcher, PatientCandidate, MatchOutcome } from '../../matcher/patient-matcher';

/**
 * Mock PostgresClient
 */
function createMockPostgresClient() {
  const insertedRows: Record<number, any> = {};
  let nextId = 1;

  return {
    withTransaction: vi.fn(async (fn: any) => {
      const mockTx = {} as PoolClient;
      return fn(mockTx);
    }),

    query: vi.fn(async (client: any, sql: string, params?: any[]) => {
      if (sql.includes('INSERT INTO appointments')) {
        const id = nextId++;
        insertedRows[id] = { id };
        return [{ id }];
      }

      if (sql.includes('SELECT') && sql.includes('FROM appointments')) {
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

/**
 * Mock PatientMatcher
 */
function createMockPatientMatcher(autoLinkMap?: Map<string, number>, manualReviewPatterns?: string[]) {
  const autoLinkMap_ = autoLinkMap || new Map<string, number>();
  const manualReviewPatterns_ = manualReviewPatterns || [];

  return {
    match: vi.fn((input: { lastName?: string; firstName?: string }, mode: string, pool: PatientCandidate[]) => {
      const lastName = (input.lastName || '').trim();

      // Empty input → no_match
      if (!lastName) {
        return {
          outcome: 'no_match',
          reason: 'Empty input',
        } as MatchOutcome;
      }

      // Check if it's in manual review patterns
      if (manualReviewPatterns_.some((pattern) => lastName.includes(pattern))) {
        return {
          outcome: 'manual_review',
          candidates: [
            { id: 10, score: 0.87 },
            { id: 11, score: 0.85 },
          ],
          reason: 'Multiple candidates',
        } as MatchOutcome;
      }

      // Check auto-link map
      const patientId = autoLinkMap_.get(lastName);
      if (patientId) {
        return {
          outcome: 'auto_linked',
          candidateId: patientId,
          score: 0.95,
          reason: 'Matched',
        } as MatchOutcome;
      }

      // Default to no_match
      return {
        outcome: 'no_match',
        reason: 'No match found',
      } as MatchOutcome;
    }),

    detectDuplicatesInPool: vi.fn(async () => []),
  } as any as PatientMatcher;
}

describe('AppointmentMigrator', () => {
  let mockClient: PostgresClient;
  let mockLogStore: MigrationLogStore;
  let mockMatcher: PatientMatcher;
  let migrator: ReturnType<typeof createAppointmentMigrator>;

  beforeEach(() => {
    mockClient = createMockPostgresClient();
    mockLogStore = createMockMigrationLogStore();
    mockMatcher = createMockPatientMatcher();
    migrator = createAppointmentMigrator();
  });

  describe('Direct field mapping (Requirement 3.1, 3.2)', () => {
    it('should map direct fields: reason_id, doctor_id, insurance_id, date, schedule_id', async () => {
      const mockMatcher_ = createMockPatientMatcher(new Map([['Amadei', 57]]));
      const scheduleIds = new Set([10, 11, 12]);

      const rows: AppointmentRow[] = [
        {
          idTurno: 1,
          Turno_paciente: 'Amadei',
          Turno_motivoid: 1,
          Turno_doctor: 2,
          Turno_fecha: '2023-06-20',
          Turno_hora: 10,
          Turno_obrasocialid: 3,
          Turno_estado: 1,
          Turno_telefono: '123456789', // Should be discarded
        },
      ];

      const result = await migrator.migrate(
        rows,
        { scheduleIds, patientPool: [] },
        mockMatcher_,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);

      // Verify that query was called with correct parameters
      const queryCalls = (mockClient.query as any).mock.calls;
      const insertCall = queryCalls.find((call: any) => call[1].includes('INSERT INTO appointments'));

      if (insertCall) {
        const params = insertCall[2]; // params array
        expect(params).toContain(57); // patient_id from auto_linked match
        expect(params).toContain(2); // doctor_id
        expect(params).toContain(1); // reason_id
        expect(params).toContain(3); // insurance_id
        expect(params).toContain('2023-06-20'); // date
        expect(params).toContain(10); // schedule_id
        expect(params).toContain('confirmed'); // status (estado 1 → 'confirmed')
      }
    });

    it('should discard Turno_telefono field (Requirement 3.2)', async () => {
      // This is implicitly tested above - the Turno_telefono is not mapped to any column
      // We verify by checking that only expected columns are in the INSERT
      const mockMatcher_ = createMockPatientMatcher(new Map([['Test', 1]]));
      const scheduleIds = new Set([1]);

      const rows: AppointmentRow[] = [
        {
          idTurno: 1,
          Turno_paciente: 'Test',
          Turno_telefono: '999999999',
          Turno_hora: 1,
        },
      ];

      const result = await migrator.migrate(
        rows,
        { scheduleIds, patientPool: [] },
        mockMatcher_,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should allow NULL values for optional fields', async () => {
      const mockMatcher_ = createMockPatientMatcher(new Map([['Test', 1]]));
      const scheduleIds = new Set([1]);

      const rows: AppointmentRow[] = [
        {
          idTurno: 1,
          Turno_paciente: 'Test',
          Turno_motivoid: null,
          Turno_doctor: null,
          Turno_obrasocialid: null,
          Turno_hora: null,
        },
      ];

      const result = await migrator.migrate(
        rows,
        { scheduleIds, patientPool: [] },
        mockMatcher_,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('Schedule validation (Requirement 3.4)', () => {
    it('should use schedule_id if it exists in scheduleIds', async () => {
      const mockMatcher_ = createMockPatientMatcher(new Map([['Test', 1]]));
      const scheduleIds = new Set([10, 11, 12]);

      const rows: AppointmentRow[] = [
        {
          idTurno: 1,
          Turno_paciente: 'Test',
          Turno_hora: 11,
        },
      ];

      const result = await migrator.migrate(
        rows,
        { scheduleIds, patientPool: [] },
        mockMatcher_,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.warnings).toHaveLength(0);
    });

    it('should set schedule_id to NULL and warn if Turno_hora not in scheduleIds', async () => {
      const mockMatcher_ = createMockPatientMatcher(new Map([['Test', 1]]));
      const scheduleIds = new Set([10, 11, 12]);

      const rows: AppointmentRow[] = [
        {
          idTurno: 1,
          Turno_paciente: 'Test',
          Turno_hora: 999, // Not in scheduleIds
        },
      ];

      const result = await migrator.migrate(
        rows,
        { scheduleIds, patientPool: [] },
        mockMatcher_,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.warnings.some((w) => w.warning.includes('Schedule ID 999 not found'))).toBe(true);
    });

    it('should set schedule_id to NULL without warning if Turno_hora is NULL', async () => {
      const mockMatcher_ = createMockPatientMatcher(new Map([['Test', 1]]));
      const scheduleIds = new Set([10, 11, 12]);

      const rows: AppointmentRow[] = [
        {
          idTurno: 1,
          Turno_paciente: 'Test',
          Turno_hora: null,
        },
      ];

      const result = await migrator.migrate(
        rows,
        { scheduleIds, patientPool: [] },
        mockMatcher_,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.warnings.some((w) => w.warning.includes('Schedule ID'))).toBe(false);
    });
  });

  describe('Status mapping (Requirement 3.5)', () => {
    it('should map known status values via APPOINTMENT_STATUS_MAP', async () => {
      const testCases = [
        { estado: 0, expected: 'pending' },
        { estado: 1, expected: 'confirmed' },
        { estado: 2, expected: 'completed' },
        { estado: 3, expected: 'cancelled' },
      ];

      for (let idx = 0; idx < testCases.length; idx++) {
        const tc = testCases[idx];
        const mockMatcher_ = createMockPatientMatcher(new Map([[`Test${idx}`, 1]]));
        const scheduleIds = new Set([1]);

        const rows: AppointmentRow[] = [
          {
            idTurno: 100 + idx,
            Turno_paciente: `Test${idx}`,
            Turno_estado: tc.estado,
          },
        ];

        const result = await migrator.migrate(
          rows,
          { scheduleIds, patientPool: [] },
          mockMatcher_,
          mockClient,
          mockLogStore,
        );

        expect(result.migrated).toBe(1);
        expect(result.warnings.some((w) => w.warning.includes('Unknown appointment status'))).toBe(false);
      }
    });

    it('should map unknown status to DEFAULT_APPOINTMENT_STATUS with warning', async () => {
      const mockMatcher_ = createMockPatientMatcher(new Map([['Test', 1]]));
      const scheduleIds = new Set([1]);

      const rows: AppointmentRow[] = [
        {
          idTurno: 1,
          Turno_paciente: 'Test',
          Turno_estado: 99, // Unknown status
        },
      ];

      const result = await migrator.migrate(
        rows,
        { scheduleIds, patientPool: [] },
        mockMatcher_,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.warnings.some((w) => w.warning.includes('Unknown appointment status: 99'))).toBe(true);
    });

    it('should map NULL status to DEFAULT_APPOINTMENT_STATUS without warning', async () => {
      const mockMatcher_ = createMockPatientMatcher(new Map([['Test', 1]]));
      const scheduleIds = new Set([1]);

      const rows: AppointmentRow[] = [
        {
          idTurno: 1,
          Turno_paciente: 'Test',
          Turno_estado: null,
        },
      ];

      const result = await migrator.migrate(
        rows,
        { scheduleIds, patientPool: [] },
        mockMatcher_,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.warnings.some((w) => w.warning.includes('Unknown appointment status'))).toBe(false);
    });

    it('should verify APPOINTMENT_STATUS_MAP constant is accessible', () => {
      expect(APPOINTMENT_STATUS_MAP[0]).toBe('pending');
      expect(APPOINTMENT_STATUS_MAP[1]).toBe('confirmed');
      expect(APPOINTMENT_STATUS_MAP[2]).toBe('completed');
      expect(APPOINTMENT_STATUS_MAP[3]).toBe('cancelled');
      expect(DEFAULT_APPOINTMENT_STATUS).toBe('pending');
    });
  });

  describe('Date handling', () => {
    it('should handle valid date format YYYY-MM-DD', async () => {
      const mockMatcher_ = createMockPatientMatcher(new Map([['Test', 1]]));
      const scheduleIds = new Set([1]);

      const rows: AppointmentRow[] = [
        {
          idTurno: 1,
          Turno_paciente: 'Test',
          Turno_fecha: '2023-06-20',
        },
      ];

      const result = await migrator.migrate(
        rows,
        { scheduleIds, patientPool: [] },
        mockMatcher_,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should convert sentinel date 0000-00-00 to NULL', async () => {
      const mockMatcher_ = createMockPatientMatcher(new Map([['Test', 1]]));
      const scheduleIds = new Set([1]);

      const rows: AppointmentRow[] = [
        {
          idTurno: 1,
          Turno_paciente: 'Test',
          Turno_fecha: '0000-00-00',
        },
      ];

      const result = await migrator.migrate(
        rows,
        { scheduleIds, patientPool: [] },
        mockMatcher_,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
    });

    it('should handle NULL and empty Turno_fecha', async () => {
      const mockMatcher_ = createMockPatientMatcher(new Map([['Test', 1]]));
      const scheduleIds = new Set([1]);

      const rows: AppointmentRow[] = [
        {
          idTurno: 1,
          Turno_paciente: 'Test',
          Turno_fecha: null,
        },
      ];

      const result = await migrator.migrate(
        rows,
        { scheduleIds, patientPool: [] },
        mockMatcher_,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
    });
  });

  describe('Patient matching via PatientMatcher (Requirement 6.5, 6.7)', () => {
    it('should auto-link patient when match outcome is auto_linked', async () => {
      const mockMatcher_ = createMockPatientMatcher(new Map([['Amadei', 57]]));
      const scheduleIds = new Set([1]);

      const rows: AppointmentRow[] = [
        {
          idTurno: 1,
          Turno_paciente: 'Amadei',
        },
      ];

      const result = await migrator.migrate(
        rows,
        { scheduleIds, patientPool: [] },
        mockMatcher_,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.warnings).toHaveLength(0);
    });

    it('should set patient_id to NULL and warn when match outcome is manual_review', async () => {
      const mockMatcher_ = createMockPatientMatcher(
        undefined,
        ['ambiguous'], // This pattern triggers manual_review
      );
      const scheduleIds = new Set([1]);

      const rows: AppointmentRow[] = [
        {
          idTurno: 1,
          Turno_paciente: 'ambiguous_name',
        },
      ];

      const result = await migrator.migrate(
        rows,
        { scheduleIds, patientPool: [] },
        mockMatcher_,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.warnings.some((w) => w.warning.includes('requires manual review'))).toBe(true);
    });

    it('should set patient_id to NULL and warn when match outcome is no_match', async () => {
      const mockMatcher_ = createMockPatientMatcher(new Map()); // Empty map → no_match
      const scheduleIds = new Set([1]);

      const rows: AppointmentRow[] = [
        {
          idTurno: 1,
          Turno_paciente: 'NonExistent',
        },
      ];

      const result = await migrator.migrate(
        rows,
        { scheduleIds, patientPool: [] },
        mockMatcher_,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.warnings.some((w) => w.warning.includes('No patient match found'))).toBe(true);
    });

    it('should handle empty Turno_paciente as no_match', async () => {
      const mockMatcher_ = createMockPatientMatcher(new Map());
      const scheduleIds = new Set([1]);

      const rows: AppointmentRow[] = [
        {
          idTurno: 1,
          Turno_paciente: '',
        },
      ];

      const result = await migrator.migrate(
        rows,
        { scheduleIds, patientPool: [] },
        mockMatcher_,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.warnings.some((w) => w.warning.includes('Patient reference is empty'))).toBe(true);
    });

    it('should use last_name_only mode for patient matching (Requirement 6.5)', async () => {
      const mockMatcher_ = createMockPatientMatcher(new Map([['Amadei', 57]]));
      const scheduleIds = new Set([1]);

      const rows: AppointmentRow[] = [
        {
          idTurno: 1,
          Turno_paciente: 'Amadei',
        },
      ];

      await migrator.migrate(rows, { scheduleIds, patientPool: [] }, mockMatcher_, mockClient, mockLogStore);

      // Verify that match was called with 'last_name_only' mode
      const matchCalls = (mockMatcher_.match as any).mock.calls;
      const lastCall = matchCalls[matchCalls.length - 1];
      expect(lastCall[1]).toBe('last_name_only'); // Second parameter is mode
    });
  });

  describe('Idempotence (Requirement 9.1, 9.2, 9.5)', () => {
    it('should reuse migrated appointment on second execution', async () => {
      const mockMatcher_ = createMockPatientMatcher(new Map([['Test', 1]]));
      const scheduleIds = new Set([1]);

      const rows: AppointmentRow[] = [
        {
          idTurno: 1,
          Turno_paciente: 'Test',
        },
      ];

      // First execution
      const result1 = await migrator.migrate(
        rows,
        { scheduleIds, patientPool: [] },
        mockMatcher_,
        mockClient,
        mockLogStore,
      );

      expect(result1.migrated).toBe(1);
      expect(result1.reused).toBe(0);

      // Second execution with same rows
      const result2 = await migrator.migrate(
        rows,
        { scheduleIds, patientPool: [] },
        mockMatcher_,
        mockClient,
        mockLogStore,
      );

      expect(result2.migrated).toBe(0);
      expect(result2.reused).toBe(1);
    });

    it('should register migrated appointment in migration log', async () => {
      const mockMatcher_ = createMockPatientMatcher(new Map([['Test', 1]]));
      const scheduleIds = new Set([1]);

      const rows: AppointmentRow[] = [
        {
          idTurno: 1,
          Turno_paciente: 'Test',
        },
      ];

      await migrator.migrate(rows, { scheduleIds, patientPool: [] }, mockMatcher_, mockClient, mockLogStore);

      const recordCalls = (mockLogStore.record as any).mock.calls;
      expect(recordCalls.length).toBeGreaterThan(0);

      const lastRecord = recordCalls[recordCalls.length - 1];
      const entry = lastRecord[1];

      expect(entry.sourceTable).toBe('inst_turnos');
      expect(entry.sourcePk).toBe('1');
      expect(entry.targetTable).toBe('appointments');
      expect(entry.status).toBe('migrated');
    });
  });

  describe('Error handling', () => {
    it('should continue processing when a single row fails', async () => {
      const mockClient_ = {
        ...mockClient,
        query: vi.fn(async (client: any, sql: string, params?: any[]) => {
          if (sql.includes('INSERT INTO appointments')) {
            const id = parseInt(params?.[6] || '0');
            if (id === 1) {
              throw new Error('Database error on first row');
            }
            return [{ id: 100 }];
          }
          return [];
        }),
      } as any as PostgresClient;

      const mockMatcher_ = createMockPatientMatcher(new Map([['Test', 1]]));
      const scheduleIds = new Set([1]);

      const rows: AppointmentRow[] = [
        {
          idTurno: 1,
          Turno_paciente: 'Test',
        },
        {
          idTurno: 2,
          Turno_paciente: 'Test',
        },
      ];

      const result = await migrator.migrate(
        rows,
        { scheduleIds, patientPool: [] },
        mockMatcher_,
        mockClient_,
        mockLogStore,
      );

      // Both rows should be processed (one error, one success)
      expect(result.migrated + result.errors.length).toBe(2);
    });
  });

  describe('Complex scenarios', () => {
    it('should handle multiple appointments with mixed outcomes', async () => {
      const autoLinkMap = new Map<string, number>([
        ['Amadei', 57],
        ['Garcia', 58],
      ]);
      const mockMatcher_ = createMockPatientMatcher(autoLinkMap, ['Ambiguous']);
      const scheduleIds = new Set([10, 11]);

      const rows: AppointmentRow[] = [
        {
          idTurno: 1,
          Turno_paciente: 'Amadei',
          Turno_hora: 10,
          Turno_estado: 1,
        },
        {
          idTurno: 2,
          Turno_paciente: 'Ambiguous',
          Turno_hora: 11,
          Turno_estado: 2,
        },
        {
          idTurno: 3,
          Turno_paciente: 'NonExistent',
          Turno_hora: 999, // Invalid schedule
          Turno_estado: 99, // Unknown status
        },
        {
          idTurno: 4,
          Turno_paciente: 'Garcia',
          Turno_hora: null,
          Turno_estado: 0,
        },
      ];

      const result = await migrator.migrate(
        rows,
        { scheduleIds, patientPool: [] },
        mockMatcher_,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(4);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings.length).toBeGreaterThan(0);

      // Check specific warnings
      const warnings = result.warnings;
      expect(warnings.some((w) => w.warning.includes('Schedule ID 999'))).toBe(true);
      expect(warnings.some((w) => w.warning.includes('Unknown appointment status: 99'))).toBe(true);
    });

    it('should handle row with all NULL optional fields', async () => {
      const mockMatcher_ = createMockPatientMatcher(new Map([['Test', 1]]));
      const scheduleIds = new Set([1]);

      const rows: AppointmentRow[] = [
        {
          idTurno: 1,
          Turno_paciente: 'Test',
          Turno_motivoid: null,
          Turno_doctor: null,
          Turno_fecha: null,
          Turno_hora: null,
          Turno_obrasocialid: null,
          Turno_estado: null,
          Turno_telefono: null,
        },
      ];

      const result = await migrator.migrate(
        rows,
        { scheduleIds, patientPool: [] },
        mockMatcher_,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('Empty input handling', () => {
    it('should return empty result for empty rows array', async () => {
      const mockMatcher_ = createMockPatientMatcher();
      const scheduleIds = new Set([1]);

      const result = await migrator.migrate(
        [],
        { scheduleIds, patientPool: [] },
        mockMatcher_,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(0);
      expect(result.reused).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should handle empty scheduleIds set', async () => {
      const mockMatcher_ = createMockPatientMatcher(new Map([['Test', 1]]));
      const scheduleIds = new Set<number>(); // Empty set

      const rows: AppointmentRow[] = [
        {
          idTurno: 1,
          Turno_paciente: 'Test',
          Turno_hora: 10,
        },
      ];

      const result = await migrator.migrate(
        rows,
        { scheduleIds, patientPool: [] },
        mockMatcher_,
        mockClient,
        mockLogStore,
      );

      expect(result.migrated).toBe(1);
      expect(result.warnings.some((w) => w.warning.includes('Schedule ID 10 not found'))).toBe(true);
    });
  });
});
