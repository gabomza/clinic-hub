/**
 * Migrators module
 *
 * Handles data migration from MySQL format to PostgreSQL format
 */

export {
  ReferenceDataMigrator,
  DoctorRow,
  HealthInsuranceRow,
  VisitReasonRow,
  ScheduleRow,
  MigrationResult,
  createReferenceDataMigrator,
} from './reference-data-migrator';

export { PatientMigrator, PatientRow, PatientMigrationResult, createPatientMigrator } from './patient-migrator';

export {
  SurgeryMigrator,
  SurgeryRow,
  LookupIdMaps,
  PopulateLookupResult,
  createSurgeryMigrator,
} from './surgery-migrator';

export {
  AppointmentMigrator,
  AppointmentRow,
  AppointmentMigrationContext,
  AppointmentMigrationResult,
  APPOINTMENT_STATUS_MAP,
  DEFAULT_APPOINTMENT_STATUS,
  createAppointmentMigrator,
} from './appointment-migrator';

export {
  ClinicalRecordMigrator,
  ClinicalRecordRow,
  ClinicalRecordMigrationResult,
  createClinicalRecordMigrator,
} from './clinical-record-migrator';

export {
  CashEntryMigrator,
  CashEntryRow,
  CashEntryMigrationResult,
  createCashEntryMigrator,
} from './cash-entry-migrator';
