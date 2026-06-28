# System Design Document – Medical Institute App
**Version:** 1.0.0  
**Date:** 2026-06-15  
**Status:** Draft – Database Design Phase  
**Scope:** Database redesign only. Next.js application design is a separate phase.

---

## 1. Overview

Migration of a PHP/MySQL application ("instituto") to a Next.js application backed by a PostgreSQL database hosted on Supabase. This document covers the database design decisions, schema mapping, role model, and migration strategy.

The original database (`instituto`) ran on MySQL 5.5 using the MyISAM engine, which does not enforce foreign key constraints. The new design enforces all relationships and corrects structural issues found in the source.

---

## 2. Technology Decisions

### 2.1 Database: Supabase (PostgreSQL 15+)

**Chosen over:** Firebase Firestore, PlanetScale, Vercel Postgres, Neon.

| Criterion | Reason |
|---|---|
| Relational model | Data is inherently relational; NoSQL (Firebase) would require significant restructuring with no benefit |
| PostgreSQL | Closest to MySQL; most migration-friendly. Superior to MySQL in: generated columns, CHECK constraints, proper ENUM handling, full-text search |
| No separate backend | Supabase client (`@supabase/supabase-js`) works in Next.js Server Components and Route Handlers — all DB access stays inside Next.js |
| Row Level Security (RLS) | Built-in policy system for role-based access (receptionist vs. doctor) without a separate auth service |
| Auth included | Supabase Auth eliminates the need for a third-party auth provider |
| Free tier | Sufficient for a small medical practice |

### 2.2 Application: Next.js (App Router)

- **Server Components** fetch read-only data directly (no API round-trip).
- **Route Handlers** handle mutations (POST/PUT/DELETE).
- **No separate backend service** (no Express, no Laravel API).

### 2.3 ORM: Prisma (planned for Next.js phase)

Provides typed schema, auto-generated migrations, and IDE autocompletion. Schema will be derived from `schema.sql` once the Next.js project is initialized.

---

## 3. Role Model

Two roles are defined. These map to Supabase RLS policies (to be implemented in the Next.js phase).

| Role | Access |
|---|---|
| **receptionist** | CRUD: `patients`, `appointments`, `doctors`, `schedules`, `health_insurances`, `visit_reasons`, `cash_entries`, `balance_snapshots` |
| **doctor** | CRUD: `clinical_records`, `surgeries`, `surgery_applied_techniques`, `surgery_diagnoses`, `body_parts`, `surgery_techniques`. Read-only: `patients`, `appointments`, `visit_reasons` |

Both roles are read-only on seed/reference data (doctors, health_insurances, visit_reasons) except through the receptionist role which can update them.

---

## 4. Schema Design

### 4.1 Design Principles

1. **All monetary amounts as `DECIMAL(10,2)`** — the source stored amounts as VARCHAR with comma as decimal separator (e.g., `1350,48`). These must be converted during migration.
2. **All FKs enforced** — MyISAM did not enforce FK constraints. Every reference is now an actual FK with proper referential integrity.
3. **Boolean flags instead of INT** — `Obrasoc_estado`, `Motivo_estado`, `Horarios_estado` were INT; now BOOLEAN.
4. **No free-text references** — patient names, doctor names, and insurance names stored as text in source tables are replaced with proper FK columns.
5. **Single responsibility per field** — `ingresosCaja`/`egresosCaja` (two fields for what is one value + direction) collapsed to `amount` + `type ENUM`.
6. **`updated_at` maintained by trigger** — avoids relying on application code to keep this accurate.
7. **Lookup tables for surgery fields** — `diagnostico`, `miembro`, `tecnica1/2/3` were free-text VARCHAR; extracted to lookup tables to enable select dropdowns in the UI and consistent reporting.

### 4.2 Entity Relationship Diagram

```
doctors
  │
  ├──< schedules
  │
  ├──< appointments >── patients ──< clinical_records
  │        │                │
  │        │                └──> health_insurances
  │        │
  │        ├──> visit_reasons
  │        ├──> schedules
  │        └──> health_insurances
  │
  ├──< clinical_records >── visit_reasons
  │
  └──< surgeries >── surgery_diagnoses
           │    └──> body_parts
           │
           └──< surgery_applied_techniques >── surgery_techniques

cash_entries (standalone)
balance_snapshots (standalone, computed from cash_entries)
```

### 4.3 Table Catalog

#### `doctors`
Was: `inst_doctor`

