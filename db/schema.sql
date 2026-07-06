-- ============================================================
-- Medical Institute – New Database Schema
-- Source:  instituto (MySQL 5.5, MyISAM)
-- Target:  Supabase (PostgreSQL 15+)
-- Version: 1.0.0
-- Date:    2026-06-15
-- ============================================================
-- Run order: fresh database, no prior objects expected.
-- Seed data (doctors, health_insurances, visit_reasons, schedules)
-- is in seed.sql – apply after this file.
-- To reset: run the DROP section at the bottom in reverse order.
-- ============================================================


-- ============================================================
-- UTILITY FUNCTION – updated_at auto-maintenance
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- SECTION 1: REFERENCE / LOOKUP TABLES
-- No foreign key dependencies – create first.
-- ============================================================

-- doctors (was: inst_doctor)
-- Migration note: Doctor_extra → specialty (empty in source data; to be filled manually)
CREATE TABLE doctors (
    id          SERIAL          PRIMARY KEY,
    name        VARCHAR(100)    NOT NULL,
    specialty   VARCHAR(100),
    is_active   BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- health_insurances (was: inst_obrasoc)
CREATE TABLE health_insurances (
    id          SERIAL          PRIMARY KEY,
    name        VARCHAR(100)    NOT NULL,
    is_active   BOOLEAN         NOT NULL DEFAULT TRUE
);

-- visit_reasons (was: inst_motivo)
-- default_fee: reference fee per reason type; clinical_records.visit_fee can override it
CREATE TABLE visit_reasons (
    id          SERIAL          PRIMARY KEY,
    name        VARCHAR(100)    NOT NULL,
    default_fee DECIMAL(10,2),
    is_active   BOOLEAN         NOT NULL DEFAULT TRUE
);

-- surgery_diagnoses (lookup for surgeries.diagnosis_id)
-- Populated from distinct values of cirugias.diagnostico
CREATE TABLE surgery_diagnoses (
    id          SERIAL          PRIMARY KEY,
    name        VARCHAR(255)    NOT NULL,
    is_active   BOOLEAN         NOT NULL DEFAULT TRUE
);

-- body_parts (lookup for surgeries.body_part_id)
-- Populated from distinct values of cirugias.miembro
CREATE TABLE body_parts (
    id          SERIAL          PRIMARY KEY,
    name        VARCHAR(100)    NOT NULL,
    is_active   BOOLEAN         NOT NULL DEFAULT TRUE
);

-- surgery_techniques (lookup for surgery_applied_techniques)
-- Populated from distinct values of cirugias.tecnica1/2/3
CREATE TABLE surgery_techniques (
    id          SERIAL          PRIMARY KEY,
    name        VARCHAR(100)    NOT NULL,
    is_active   BOOLEAN         NOT NULL DEFAULT TRUE
);


-- ============================================================
-- SECTION 2: SCHEDULES (was: inst_horarios)
-- ============================================================
-- Each row = one repeating time slot for a specific doctor.
-- Migration note: Horarios_estado (0,1,2) maps to doctor_id (1,2,3).
-- The original field was misnamed "estado" but it was a 0-indexed doctor ref.

CREATE TABLE schedules (
    id           SERIAL          PRIMARY KEY,
    doctor_id    INT             NOT NULL REFERENCES doctors(id),
    time_slot    TIME            NOT NULL,
    is_available BOOLEAN         NOT NULL DEFAULT TRUE,
    UNIQUE (doctor_id, time_slot)
);


-- ============================================================
-- SECTION 3: PATIENTS (was: fichas)
-- ============================================================
-- fichas was the patient card. Fields removed:
--   fuente, lugarTrabajo, tipoTrabajo, trabajoConyuge, tipoTrabajoConyuge
--   valorConsulta → moved to clinical_records.visit_fee
-- profesional (stored as text "1") → doctor_id FK

CREATE TABLE patients (
    id                  SERIAL          PRIMARY KEY,
    doc_type            VARCHAR(5),
    doc_number          VARCHAR(20),
    last_name           VARCHAR(60)     NOT NULL,
    first_name          VARCHAR(60)     NOT NULL,
    address             VARCHAR(255),
    district            VARCHAR(60),
    province            VARCHAR(60),
    birth_date          DATE,
    gender              VARCHAR(15)     CHECK (gender IN (
                            'male', 'female', 'other', 'unspecified'
                        )),
    insurance_id        INT             REFERENCES health_insurances(id),
    insurance_number    VARCHAR(60),
    phone               VARCHAR(30),
    email               VARCHAR(150),
    postal_code         VARCHAR(10),
    marital_status      VARCHAR(20)     CHECK (marital_status IN (
                            'single', 'married', 'divorced', 'widowed',
                            'separated', 'common_law', 'other'
                        )),
    doctor_id           INT             REFERENCES doctors(id),
    first_visit_date    DATE,
    last_visit_date     DATE,
    diagnosis           TEXT,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);


-- ============================================================
-- SECTION 4: APPOINTMENTS (was: inst_turnos)
-- ============================================================
-- patient_id: was Turno_paciente VARCHAR (free text name) → FK
-- schedule_id: was Turno_hora INT (Horarios_id ref) → proper FK
-- Turno_telefono removed: use patients.phone via FK

CREATE TABLE appointments (
    id              SERIAL          PRIMARY KEY,
    patient_id      INT             REFERENCES patients(id),
    reason_id       INT             REFERENCES visit_reasons(id),
    doctor_id       INT             NOT NULL REFERENCES doctors(id),
    date            DATE            NOT NULL,
    schedule_id     INT             REFERENCES schedules(id),
    insurance_id    INT             REFERENCES health_insurances(id),
    status          VARCHAR(20)     NOT NULL DEFAULT 'pending'
                                    CHECK (status IN (
                                        'pending', 'confirmed', 'completed', 'cancelled'
                                    )),
    notes           TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);


-- ============================================================
-- SECTION 5: CLINICAL RECORDS (was: historiaclinica)
-- ============================================================
-- Original PK was compound (idHistoriaClinica, fechaConsulta) – replaced with SERIAL.
-- idHistoriaClinica was a FK to fichas.idFicha, renamed to patient_id.
-- visit_fee moved here from fichas.valorConsulta.
-- appointment_id links back to the appointment that originated this record (nullable:
--   some visits may not have a prior appointment).

CREATE TABLE clinical_records (
    id              SERIAL          PRIMARY KEY,
    patient_id      INT             NOT NULL REFERENCES patients(id),
    doctor_id       INT             REFERENCES doctors(id),
    reason_id       INT             REFERENCES visit_reasons(id),
    appointment_id  INT             REFERENCES appointments(id),
    visit_date      DATE            NOT NULL,
    notes           TEXT,
    visit_fee       DECIMAL(10,2),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);


-- ============================================================
-- SECTION 6: SURGERIES (was: cirugias)
-- ============================================================
-- Patient data (apellido, nombre, edad, domicilio) extracted to patients table.
-- diagnostico, miembro → FK to lookup tables.
-- tecnica1/2/3 → surgery_applied_techniques junction table.
-- id_cirugia had no AUTO_INCREMENT in source – replaced with SERIAL.

CREATE TABLE surgeries (
    id              SERIAL          PRIMARY KEY,
    patient_id      INT             REFERENCES patients(id),
    doctor_id       INT             REFERENCES doctors(id),
    date            DATE            NOT NULL,
    diagnosis_id    INT             REFERENCES surgery_diagnoses(id),
    body_part_id    INT             REFERENCES body_parts(id),
    outcome         TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Replaces tecnica1 / tecnica2 / tecnica3 columns.
-- order_index preserves the original sequencing (1, 2, 3).
CREATE TABLE surgery_applied_techniques (
    surgery_id      INT             NOT NULL REFERENCES surgeries(id) ON DELETE CASCADE,
    technique_id    INT             NOT NULL REFERENCES surgery_techniques(id),
    order_index     SMALLINT        NOT NULL CHECK (order_index BETWEEN 1 AND 10),
    PRIMARY KEY (surgery_id, technique_id)
);


-- ============================================================
-- SECTION 7: CASH & FINANCE (was: caja)
-- ============================================================
-- ingresosCaja + egresosCaja (VARCHAR with comma decimals) → amount DECIMAL + type ENUM.
-- Migration: replace ',' with '.' in amounts; determine type from which column was non-zero.

CREATE TABLE cash_entries (
    id          SERIAL          PRIMARY KEY,
    date        DATE            NOT NULL,
    description VARCHAR(200)    NOT NULL,
    amount      DECIMAL(10,2)   NOT NULL CHECK (amount > 0),
    type        VARCHAR(10)     NOT NULL CHECK (type IN ('income', 'expense')),
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Periodic balance checkpoints derived from cash_entries.
-- closing_balance is auto-computed: opening_balance + total_income - total_expenses.
-- status 'closed' means the period is finalized and totals should not change.
-- Query pattern for current balance:
--   SELECT closing_balance FROM balance_snapshots WHERE status='closed' ORDER BY period_end DESC LIMIT 1
--   then add SUM of cash_entries since that date.
CREATE TABLE balance_snapshots (
    id                  SERIAL          PRIMARY KEY,
    period_start        DATE            NOT NULL,
    period_end          DATE            NOT NULL,
    opening_balance     DECIMAL(10,2)   NOT NULL DEFAULT 0,
    total_income        DECIMAL(10,2)   NOT NULL DEFAULT 0,
    total_expenses      DECIMAL(10,2)   NOT NULL DEFAULT 0,
    closing_balance     DECIMAL(10,2)   NOT NULL
                            GENERATED ALWAYS AS
                            (opening_balance + total_income - total_expenses) STORED,
    status              VARCHAR(10)     NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open', 'closed')),
    notes               TEXT,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    CONSTRAINT period_dates_valid CHECK (period_start <= period_end),
    UNIQUE (period_start, period_end)
);


-- ============================================================
-- SECTION 8: INDEXES
-- ============================================================

-- patients – most common search axes
CREATE INDEX idx_patients_last_name     ON patients(last_name);
CREATE INDEX idx_patients_insurance     ON patients(insurance_id);
CREATE INDEX idx_patients_doctor        ON patients(doctor_id);
CREATE INDEX idx_patients_doc_number    ON patients(doc_number) WHERE doc_number IS NOT NULL;

-- appointments – daily agenda queries
CREATE INDEX idx_appointments_date          ON appointments(date);
CREATE INDEX idx_appointments_doctor_date   ON appointments(doctor_id, date);
CREATE INDEX idx_appointments_patient       ON appointments(patient_id);
CREATE INDEX idx_appointments_status        ON appointments(status);

-- clinical_records – history lookups by patient
CREATE INDEX idx_clinical_patient           ON clinical_records(patient_id);
CREATE INDEX idx_clinical_visit_date        ON clinical_records(visit_date);
CREATE INDEX idx_clinical_appointment       ON clinical_records(appointment_id);

-- surgeries
CREATE INDEX idx_surgeries_patient          ON surgeries(patient_id);
CREATE INDEX idx_surgeries_date             ON surgeries(date);

-- cash_entries – period aggregations
CREATE INDEX idx_cash_date                  ON cash_entries(date);
CREATE INDEX idx_cash_type_date             ON cash_entries(type, date);

-- schedules – lookup by doctor
CREATE INDEX idx_schedules_doctor           ON schedules(doctor_id);
CREATE INDEX idx_schedules_available        ON schedules(doctor_id, is_available);


-- ============================================================
-- SECTION 9: TRIGGERS – updated_at
-- ============================================================

CREATE TRIGGER trg_doctors_updated_at
    BEFORE UPDATE ON doctors
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_patients_updated_at
    BEFORE UPDATE ON patients
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_appointments_updated_at
    BEFORE UPDATE ON appointments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_balance_snapshots_updated_at
    BEFORE UPDATE ON balance_snapshots
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- CLEANUP (reverse dependency order – run manually if needed)
-- ============================================================
-- DROP TABLE IF EXISTS surgery_applied_techniques;
-- DROP TABLE IF EXISTS surgeries;
-- DROP TABLE IF EXISTS surgery_techniques;
-- DROP TABLE IF EXISTS body_parts;
-- DROP TABLE IF EXISTS surgery_diagnoses;
-- DROP TABLE IF EXISTS clinical_records;
-- DROP TABLE IF EXISTS appointments;
-- DROP TABLE IF EXISTS patients;
-- DROP TABLE IF EXISTS schedules;
-- DROP TABLE IF EXISTS visit_reasons;
-- DROP TABLE IF EXISTS health_insurances;
-- DROP TABLE IF EXISTS doctors;
-- DROP TABLE IF EXISTS balance_snapshots;
-- DROP TABLE IF EXISTS cash_entries;
-- DROP FUNCTION IF EXISTS set_updated_at;
