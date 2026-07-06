# Implementation Plan

- [x] 1. Reorganize DB files
  - Move `schema.sql` and `sample_dump.sql` from project root to `db/`
  - Extract seed INSERT statements from `schema.sql` into `db/seed.sql`
  - Update `migration-script/src/orchestrator/__tests__/orchestrator.test.ts` — fix `SCHEMA_SQL_PATH` / `SAMPLE_DUMP_PATH` to point into `db/`, add `SEED_SQL_PATH`, update `setupTestDatabase()` to apply both `schema.sql` and `seed.sql`
  - Add `.env.local` and `.env*.local` to `.gitignore`
  - _Requirements: 1, 2, 3.4_

- [x] 2. Create `.env.example`
  - Add `.env.example` at the project root with all 5 variables, placeholder values, and inline comments pointing to the exact Supabase dashboard location for each value
  - _Requirements: 3.1, 3.2_

- [x] 3. Apply `db/schema.sql` to Supabase *(manual — developer)*
  - Open **SQL Editor** in the Supabase dashboard
  - Paste contents of `db/schema.sql` and click **Run**
  - Confirm no errors in the output panel
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 4. Apply `db/seed.sql` to Supabase *(manual — developer)*
  - Open a new SQL Editor tab
  - Paste contents of `db/seed.sql` and click **Run**
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 5. Verify schema and seed via SQL Editor *(manual — developer)*
  - Run the verification query from `design.md` Phase 1
  - Confirm: `doctors`=3, `health_insurances`=18, `visit_reasons`=9, `schedules`=69, all other tables=0
  - _Requirements: 1.1–1.4, 2.1–2.6_

- [ ] 6. Fill `.env.local` with real Supabase values *(manual — developer)*
  - Copy `.env.example` to `.env.local`
  - Populate all 5 variables from the Supabase dashboard (see `design.md` Phase 2 for exact paths)
  - Confirm `.env.local` does not appear in `git status` (gitignored)
  - _Requirements: 3.3, 3.4_
