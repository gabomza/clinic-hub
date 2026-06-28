# Fichas — Medical Institute App

Migration of a legacy PHP/MySQL medical practice management system to Next.js + Supabase (PostgreSQL).

## Stack

- **Database:** Supabase (PostgreSQL 15+)
- **App:** Next.js (App Router) — Server Components + Route Handlers, no separate backend service
- **ORM:** Prisma (planned, Next.js phase)

## Status

- [x] Database schema design ([schema.sql](schema.sql), [docs/sdd.md](docs/sdd.md))
- [ ] Data migration script from legacy MySQL dump
- [ ] Next.js application

## Documentation

All project documentation lives under [docs/](docs/), organized by responsibility:

- [docs/sdd.md](docs/sdd.md) — System Design Document: database architecture, schema mapping from the legacy system, role model, migration strategy
- `docs/specs/<feature>/` — Spec-Driven Development docs per feature (`requirements.md`, `design.md`, `tasks.md`), following the SDD workflow defined in `.claude/system-prompts/spec-workflow-starter.md`

As the Next.js app grows, individual packages/modules may include their own local `README.md` with module-specific details; `docs/` remains the source of truth for cross-cutting design decisions.

## Files

- `sample_dump.sql` — sample of the legacy MySQL dump (structure + a few rows per table), used to design the new schema
- `schema.sql` — new PostgreSQL schema, ready to run on Supabase
