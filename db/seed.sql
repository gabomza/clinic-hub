-- ============================================================
-- Medical Institute – Reference / Seed Data
-- Apply after schema.sql on a fresh database.
-- ============================================================
-- Contains the reference rows for lookup tables only.
-- Patient, clinical, financial, and surgical data is loaded
-- by the migration script (migration-script/) once a production
-- dump is available.
-- ============================================================

-- doctors (source: inst_doctor)
INSERT INTO doctors (id, name, specialty, is_active) VALUES
    (1, 'Dr. Angel Guzman',  NULL, TRUE),
    (2, 'Dr. Alberto Silva', NULL, TRUE),
    (3, 'Dra. Pelaez',       NULL, TRUE);
SELECT setval('doctors_id_seq', 3);

-- health_insurances (source: inst_obrasoc)
-- Row 1 was a UI separator '---', kept as inactive
INSERT INTO health_insurances (id, name, is_active) VALUES
    (1,  '---',              FALSE),
    (2,  'CIMESA',           TRUE),
    (3,  'OSEP',             TRUE),
    (4,  'Docthos',          TRUE),
    (5,  'Swiss Medical',    TRUE),
    (6,  'DAMSU',            TRUE),
    (7,  'MEDIFE',           TRUE),
    (8,  'Petroleros Priv',  TRUE),
    (9,  'TIM',              TRUE),
    (10, 'Caja Forense',     TRUE),
    (11, 'Poder Judicial',   TRUE),
    (12, 'MEDICUS',          TRUE),
    (13, 'CONSALUD',         TRUE),
    (14, 'JERARQUICOSALUD',  TRUE),
    (15, 'PARTICULAR',       TRUE),
    (16, 'No Cobrar',        TRUE),
    (17, 'OSDE',             TRUE),
    (18, 'PAMI',             TRUE);
SELECT setval('health_insurances_id_seq', 18);

-- visit_reasons (source: inst_motivo)
-- default_fee left NULL: to be set by the administrator in the app
INSERT INTO visit_reasons (id, name, default_fee, is_active) VALUES
    (1, 'First Visit',       NULL, TRUE),
    (2, 'Consultation',      NULL, TRUE),
    (3, 'Sclerosis',         NULL, TRUE),
    (4, 'Microsurgery',      NULL, TRUE),
    (5, 'Surgery Follow-up', NULL, TRUE),
    (6, 'Micro Follow-up',   NULL, TRUE),
    (7, 'Suture',            NULL, TRUE),
    (8, 'For Study',         NULL, TRUE),
    (9, 'For Cellulitis',    NULL, TRUE);
SELECT setval('visit_reasons_id_seq', 9);

-- schedules (source: inst_horarios)
-- Mapping: Horarios_estado 0→doctor_id 1, 1→doctor_id 2, 2→doctor_id 3
-- Original IDs preserved so Turno_hora references remain valid during migration.
INSERT INTO schedules (id, doctor_id, time_slot, is_available) VALUES
    -- Doctor 1 (Dr. Guzman) – morning + afternoon/evening
    (1,  1, '09:00', TRUE), (2,  1, '09:20', TRUE), (3,  1, '09:40', TRUE),
    (4,  1, '10:00', TRUE), (5,  1, '10:20', TRUE), (6,  1, '10:40', TRUE),
    (7,  1, '11:00', TRUE), (8,  1, '11:20', TRUE), (9,  1, '11:40', TRUE),
    (10, 1, '16:00', TRUE), (11, 1, '16:20', TRUE), (12, 1, '16:40', TRUE),
    (13, 1, '17:00', TRUE), (14, 1, '17:20', TRUE), (15, 1, '17:40', TRUE),
    (16, 1, '18:00', TRUE), (17, 1, '18:20', TRUE), (18, 1, '18:40', TRUE),
    (19, 1, '19:00', TRUE), (20, 1, '19:20', TRUE), (21, 1, '19:40', TRUE),
    (22, 1, '20:00', TRUE), (70, 1, '20:20', TRUE), (71, 1, '20:40', TRUE),
    (72, 1, '21:00', TRUE),
    -- Doctor 2 (Dr. Silva) – morning + afternoon/evening
    (23, 2, '09:00', TRUE), (24, 2, '09:20', TRUE), (25, 2, '09:40', TRUE),
    (26, 2, '10:00', TRUE), (27, 2, '10:20', TRUE), (28, 2, '10:40', TRUE),
    (29, 2, '11:00', TRUE), (30, 2, '11:20', TRUE), (31, 2, '11:40', TRUE),
    (32, 2, '12:00', TRUE), (33, 2, '12:20', TRUE), (34, 2, '16:00', TRUE),
    (35, 2, '16:20', TRUE), (36, 2, '16:40', TRUE), (37, 2, '17:00', TRUE),
    (38, 2, '17:20', TRUE), (41, 2, '17:40', TRUE), (42, 2, '18:00', TRUE),
    (43, 2, '18:20', TRUE), (44, 2, '18:40', TRUE), (45, 2, '19:00', TRUE),
    (46, 2, '19:20', TRUE), (47, 2, '19:40', TRUE), (48, 2, '20:00', TRUE),
    (49, 2, '20:20', TRUE), (50, 2, '20:40', TRUE), (51, 2, '21:00', TRUE),
    -- Doctor 3 (Dra. Pelaez) – afternoon only, 15-min slots
    (52, 3, '16:00', TRUE), (53, 3, '16:15', TRUE), (54, 3, '16:30', TRUE),
    (55, 3, '16:45', TRUE), (56, 3, '17:00', TRUE), (57, 3, '17:15', TRUE),
    (58, 3, '17:30', TRUE), (59, 3, '17:45', TRUE), (60, 3, '18:00', TRUE),
    (61, 3, '18:15', TRUE), (62, 3, '18:30', TRUE), (63, 3, '18:45', TRUE),
    (65, 3, '19:00', TRUE), (66, 3, '19:15', TRUE), (67, 3, '19:30', TRUE),
    (68, 3, '19:45', TRUE), (69, 3, '20:00', TRUE);
SELECT setval('schedules_id_seq', 72);
