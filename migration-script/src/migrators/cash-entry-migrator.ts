/**
 * Cash Entry Migrator
 *
 * Handles migration of caja (cash entries) to cash_entries table.
 * Covers Requirements 7.1 - 7.7
 *
 * Key features:
 * - Converts ingresosCaja/egresosCaja from VARCHAR with comma decimal to DECIMAL
 * - Classifies entries as 'income' (only ingreso) or 'expense' (only egreso)
 * - Detects and excludes ambiguous entries (both ingreso and egreso present)
 * - Silently omits empty entries (both zero/empty, no error)
 * - Validates fechaCaja, excluding sentinel date '0000-00-00'
 * - Maps conceptoCaja to description
 * - Supports idempotent re-execution via MigrationLogStore
 */

import { PoolClient } from 'pg';
import { PostgresClient, calculatePayloadHash } from '../db/client';
import { MigrationLogStore } from '../db/migration-log';

/**
 * Epsilon for floating point comparison to zero
 * Requirement 7.1
 */
const EPSILON = 0.0001;

/**
 * Raw cash entry row from caja table dump
 * Requirement 7.1, 7.2, 7.3
 */
export type CashEntryRow = {
  idCaja: number;
  ingresosCaja?: string; // VARCHAR with comma decimal (e.g., "1500,50")
  egresosCaja?: string; // VARCHAR with comma decimal (e.g., "250,25")
  conceptoCaja?: string;
  fechaCaja?: string; // 'YYYY-MM-DD' or '0000-00-00' (sentinel)
};

/**
 * Result of cash entry migration
 * Requirement 7.1
 */
export type CashEntryMigrationResult = {
  /** Number of new cash entries inserted */
  migrated: number;
  /** Number of entries omitted (both zero/empty, not an error) */
  omitted: number;
  /** Number of entries excluded (ambiguous or invalid date) */
  excluded: number;
  /** Errors encountered (prevents row from being counted) */
  errors: Array<{ sourceId: number; error: string }>;
  /** Warnings (row processed but with some issue) */
  warnings: Array<{ sourceId: number; warning: string }>;
};

export type CashEntryMigrator = {
  migrate(
    rows: CashEntryRow[],
    client: PostgresClient,
    logStore: MigrationLogStore,
  ): Promise<CashEntryMigrationResult>;
};

/**
 * Convert VARCHAR with comma or point decimal to number
 * Handles both "1500,50" (comma) and "1500.50" (point)
 * Requirement 7.1
 */
function parseDecimalAmount(amountStr?: string): number {
  if (!amountStr || amountStr.trim() === '') {
    return 0;
  }

  // Replace comma with point if present
  const normalized = amountStr.replace(',', '.');
  const parsed = parseFloat(normalized);

  if (isNaN(parsed)) {
    return 0;
  }

  return parsed;
}

/**
 * Check if a number is approximately zero (within epsilon tolerance)
 * Requirement 7.1
 */
function isApproximatelyZero(value: number): boolean {
  return Math.abs(value) < EPSILON;
}

/**
 * Convert sentinel date ('0000-00-00') to null, or return the date as-is if valid
 * Requirement 7.6
 */
function normalizeDateField(dateStr?: string): string | null {
  if (!dateStr || dateStr === '') {
    return null;
  }

  // Requirement 7.6: Sentinel date '0000-00-00' is invalid
  if (dateStr === '0000-00-00') {
    return null; // Signal invalid (handled by caller with error)
  }

  return dateStr;
}

/**
 * Normalize description field (NULL or empty string to NULL)
 */
function normalizeDescription(desc?: string): string | null {
  if (!desc || desc.trim() === '') {
    return null;
  }

  return desc;
}

/**
 * Create a CashEntryMigrator instance
 */
export function createCashEntryMigrator(): CashEntryMigrator {
  return {
    async migrate(
      rows: CashEntryRow[],
      client: PostgresClient,
      logStore: MigrationLogStore,
    ): Promise<CashEntryMigrationResult> {
      const result: CashEntryMigrationResult = {
        migrated: 0,
        omitted: 0,
        excluded: 0,
        errors: [],
        warnings: [],
      };

      if (rows.length === 0) {
        return result;
      }

      await client.withTransaction(async (tx: PoolClient) => {
        for (const row of rows) {
          try {
            const sourcePk = String(row.idCaja);

            // Step 1: Check for idempotence
            // Requirement 9.1
            const existing = await logStore.findExisting(tx, 'caja', sourcePk);
            if (existing) {
              // Reuse existing cash entry
              result.migrated++;
              continue;
            }

            // Step 2: Validate date first
            // Requirement 7.6
            if (row.fechaCaja === '0000-00-00') {
              result.excluded++;
              result.errors.push({
                sourceId: row.idCaja,
                error: 'Invalid date: 0000-00-00',
              });
              continue;
            }

            // Step 3: Parse amounts
            // Requirement 7.1
            const ingreso = parseDecimalAmount(row.ingresosCaja);
            const egreso = parseDecimalAmount(row.egresosCaja);

            const ingresoIsZero = isApproximatelyZero(ingreso);
            const egresoIsZero = isApproximatelyZero(egreso);

            // Step 4: Classify entry type
            // Requirements 7.2-7.5

            // Requirement 7.4: Both zero or empty → omit (no error, no warning)
            if (ingresoIsZero && egresoIsZero) {
              result.omitted++;
              continue;
            }

            // Requirement 7.5: Both non-zero → error (ambiguous)
            if (!ingresoIsZero && !egresoIsZero) {
              result.excluded++;
              result.errors.push({
                sourceId: row.idCaja,
                error: `Ambiguous entry: both income (${ingreso}) and expense (${egreso}) values present`,
              });
              continue;
            }

            // Determine type
            // Requirement 7.2: Only ingreso → type='income'
            // Requirement 7.3: Only egreso → type='expense'
            let type: 'income' | 'expense';
            let amount: number;

            if (!ingresoIsZero) {
              type = 'income';
              amount = ingreso;
            } else {
              type = 'expense';
              amount = egreso;
            }

            // Step 5: Transform fields
            const dateValue = normalizeDateField(row.fechaCaja);
            const descriptionValue = normalizeDescription(row.conceptoCaja);

            // Step 6: Build INSERT values array
            const insertValues: unknown[] = [dateValue, type, amount, descriptionValue];

            const columns = ['date', 'type', 'amount', 'description'];

            // Step 7: INSERT
            // Requirement 7.1: Generate autogenerated id
            const insertResult = await client.query<{ id: number }>(
              tx,
              `INSERT INTO cash_entries (${columns.join(', ')}) VALUES (${columns
                .map((_, i) => `$${i + 1}`)
                .join(', ')}) RETURNING id`,
              insertValues,
            );

            const insertedId = insertResult[0]?.id;
            if (!insertedId) {
              throw new Error('INSERT did not return id');
            }

            // Step 8: Record in migration log
            const payloadHash = calculatePayloadHash(row);
            await logStore.record(tx, {
              sourceTable: 'caja',
              sourcePk,
              targetTable: 'cash_entries',
              targetId: insertedId,
              status: 'migrated',
              payloadHash,
              migratedAt: new Date(),
            });

            // Step 9: Update result
            result.migrated++;
          } catch (error) {
            result.errors.push({
              sourceId: row.idCaja,
              error: String(error),
            });
          }
        }
      });

      return result;
    },
  };
}
