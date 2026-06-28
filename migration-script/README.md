# Data Migration Script

Database migration script from MySQL to PostgreSQL (Supabase) for the Medical Institute system.

## Project Structure

```
migration-script/
├── src/
│   ├── config/              # Configuration loading and validation
│   │   └── __tests__/
│   ├── parser/              # MySQL dump parsing
│   │   └── __tests__/
│   ├── db/                  # PostgreSQL database operations
│   │   └── __tests__/
│   ├── matcher/             # Field matching and validation
│   │   └── __tests__/
│   ├── migrators/           # Data migration logic
│   │   └── __tests__/
│   ├── report/              # Migration reporting
│   │   └── __tests__/
│   ├── orchestrator/        # Migration orchestration
│   │   └── __tests__/
│   └── migrate.ts           # Main entry point
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .gitignore
├── .env.example
└── README.md
```

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file from `.env.example`:
   ```bash
   cp .env.example .env
   ```

3. Configure your PostgreSQL connection string and MySQL dump path in `.env`

## Scripts

- `npm run build` - Compile TypeScript to JavaScript
- `npm run dev` - Run migration script with ts-node (development)
- `npm run migrate` - Run compiled migration script
- `npm test` - Run tests with Vitest
- `npm run test:ui` - Run tests with Vitest UI
- `npm run test:coverage` - Generate coverage report
- `npm run clean` - Remove dist directory

## Module Descriptions

### Config (`src/config/`)
**Responsible for:** Loading and validating configuration from CLI flags, environment variables, and defaults.
- Exports: `MigrationConfig` type, `loadConfig(argv, env)` function
- Behavior: Fail-fast validation (missing `DATABASE_URL` or invalid thresholds cause immediate error)
- Used by: `migrate.ts` (CLI entry point) and all modules that need configuration

### Parser (`src/parser/`)
**Responsible for:** Stream-based parsing of MySQL dump files without loading entire file into memory.
- Exports: `parseMysqlDump(filePath)`, `ParsedTable` type, `DumpParseResult` type
- Features: Multi-row INSERT support, escape sequence handling, CREATE TABLE structure extraction
- Handles: Large files efficiently via readline streaming; validates table names against scope
- Used by: `MigrationOrchestrator` (Tarea 15 step 2)

### Database (`src/db/`)
**Responsible for:** PostgreSQL connection management and low-level database operations.
- Exports: `PostgresClient` (connection pool wrapper), `MigrationLogStore` (idempotency control)
- Features:
  - `PostgresClient.insertBatch()` — parametrized multi-VALUES inserts with configurable batch size
  - `PostgresClient.withTransaction()` — handles rollback and error recovery
  - `MigrationLogStore` — tracks migrated rows by (source_table, source_pk, payload_hash)
- Used by: All migrators for data insertion and idempotency checks

### Matcher (`src/matcher/`)
**Responsible for:** Fuzzy matching of patient names using Jaro-Winkler algorithm with normalized text.
- Exports: `PatientMatcher`, `PatientCandidate` type, `MatchOutcome` type
- Features:
  - Two matching modes: `full_name` (0.6×last_name + 0.4×first_name) and `last_name_only` (single-field)
  - Configurable thresholds: `confidenceThreshold` (auto-link), `minConsiderationThreshold` (candidate pool)
  - Three outcomes: `auto_linked` (high confidence), `manual_review` (ambiguous), `no_match` (no candidates)
  - Duplicate detection: identifies possible duplicate patients in destination via self-comparison
- Used by: `SurgeryMigrator`, `AppointmentMigrator`, `ClinicalRecordMigrator` (patient linking)

### Migrators (`src/migrators/`)
**Responsible for:** Table-specific data transformation and migration logic.

- **`ReferenceDataMigrator`** — Doctors, health insurances, visit reasons, schedules
  - Detects duplicate entries (case-insensitive normalization)
  - Preserves legacy IDs and adjusts PostgreSQL sequences
  
- **`PatientMigrator`** — Main patient entity migration (fichas → patients)
  - Resolves doctor references; handles sentinel dates (0000-00-00 → NULL)
  - Retains consultation fees in memory for later use by clinical records
  
- **`SurgeryMigrator`** — Surgeries with techniques (cirugias → surgeries + surgery_applied_techniques)
  - `populateLookups()` — Extracts and normalizes diagnoses, body parts, techniques
  - `migrate()` — Links surgeries to patients via fuzzy matching; applies multiple techniques per surgery
  
- **`AppointmentMigrator`** — Appointments (inst_turnos → appointments)
  - Validates schedule existence; maps status codes to enums
  - Resolves patient via last-name-only fuzzy matching
  
- **`ClinicalRecordMigrator`** — Clinical notes (historiaclinica → clinical_records)
  - Normalizes HTML formatting (converts `<br>` variants to newlines)
  - Retrieves consultation fees from patient migration state
  
- **`CashEntryMigrator`** — Cash journal entries (caja → cash_entries)
  - Converts VARCHAR comma-decimal to DECIMAL (e.g., "1500,50" → 1500.50)
  - Classifies entries as income or expense; excludes ambiguous/invalid entries

