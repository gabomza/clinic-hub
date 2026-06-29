/**
 * PatientMatcher: Fuzzy matching of patients by name for linking text-free references
 *
 * Implements Requirement 6 of the data migration specification:
 * - Fuzzy matching using Jaro-Winkler distance via the 'natural' library
 * - Configurable confidence and minimum consideration thresholds
 * - Support for full_name (last_name + first_name weighted) and last_name_only modes
 * - Ambiguity detection and duplicate identification in the target pool
 *
 * Reference: docs/specs/data-migration-script/design.md "PatientMatcher" section
 */

import { JaroWinklerDistance } from 'natural';
import { normalizeText } from '@utils';

/**
 * Represents a candidate patient in the pool for matching.
 * Requirement 6.1, 6.2
 */
export interface PatientCandidate {
  /** Unique identifier of the patient in the target system */
  id: number | string;
  /** Last name / apellido (primary matching field) */
  lastName: string;
  /** First name / nombre (secondary matching field) */
  firstName?: string;
}

/**
 * Result of matching a single candidate against the input.
 * Contains both the patient data and the calculated similarity score.
 */
export interface MatchCandidateScore {
  candidate: PatientCandidate;
  score: number; // 0..1, Jaro-Winkler distance
}

/**
 * Outcome of a patient matching operation.
 * Requirement 6.2, 6.3, 6.4
 */
export type MatchOutcome =
  | {
      outcome: 'auto_linked';
      candidateId: number | string;
      score: number;
      reason: string;
    }
  | {
      outcome: 'manual_review';
      candidates: Array<{
        id: number | string;
        score: number;
      }>;
      reason: string;
    }
  | {
      outcome: 'no_match';
      reason: string;
    };

/**
 * Matching mode for patient resolution.
 *
 * Requirement 6.2, 6.5:
 * - 'full_name': matches last_name + first_name with weighted score (0.6 * ln + 0.4 * fn)
 * - 'last_name_only': matches only last_name, valid only if exactly one confident candidate
 */
export type MatchMode = 'full_name' | 'last_name_only';

/**
 * Configuration for the patient matcher.
 * Requirement 6.9: all thresholds are configurable without modifying core logic
 */
export interface PatientMatcherConfig {
  /**
   * Confidence threshold: score above this means auto-link a single candidate.
   * Default: 0.92 (Requirement 6.2, 6.9)
   */
  confidenceThreshold?: number;

  /**
   * Minimum consideration threshold: score below this is ignored completely.
   * Default: 0.75 (Requirement 6.3, 6.4, 6.9)
   */
  minConsiderationThreshold?: number;

  /**
   * Ambiguity margin: if two candidates' scores are within this margin of each other,
   * even if the top one exceeds confidenceThreshold, treat as manual_review.
   * Default: 0.05 (Requirement 6.6, 6.9)
   */
  ambiguityMargin?: number;
}

/**
 * Interface for the patient matcher.
 */
export interface PatientMatcher {
  /**
   * Match an input (last_name and optionally first_name) against a pool of candidates.
   *
   * Requirement 6.1-6.7, 9.5 (deterministic matching)
   *
   * @param input Patient reference with lastName and optional firstName
   * @param mode 'full_name' or 'last_name_only' (Requirement 6.5)
   * @param candidatePool Array of patients to match against
   * @returns MatchOutcome: 'auto_linked', 'manual_review', or 'no_match'
   */
  match(
    input: { lastName?: string; firstName?: string },
    mode: MatchMode,
    candidatePool: PatientCandidate[],
  ): MatchOutcome;

  /**
   * Detect possible duplicate patients within a pool.
   * Requirement 6.10: identifies pairs of patients with similar names.
   *
   * @param candidatePool Array of patients to check for duplicates
   * @returns Array of duplicate pairs with similarity scores
   */
  detectDuplicatesInPool(candidatePool: PatientCandidate[]): Array<{
    candidateA: PatientCandidate;
    candidateB: PatientCandidate;
    score: number;
  }>;
}

