# Requirements Document

## Introduction

This spec covers provisioning the cloud Supabase database and configuring environment variables so the project can connect to it. It is a prerequisite for the Next.js application spec and for running the data migration script against production data.

The database structure comes from `db/schema.sql` (DDL) and `db/seed.sql` (reference data only: doctors, health insurances, visit reasons, schedules). No patient, clinical, financial, or surgical data is loaded here — that is handled by `docs/specs/data-migration-script` once a production dump is available.

**Supabase org and project are assumed already created** (free tier, PostgreSQL 15+, region `sa-east-1` São Paulo).

Out of scope: Next.js application setup, Prisma schema, RLS policies, data migration.

---

## Requirements

### Requirement 1: Schema Applied to Supabase

**User Story:** As a developer, I want the full database structure from `db/schema.sql` applied to the Supabase cloud instance, so that all tables, indexes, triggers, and constraints exist before any application code connects.

#### Acceptance Criteria

1. WHEN `db/schema.sql` is executed against the Supabase database THEN the following tables SHALL exist in the `public` schema: `doctors`, `health_insurances`, `visit_reasons`, `surgery_diagnoses`, `body_parts`, `surgery_techniques`, `schedules`, `patients`, `appointments`, `clinical_records`, `surgeries`, `surgery_applied_techniques`, `cash_entries`, `balance_snapshots`.
2. WHEN the schema is applied THEN all indexes defined in `db/schema.sql` Section 8 SHALL be present.
3. WHEN the schema is applied THEN the `set_updated_at` function and the four `updated_at` triggers (on `doctors`, `patients`, `appointments`, `balance_snapshots`) SHALL be present.
4. WHEN the schema is applied THEN all tables SHALL be empty (no rows).
5. The schema SHALL be applied to a **fresh** Supabase project with no prior objects. Schema evolution (future changes) will be managed by Prisma migrations in the Next.js spec.

### Requirement 2: Reference Data Seeded

**User Story:** As a developer, I want the reference/lookup rows from `db/seed.sql` loaded after the schema, so that the migration script and future application have valid FK targets for doctors, health insurances, visit reasons, and schedule slots.

#### Acceptance Criteria

1. WHEN `db/seed.sql` is executed after `db/schema.sql` THEN `doctors` SHALL contain 3 rows (Dr. Angel Guzman, Dr. Alberto Silva, Dra. Pelaez) with `is_active = TRUE`.
2. WHEN `db/seed.sql` is executed THEN `health_insurances` SHALL contain 18 rows, with row id=1 (`'---'`) as `is_active = FALSE` and the rest `TRUE`.
3. WHEN `db/seed.sql` is executed THEN `visit_reasons` SHALL contain 9 rows all with `is_active = TRUE` and `default_fee = NULL`.
4. WHEN `db/seed.sql` is executed THEN `schedules` SHALL contain 69 rows with their original IDs preserved (required for the migration script to resolve `Turno_hora` references without re-mapping).
5. WHEN `db/seed.sql` is executed THEN the sequences for each seeded table (`doctors_id_seq`, `health_insurances_id_seq`, `visit_reasons_id_seq`, `schedules_id_seq`) SHALL be reset to the maximum seeded id to prevent future auto-increment collisions.
6. The following tables SHALL remain empty after seeding: `surgery_diagnoses`, `body_parts`, `surgery_techniques`, `patients`, `appointments`, `clinical_records`, `surgeries`, `surgery_applied_techniques`, `cash_entries`, `balance_snapshots`.

### Requirement 3: Environment Variables Configured

**User Story:** As a developer, I want the required Supabase connection variables defined in the project, so that both the migration script and the future Next.js application can connect to the correct database without hardcoded credentials.

#### Acceptance Criteria

1. A `.env.example` file SHALL be committed at the project root containing all required variable names with placeholder values and inline comments pointing to the exact location in the Supabase dashboard where each value is found.
2. The following variables SHALL be defined in `.env.example`:

   | Variable | Purpose |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL; safe to expose to the browser |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key; safe to expose to the browser |
   | `SUPABASE_SERVICE_ROLE_KEY` | Service role key; server-side only, never in client code |
   | `DATABASE_URL` | Postgres connection string via Transaction Pooler; used by the migration script and future Prisma client |
   | `DIRECT_URL` | Direct Postgres connection string; used by Prisma CLI for schema migrations |

3. A `.env.local` file SHALL be created by the developer at the project root (not committed) containing real values obtained from the Supabase dashboard.
4. `.env.local` and `.env*.local` SHALL be listed in `.gitignore`.
5. The migration script (`migration-script/`) SHALL resolve `DATABASE_URL` from the environment, consistent with the variable defined here (no separate config needed for the script).
6. `SUPABASE_SERVICE_ROLE_KEY` SHALL NOT appear in any `NEXT_PUBLIC_*` variable or be referenced in client-side code.