### Report (`src/report/`)
**Responsible for:** Consolidating migration events and generating dual-format reports.
- Exports: `ReportBuilder`, `MigrationReport` type
- Features:
  - JSON report — Machine-readable audit trail with all tables, errors, warnings, matches
  - Markdown report — Human-readable summary with statistics tables and error details
  - Timestamped filenames — `migration-report-YYYYMMDD-HHMMSS.{json,md}` prevents overwrites
  - Duplicate detection — Lists possible duplicate patients found during matching
- Used by: `MigrationOrchestrator` (Tarea 15 step 15–16)

### Orchestrator (`src/orchestrator/`)
**Responsible for:** Coordinating the complete migration pipeline and managing cross-module dependencies.
- Exports: `MigrationOrchestrator`, `createMigrationOrchestrator()` factory
- Features:
  - Executes all 16 migration steps in correct dependency order
  - Propagates context between migradores (lookup ID maps, patient pool, fee registry)
  - Implements error recovery: transactional rollback with fila-por-fila retry on constraint violations
  - Registers excluded tables (inst_alt, medias, ventamedias) as intentional in reports
- Used by: `migrate.ts` (CLI entry point)

## Environment Variables

Configure the migration behavior through environment variables. All variables can be set via `.env` file or passed as CLI flags.

### Required

- **`DATABASE_URL`** — PostgreSQL connection string (Supabase format)
  - Example: `postgresql://user:password@host:5432/database`
  - CLI flag: `--database-url` or `--db-url`
  - Must be set before running migration

- **`DUMP_FILE_PATH`** — Absolute path to MySQL dump file
  - Example: `/path/to/sample_dump.sql`
  - CLI flag: `--dump-file` or `--dump-path`
  - File must exist and be readable

### Optional

- **`MATCH_CONFIDENCE_THRESHOLD`** (default: `0.92`)
  - Minimum Jaro-Winkler score (0.0–1.0) to automatically link patients
  - Scores below this trigger manual review or no-match classification
  - CLI flag: `--match-threshold`
  - Lower values = more aggressive linking (more false positives); higher = more conservative (more manual reviews)

- **`MATCH_MIN_CONSIDERATION_THRESHOLD`** (default: `0.75`)
  - Minimum score for a candidate to be considered during patient matching
  - Candidates below this are excluded from results entirely
  - CLI flag: `--match-min-threshold`
  - Must be less than `MATCH_CONFIDENCE_THRESHOLD`

- **`RESET_MODE`** (default: `log-only`)
  - Controls behavior when re-running migration:
    - `log-only`: Keep all migrated data; reuse rows from `migration_log` (idempotent, safe for re-runs)
    - `full`: Drop all data and `migration_log`; start completely fresh (destructive, use with caution)
  - CLI flag: `--reset [log-only|full]`
  - Use `full` only if you need to re-process the entire dump from scratch

- **`REPORT_OUTPUT_DIR`** (default: `./reports`)
  - Directory where JSON and Markdown migration reports are written
  - Directory is created if it doesn't exist
  - Reports use timestamp-based names: `migration-report-YYYYMMDD-HHMMSS.{json,md}`
  - CLI flag: `--report-dir`

- **`INSERT_BATCH_SIZE`** (default: `500`)
  - Number of rows to insert per database batch operation
  - Larger batches = faster but higher memory; smaller = slower but safer for very large datasets
  - CLI flag: `--batch-size`
  - Recommended: 500–1000 for typical datasets

### Configuration Precedence

CLI flags > Environment variables > `.env` file > Built-in defaults

Example `.env.example`:
```bash
DATABASE_URL=postgresql://user:password@localhost:5432/fichas
DUMP_FILE_PATH=/path/to/production_dump.sql
MATCH_CONFIDENCE_THRESHOLD=0.92
MATCH_MIN_CONSIDERATION_THRESHOLD=0.75
RESET_MODE=log-only
REPORT_OUTPUT_DIR=./reports
INSERT_BATCH_SIZE=500
```

## Testing

Run tests with:
```bash
npm test
```

Run specific test file:
```bash
npm test -- src/parser/__tests__/parser.test.ts
```

## CLI Usage

### Basic Migration

```bash
npm run dev -- \
  --dump-file /path/to/sample_dump.sql \
  --database-url postgresql://user:pass@host:5432/db
```

### With Custom Configuration

```bash
npm run dev -- \
  --dump-file /path/to/production_dump.sql \
  --database-url postgresql://user:pass@host:5432/db \
  --match-threshold 0.90 \
  --reset log-only \
  --report-dir ./migration-reports \
  --batch-size 1000
```

### Using Environment Variables

```bash
export DATABASE_URL=postgresql://user:pass@host:5432/db
export DUMP_FILE_PATH=/path/to/dump.sql
npm run dev
```

### Reset Modes

**Safe Re-run (log-only):**
```bash
# First run
npm run dev -- --dump-file dump.sql

# Second run — reuses existing rows, no duplicates
npm run dev -- --dump-file dump.sql
```

**Full Reset (destructive):**
```bash
# Clear all migrated data and restart from scratch
npm run dev -- --dump-file dump.sql --reset full
```

