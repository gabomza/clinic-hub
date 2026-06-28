/**
 * Matcher module - re-exports PatientMatcher
 *
 * Implements fuzzy matching of patients by name using Jaro-Winkler distance.
 * Core component for resolving text-free patient references.
 *
 * Requirement 6.1-6.10, 9.5
 */

export {
  type PatientCandidate,
  type MatchCandidateScore,
  type MatchOutcome,
  type MatchMode,
  type PatientMatcherConfig,
  type PatientMatcher,
  createPatientMatcher,
} from './patient-matcher';