| New field | Old field | Notes |
|---|---|---|
| `id` | `Doctor_id` | |
| `name` | `Doctor_nombre` | |
| `specialty` | `Doctor_extra` | Renamed; was empty in source data |
| `is_active` | — | New |
| `created_at` / `updated_at` | — | New |

---

#### `health_insurances`
Was: `inst_obrasoc`

| New field | Old field | Notes |
|---|---|---|
| `id` | `Obrasoc_id` | |
| `name` | `Obrasoc_texto` | |
| `is_active` | `Obrasoc_estado` | INT → BOOLEAN |

Row 1 (`'---'`) was a UI placeholder separator; migrated with `is_active = FALSE`.

---

#### `visit_reasons`
Was: `inst_motivo`

| New field | Old field | Notes |
|---|---|---|
| `id` | `Motivo_id` | |
| `name` | `Motivo_texto` | |
| `default_fee` | — | **New** — reference fee per reason type |
| `is_active` | `Motivo_estado` | INT → BOOLEAN |

The `default_fee` is a reference value per reason. `clinical_records.visit_fee` overrides it when a different amount applies to a specific visit.

---

#### `schedules`
Was: `inst_horarios`

| New field | Old field | Notes |
|---|---|---|
| `id` | `Horarios_id` | |
| `doctor_id` | `Horarios_estado` | **Critical fix:** `Horarios_estado` was a 0-indexed doctor reference (0→1, 1→2, 2→3), not a status flag |
| `time_slot` | `Horarios_hora` | |
| `is_available` | — | **New** — boolean flag for availability |
| UNIQUE (doctor_id, time_slot) | — | New constraint |

**Migration mapping:** `doctor_id = Horarios_estado + 1`

Original IDs preserved in seed data so `inst_turnos.Turno_hora` references remain valid during the data migration phase.

---

#### `patients`
Was: `fichas`

| New field | Old field | Notes |
|---|---|---|
| `id` | `idFicha` | |
| `doc_type` | `tipoDoc` | |
| `doc_number` | `documento` | VARCHAR(12) → VARCHAR(20) |
| `last_name` | `apellido` | |
| `first_name` | `nombre` | |
| `address` | `domicilio` | |
| `district` | `departamento` | |
| `province` | `provincia` | |
| `birth_date` | `fechaNac` | |
| `gender` | `sexo` CHAR(1) | Expanded to `VARCHAR(15)` with CHECK: `male`, `female`, `other`, `unspecified` |
| `insurance_id` | `obraSocial` VARCHAR | Free text → FK to `health_insurances` |
| `insurance_number` | `nroObraSocial` | |
| `phone` | `telefono` | |
| `email` | `eMail` | VARCHAR(30) → VARCHAR(150) |
| `postal_code` | `codPostal` | VARCHAR(5) → VARCHAR(10) |
| `marital_status` | `estadoCivil` CHAR(1) | CHAR → VARCHAR(20) with CHECK enum |
| `doctor_id` | `profesional` VARCHAR | Free text "1" → FK to `doctors`. Source value '0' → NULL |
| `first_visit_date` | `primerConsulta` | |
| `last_visit_date` | `ultimaConsulta` | |
| `diagnosis` | `diagnostico` | |
| — | `fuente` | **Removed** |
| — | `lugarTrabajo` | **Removed** |
| — | `tipoTrabajo` | **Removed** |
| — | `trabajoConyuge` | **Removed** |
| — | `tipoTrabajoConyuge` | **Removed** |
| — | `valorConsulta` | **Moved** to `clinical_records.visit_fee` |

**Marital status values:** `single`, `married`, `divorced`, `widowed`, `separated`, `common_law`, `other`

---

#### `appointments`
Was: `inst_turnos`

| New field | Old field | Notes |
|---|---|---|
| `id` | `Turno_id` | |
| `patient_id` | `Turno_paciente` VARCHAR | Free text name → FK to `patients` |
| `reason_id` | `Turno_motivoid` | |
| `doctor_id` | `Turno_doctor` | |
| `date` | `Turno_fecha` | |
| `schedule_id` | `Turno_hora` INT | Was Horarios_id reference → proper FK to `schedules` |
| `insurance_id` | `Turno_obrasocialid` | |
| `status` | `Turno_estado` INT | INT → VARCHAR CHECK: `pending`, `confirmed`, `completed`, `cancelled` |
| `notes` | `Turno_detalle` | |
| — | `Turno_telefono` | **Removed** — use `patients.phone` |