## Migration Reports

After each run, two reports are generated in `REPORT_OUTPUT_DIR`:

### JSON Report (`migration-report-<timestamp>.json`)
Machine-readable audit trail containing:
- `summaryByTable` — Row counts per table (migrated, reused, excluded, errors)
- `excludedTables` — Tables explicitly out of scope (inst_alt, medias, ventamedias)
- `patientMatching` — Fuzzy matching results (auto-linked, manual-review, no-match counts)
- `possibleDuplicatesInTarget` — Potential duplicate patients detected in destination
- `errors` — All errors encountered (row-level, constraint violations)
- `warnings` — Non-fatal issues (missing references, unmapped values)
- `startedAt`, `completedAt`, `duration` — Execution timeline

### Markdown Report (`migration-report-<timestamp>.md`)
Human-readable summary with:
- Table-by-table statistics with formatted tables
- Patient matching breakdown with example names
- List of possible duplicates for manual review
- Detailed error and warning sections for investigation

## Idempotency & Recovery

### How Idempotency Works

The `migration_log` control table tracks every successfully migrated row:

```sql
CREATE TABLE migration_log (
  id SERIAL PRIMARY KEY,
  source_table VARCHAR(255),
  source_pk VARCHAR(255),
  target_table VARCHAR(255),
  target_id INT,
  status VARCHAR(50),
  payload_hash VARCHAR(64),  -- SHA256 of source row
  migrated_at TIMESTAMP
);
```

When re-running a migration:
1. For each source row, compute SHA256 hash of its content
2. Query `migration_log` for matching (source_table, source_pk)
3. If found and payload_hash matches → **reuse** (no reinsertion)
4. If found but payload_hash differs → **error** (source data changed)
5. If not found → **insert** as new row

This guarantees:
- **No duplicates** on re-runs (same dump, same result)
- **Deterministic** (same input always produces same output)
- **Safe** (if network fails midway, resuming continues from where it left off)

### Recovery Scenarios

**Scenario 1: Partial failure (some rows inserted, then network drops)**
- Run migration again with same `--reset log-only` (default)
- Script continues from where it left off
- Only new rows are inserted; previously-successful rows are reused

**Scenario 2: Source data corrected (need to reimport with updated values)**
- Update the dump file with corrected data
- Run with `--reset full` to clear everything and start fresh
- ⚠️ WARNING: This deletes all migrated data; use with caution in production

**Scenario 3: Schema changes in destination**
- Clear the control table: `DELETE FROM migration_log;`
- Run migration again
- Script will attempt to re-insert all rows (may fail on new constraints)

## Error Handling

The migration implements fail-soft error recovery:

- **Configuration errors** (missing `DATABASE_URL`, invalid thresholds) — **Fail-fast** (abort before touching database)
- **Parse errors** (malformed SQL in dump) — **Fail-soft** (register error, continue with other tables)
- **Constraint violations** (FK to non-existent doctor) — **Fail-soft** (exclude row, register warning, continue)
- **Transactional errors** (entire batch fails) — **Retry fila-por-fila** (reinsertion of individual rows in degraded mode)

Each error is logged with context:
- Row number in source
- Source table + primary key
- Specific constraint violated
- Recommended corrective action

## Migration Workflow

The migration executes in a single orchestrated pipeline with 16 sequential steps:

1. **Load & validate configuration** — CLI flags/env vars/defaults; fail-fast on missing required variables
2. **Parse MySQL dump** — Stream-based parser handles large files without loading into memory
3. **Connect to PostgreSQL** — Establish pool connection to target database
4. **Initialize control table** — Create `migration_log` if missing (used for idempotency)
5. **Apply reset mode** — If `RESET_MODE=full`, clear all data and `migration_log`; if `log-only`, skip
6. **Migrate reference data** — Doctors, health insurances, visit reasons, schedules (with duplicate detection)
7. **Migrate patients** — Main entity; preserves legacy IDs, resolves doctor references
8. **Build surgery lookups** — Extract and normalize diagnoses, body parts, techniques
9. **Build patient pool** — Load all destination patients into memory for fuzzy matching
10. **Migrate appointments** — Link to patients via last-name matching; validate schedules
11. **Migrate surgeries** — Resolve lookups and patient references; apply multiple techniques per surgery
12. **Migrate clinical records** — Link to patients; normalize HTML formatting in notes
13. **Migrate cash entries** — Convert income/expense fields; classify by type (income/expense)
14. **Detect duplicates** — Search for possible duplicate patients in destination using fuzzy matching
15. **Build migration report** — Consolidate audit events; generate JSON and Markdown outputs
16. **Write reports to disk** — Save timestamped reports to `REPORT_OUTPUT_DIR`

All steps participate in idempotency through `migration_log`. If a row was already migrated (same `source_table` + `source_pk`), it is reused without reinsertion.

## Development

TypeScript strict mode is enabled for type safety. Path aliases are configured for clean imports.

```typescript
// Use path aliases
import { loadConfig } from '@config/index';
import { parseMysqlDump } from '@parser/index';
```

