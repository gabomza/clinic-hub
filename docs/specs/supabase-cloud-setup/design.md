# Design Document

## Overview

This document describes how to apply `db/schema.sql` + `db/seed.sql` to the Supabase cloud project and configure the environment variables. All steps are either manual dashboard operations or short CLI commands — no new application code is introduced.

---

## Phase 1: Apply Schema and Seed Data

### Option A — Supabase SQL Editor (recommended, no local tooling required)

1. Open the Supabase dashboard → select the project → **SQL Editor**.
2. Paste the full contents of `db/schema.sql` into a new query tab and click **Run**.
3. Verify success: no red error output. A warning about `CREATE OR REPLACE FUNCTION` on a fresh DB is acceptable.
4. Open a second query tab, paste the full contents of `db/seed.sql`, and click **Run**.
5. Verify in **Table Editor** that `doctors` has 3 rows, `health_insurances` has 18, `visit_reasons` has 9, and `schedules` has 69.

### Option B — `psql` CLI (when SQL Editor is inconvenient or times out)

Requires `psql` installed locally. The connection string is the **Direct** connection string from **Settings → Database → Connection string → Direct connection**.

```bash
# Apply schema (DDL + triggers + indexes)
psql "$DIRECT_URL" -f db/schema.sql

# Apply seed data (reference rows)
psql "$DIRECT_URL" -f db/seed.sql
```

**When to prefer Option B:** the Supabase SQL Editor has a ~30-second timeout for queries. `db/schema.sql` and `db/seed.sql` are both small (well under 1 second of execution time) so the Editor is fine. Use Option B if the project later introduces a large migration file.

### Verification query

Run this in the SQL Editor after both files are applied to confirm all tables exist and counts are correct:

```sql
SELECT
    t.table_name,
    (xpath('/row/c/text()',
        query_to_xml(format('SELECT count(*) AS c FROM %I', t.table_name), false, true, ''))
    )[1]::text::int AS row_count
FROM information_schema.tables t
WHERE t.table_schema = 'public'
  AND t.table_type   = 'BASE TABLE'
ORDER BY t.table_name;
```

Expected: `doctors`=3, `health_insurances`=18, `visit_reasons`=9, `schedules`=69, all others=0.

---

## Phase 2: Environment Variable Configuration

### Where to find each value in the Supabase dashboard

| Variable | Dashboard path |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Settings → API → Project URL** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Settings → API → Project API keys → anon public** |
| `SUPABASE_SERVICE_ROLE_KEY` | **Settings → API → Project API keys → service_role** |
| `DATABASE_URL` | **Settings → Database → Connection string → Transaction mode** (add `?pgbouncer=true` if not already appended; Supabase typically includes it) |
| `DIRECT_URL` | **Settings → Database → Connection string → Direct connection** |

### Why two Postgres URLs

Supabase exposes two connection endpoints:

- **Transaction Pooler (`DATABASE_URL`):** Routes through PgBouncer in transaction mode. Every query gets a pooled connection from a shared pool, which is ideal for serverless/Next.js environments where many short-lived connections would otherwise exhaust Postgres's connection limit. The migration script and the future Prisma client use this.
- **Direct connection (`DIRECT_URL`):** Bypasses PgBouncer and opens a real Postgres session. Required for Prisma Migrate (`prisma migrate deploy`) because migrations run DDL statements that must execute within a single session and cannot be split across pooled transactions.

### `.env.example` file (committed, placeholder values)

```dotenv
# Supabase project URL – safe to expose to the browser
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co

# Public anonymous key – safe to expose to the browser
# Found in: Supabase Dashboard → Settings → API → Project API keys → anon public
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>

# Service role key – server-side only, never reference in client code
# Found in: Supabase Dashboard → Settings → API → Project API keys → service_role
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# Postgres connection via Transaction Pooler (PgBouncer)
# Used by: migration script, Prisma client (runtime queries)
# Found in: Supabase Dashboard → Settings → Database → Connection string → Transaction mode
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true

# Direct Postgres connection (bypasses PgBouncer)
# Used by: Prisma CLI migrations only (prisma migrate deploy)
# Found in: Supabase Dashboard → Settings → Database → Connection string → Direct connection
DIRECT_URL=postgresql://postgres.<project-ref>:<password>@db.<project-ref>.supabase.co:5432/postgres
```

### `.env.local` (gitignored, real values)

The developer copies `.env.example` to `.env.local` and replaces all placeholders with real values from the Supabase dashboard. `.env.local` is excluded from git via `.gitignore` (`.env.local` and `.env*.local` entries are already added).

### Migration script connection

The migration script reads `DATABASE_URL` from `process.env` via `dotenv`. When running the script locally, place `.env.local` at the project root (already the standard location) and the script will pick it up automatically. No additional config file is needed.

---

## Security notes

- `SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level Security. It must never be used in client-side code or exposed via a `NEXT_PUBLIC_*` variable.
- `DATABASE_URL` and `DIRECT_URL` contain the database password. They are gitignored via `.env.local` and must not be hardcoded anywhere in the source.
- The future Next.js spec will configure Supabase RLS policies for the `receptionist` and `doctor` roles. Until then, the `public` schema has no RLS — access is controlled only by the connection credentials.