/**
 * Factory function to create a PatientMatcher with the given configuration.
 * Requirement 6.9, 10.2
 */
export function createPatientMatcher(config: PatientMatcherConfig = {}): PatientMatcher {
  const confidenceThreshold = config.confidenceThreshold ?? 0.92;
  const minConsiderationThreshold = config.minConsiderationThreshold ?? 0.75;
  const ambiguityMargin = config.ambiguityMargin ?? 0.05;

  // Validate thresholds (fail-fast, Requirement 10.6)
  if (confidenceThreshold < 0 || confidenceThreshold > 1) {
    throw new Error(`Invalid confidenceThreshold: ${confidenceThreshold}, must be between 0 and 1`);
  }
  if (minConsiderationThreshold < 0 || minConsiderationThreshold > 1) {
    throw new Error(`Invalid minConsiderationThreshold: ${minConsiderationThreshold}, must be between 0 and 1`);
  }
  if (ambiguityMargin < 0 || ambiguityMargin > 1) {
    throw new Error(`Invalid ambiguityMargin: ${ambiguityMargin}, must be between 0 and 1`);
  }

  /**
   * Calculate Jaro-Winkler distance between two normalized strings.
   * Returns a value 0..1 where 1 is perfect match.
   */
  function jaroWinkler(a: string, b: string): number {
    try {
      // JaroWinklerDistance expects lowercase strings in natural.js
      const normalized_a = normalizeText(a, { removePunctuation: true });
      const normalized_b = normalizeText(b, { removePunctuation: true });

      // natural.JaroWinklerDistance returns a value 0..1
      const distance = JaroWinklerDistance(normalized_a, normalized_b);

      // Ensure result is in valid range
      return Math.max(0, Math.min(1, distance));
    } catch (err) {
      // If normalization or distance calculation fails, return 0 (no match)
      console.warn(`jaroWinkler error comparing "${a}" vs "${b}": ${err instanceof Error ? err.message : 'unknown'}`);
      return 0;
    }
  }

  /**
   * Calculate the combined score for full_name mode.
   * Requirement 6.2: weighted average 0.6 * lastName + 0.4 * firstName
   */
  function calculateFullNameScore(
    input: { lastName: string; firstName?: string },
    candidate: PatientCandidate,
  ): number {
    const lastNameScore = jaroWinkler(input.lastName, candidate.lastName);

    // If firstName is empty/missing in input or candidate, weight it as 0 (no contribution)
    let firstNameScore = 0;
    if (input.firstName && candidate.firstName) {
      firstNameScore = jaroWinkler(input.firstName, candidate.firstName);
    }

    // Weighted combination: 60% last name, 40% first name
    return 0.6 * lastNameScore + 0.4 * firstNameScore;
  }

  /**
   * Calculate score for last_name_only mode.
   * Requirement 6.5: direct comparison of last names only
   */
  function calculateLastNameOnlyScore(input: { lastName: string }, candidate: PatientCandidate): number {
    return jaroWinkler(input.lastName, candidate.lastName);
  }

  /**
   * Main matching algorithm.
   * Requirement 6.1-6.7, 9.5
   */
  function match(
    input: { lastName?: string; firstName?: string },
    mode: MatchMode,
    candidatePool: PatientCandidate[],
  ): MatchOutcome {
    // Requirement 6.6: Empty or whitespace-only input -> no_match directly
    const lastName = (input.lastName ?? '').trim();
    const firstName = (input.firstName ?? '').trim();

    if (!lastName && !firstName) {
      return {
        outcome: 'no_match',
        reason: 'Empty input: both lastName and firstName are missing or empty',
      };
    }

    // For last_name_only mode, we MUST have a lastName
    if (mode === 'last_name_only' && !lastName) {
      return {
        outcome: 'no_match',
        reason: 'last_name_only mode requires a non-empty lastName, but got empty string',
      };
    }

    // Calculate scores for all candidates
    const scores: MatchCandidateScore[] = [];

    for (const candidate of candidatePool) {
      let score: number;

      if (mode === 'full_name') {
        score = calculateFullNameScore({ lastName, firstName }, candidate);
      } else {
        // mode === 'last_name_only'
        score = calculateLastNameOnlyScore({ lastName }, candidate);
      }

      scores.push({ candidate, score });
    }

    // Requirement 6.3, 6.4: Filter by minimum consideration threshold
    const consideredCandidates = scores.filter((s) => s.score >= minConsiderationThreshold);

    if (consideredCandidates.length === 0) {
      return {
        outcome: 'no_match',
        reason: `No candidates found with score >= ${minConsiderationThreshold}`,
      };
    }

    // Sort by score descending for deterministic ordering (Requirement 9.5)
    consideredCandidates.sort((a, b) => b.score - a.score);

    // Requirement 6.2, 6.6: Check for auto_linkable candidate
    const topCandidate = consideredCandidates[0];

    if (topCandidate.score >= confidenceThreshold) {
      // Check ambiguity margin: if second candidate is too close, escalate to manual_review
      // Requirement 6.6
      if (consideredCandidates.length > 1) {
        const secondCandidate = consideredCandidates[1];
        const scoreDifference = topCandidate.score - secondCandidate.score;

        if (scoreDifference < ambiguityMargin) {
          // Ambiguity detected: escalate to manual review
          return {
            outcome: 'manual_review',
            candidates: consideredCandidates.map((s) => ({
              id: s.candidate.id,
              score: s.score,
            })),
            reason: `Top candidate (score ${topCandidate.score.toFixed(3)}) within ambiguity margin (${ambiguityMargin}) of second candidate (score ${secondCandidate.score.toFixed(3)})`,
          };
        }
      }

      // Requirement 6.2: Single strong candidate -> auto_link
      return {
        outcome: 'auto_linked',
        candidateId: topCandidate.candidate.id,
        score: topCandidate.score,
        reason: `Single candidate with score ${topCandidate.score.toFixed(3)} exceeds confidence threshold ${confidenceThreshold}`,
      };
    }

    // Requirement 6.3: Multiple candidates above min threshold but none above confidence threshold
    return {
      outcome: 'manual_review',
      candidates: consideredCandidates.map((s) => ({
        id: s.candidate.id,
        score: s.score,
      })),
      reason: `Top candidate (score ${topCandidate.score.toFixed(3)}) below confidence threshold ${confidenceThreshold}; ${consideredCandidates.length} candidates above minimum threshold for manual review`,
    };
  }

  /**
   * Detect possible duplicate patients in the pool.
   * Requirement 6.10: self-comparison of the pool, excluding diagonal
   */
  function detectDuplicatesInPool(candidatePool: PatientCandidate[]): Array<{
    candidateA: PatientCandidate;
    candidateB: PatientCandidate;
    score: number;
  }> {
    const duplicates: Array<{
      candidateA: PatientCandidate;
      candidateB: PatientCandidate;
      score: number;
    }> = [];

    // O(n²) comparison of all pairs, excluding diagonal
    // (acceptable for pools < 100k, per design)
    for (let i = 0; i < candidatePool.length; i++) {
      for (let j = i + 1; j < candidatePool.length; j++) {
        const candidate_a = candidatePool[i];
        const candidate_b = candidatePool[j];

        // Use full_name mode for duplicate detection
        const score = calculateFullNameScore(
          {
            lastName: candidate_a.lastName,
            firstName: candidate_a.firstName,
          },
          candidate_b,
        );

        // Report if score exceeds confidence threshold
        if (score >= confidenceThreshold) {
          duplicates.push({
            candidateA: candidate_a,
            candidateB: candidate_b,
            score,
          });
        }
      }
    }

    return duplicates;
  }

  return {
    match,
    detectDuplicatesInPool,
  };
}