---

#### `clinical_records`
Was: `historiaclinica`

| New field | Old field | Notes |
|---|---|---|
| `id` | — | **New** SERIAL PK — source had compound PK (idHistoriaClinica + fechaConsulta) |
| `patient_id` | `idHistoriaClinica` | Was badly named; it was a FK to `fichas.idFicha` |
| `doctor_id` | — | **New** FK |
| `reason_id` | — | **New** FK |
| `appointment_id` | — | **New** optional FK — links to appointment that originated this record |
| `visit_date` | `fechaConsulta` | |
| `notes` | `datos` | TEXT; source contained HTML `<br>` tags that should be stripped on migration |
| `visit_fee` | `fichas.valorConsulta` | **Moved** from patients table |

**Note on source data:** `datos` field contains embedded `<br>` HTML tags from old PHP rendering. Strip on migration.

---

#### `surgeries`
Was: `cirugias`

| New field | Old field | Notes |
|---|---|---|
| `id` | `id_cirugia` | Source had no AUTO_INCREMENT — replaced with SERIAL |
| `patient_id` | `apellido`+`nombre`+`domicilio` | Patient data was inline text; match to `patients` via migration script |
| `doctor_id` | — | **New** — not tracked in source |
| `date` | `fecha` | |
| `diagnosis_id` | `diagnostico` VARCHAR | Free text → FK to `surgery_diagnoses` |
| `body_part_id` | `miembro` VARCHAR | Free text → FK to `body_parts` |
| `outcome` | `evolucion` | |

#### `surgery_applied_techniques` (junction)
Replaces: `tecnica1`, `tecnica2`, `tecnica3`

| Field | Notes |
|---|---|
| `surgery_id` | FK to `surgeries` with CASCADE DELETE |
| `technique_id` | FK to `surgery_techniques` |
| `order_index` | 1, 2, or 3 (preserves original ordering); allows up to 10 |

---

#### `cash_entries`
Was: `caja`

| New field | Old field | Notes |
|---|---|---|
| `id` | `idCaja` | |
| `date` | `fechaCaja` | |
| `description` | `conceptoCaja` | VARCHAR(100) → VARCHAR(200) |
| `amount` | `ingresosCaja` / `egresosCaja` | Two VARCHAR fields → single DECIMAL(10,2) |
| `type` | — | **New** ENUM: `income` or `expense` |

**Migration rule:** if `ingresosCaja != '0,00'` → `type = 'income'`, `amount = ingresosCaja`. If `egresosCaja != '0,00'` → `type = 'expense'`, `amount = egresosCaja`. Replace `,` with `.` in amounts before casting to DECIMAL.

---

#### `balance_snapshots` (new)

| Field | Type | Notes |
|---|---|---|
| `id` | SERIAL PK | |
| `period_start` | DATE | Start of the accounting period |
| `period_end` | DATE | End of the accounting period |
| `opening_balance` | DECIMAL(10,2) | Balance at start of period (from prior period's closing or manual entry) |
| `total_income` | DECIMAL(10,2) | Sum of income cash_entries in period |
| `total_expenses` | DECIMAL(10,2) | Sum of expense cash_entries in period |
| `closing_balance` | DECIMAL(10,2) GENERATED | `opening_balance + total_income - total_expenses` (auto-computed, stored) |
| `status` | VARCHAR(10) | `open` (editable) or `closed` (finalized) |
| `notes` | TEXT | Optional period notes |

**Usage pattern:**

```sql
-- Current balance
WITH last_closed AS (
    SELECT closing_balance, period_end
    FROM balance_snapshots
    WHERE status = 'closed'
    ORDER BY period_end DESC
    LIMIT 1
)
SELECT
    lc.closing_balance
    + COALESCE(SUM(CASE WHEN ce.type = 'income'  THEN ce.amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN ce.type = 'expense' THEN ce.amount ELSE 0 END), 0)
    AS current_balance
FROM last_closed lc
LEFT JOIN cash_entries ce ON ce.date > lc.period_end;
```

The balance table connects to `cash_entries` conceptually (not via FK) since each snapshot summarizes a date range of entries.

---

## 5. Migration Strategy

A migration script will be developed separately once a full production dump is provided. Key challenges and approach:

### 5.1 Amounts in `caja`
- Source: VARCHAR with comma decimal (`1350,48`)
- Fix: `REPLACE(amount_field, ',', '.')::DECIMAL(10,2)`

### 5.2 Patient references in `cirugias` and `inst_turnos`
Both tables store patient data as free text, not FK references.

**`inst_turnos.Turno_paciente`** — stores last name only (e.g., `'Amadei'`).  
**`cirugias`** — stores `apellido` + `nombre` + `domicilio` inline.

Migration approach:
1. Fuzzy match `cirugias.apellido` + `cirugias.nombre` against `patients.last_name` + `patients.first_name`.
2. The script will output a **review file** listing:
   - Records with a single confident match (auto-linked)
   - Records with multiple candidates (flagged for manual review)
   - Records with no match (inserted with `patient_id = NULL` and a migration note)
3. A secondary pass links `appointments.patient_id` the same way.

### 5.3 Doctor reference in `fichas`
`fichas.profesional` is stored as a numeric string (`'1'`, `'0'`). 
- `'0'` → `NULL`
- `'1'`, `'2'`, `'3'` → direct FK value

### 5.4 Schedule mapping in `inst_turnos`
`Turno_hora` stores the raw `Horarios_id`. Since seed data preserves original IDs, this is a direct copy.

### 5.5 `historiaclinica` compound PK
Source PK is `(idHistoriaClinica, fechaConsulta)`. Multiple rows share the same `idHistoriaClinica` (patient ref) with different dates. Each row becomes a separate `clinical_records` row with a new auto-generated `id`.

### 5.6 HTML in `historiaclinica.datos`
Strip `<br>` tags during migration: `REPLACE(datos, '<br>', '\n')`.

### 5.7 Lookup table population for `cirugias`
Before migrating surgery rows, populate lookup tables from distinct source values:
```sql
-- Run against the source MySQL dump
SELECT DISTINCT diagnostico FROM cirugias WHERE diagnostico != '';
SELECT DISTINCT miembro     FROM cirugias WHERE miembro != '';
SELECT DISTINCT tecnica1    FROM cirugias WHERE tecnica1 != '';
SELECT DISTINCT tecnica2    FROM cirugias WHERE tecnica2 != '';
SELECT DISTINCT tecnica3    FROM cirugias WHERE tecnica3 != '';
```
Each distinct value becomes a row in the corresponding lookup table.

---

## 6. Indexes – Rationale

| Index | Reason |
|---|---|
| `patients(last_name)` | Primary search field in the UI |
| `patients(doc_number)` | Lookup by ID document |
| `appointments(doctor_id, date)` | Daily agenda view per doctor |
| `appointments(status)` | Filtering pending/confirmed |
| `clinical_records(patient_id)` | Full history view for a patient |
| `cash_entries(type, date)` | Period income/expense aggregations |
| `schedules(doctor_id, is_available)` | Available slots lookup for booking |

---

## 7. Open Items

| # | Item | Owner |
|---|---|---|
| 1 | `doctors.specialty` — fill in actual specialties for each doctor | Admin |
| 2 | `visit_reasons.default_fee` — define reference fee per reason type | Admin |
| 3 | Confirm initial `balance_snapshots` opening balance from historical `caja` data | Admin |
| 4 | Define `inst_horarios` slots as available (`is_available = TRUE/FALSE`) — currently all seeded as TRUE | Admin |
| 5 | Manual review of unmatched patient records post-migration (surgery + appointment patient refs) | Admin |
| 6 | RLS policy definitions for `receptionist` and `doctor` roles | Dev (Next.js phase) |
| 7 | Prisma schema derivation from this SQL | Dev (Next.js phase) |
| 8 | Migration script implementation against full production dump | Dev |

---

## 8. Ignored Tables

| Table | Reason |
|---|---|
| `inst_alt` | Internal notes/log with no clear model fit; excluded per requirement |
| `medias` | Product catalog (compression stockings); out of scope |
| `ventamedias` | Sales records for `medias`; out of scope |

---

## 9. Documentation Conventions

This document covers cross-cutting database architecture and design decisions. Going forward:

- **Per-feature specs** live under `docs/specs/<feature-name>/`, each containing `requirements.md`, `design.md`, and `tasks.md`, following the Spec-Driven Development workflow defined in `.claude/system-prompts/spec-workflow-starter.md`. Each phase requires explicit user approval before moving to the next.
- **This document (`docs/sdd.md`)** stays as the single source of truth for the database architecture and the legacy-to-new schema mapping; feature specs reference it rather than duplicating its content.
- **Module-level docs** (once the Next.js app exists) live as local `README.md` files inside each package/module, scoped to that module's specifics.
