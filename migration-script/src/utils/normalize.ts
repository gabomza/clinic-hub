/**
 * Text normalization utility for the data migration script.
 *
 * Applies a consistent set of transformations to text fields for:
 * - Duplicate detection across legacy and new systems (Requirement 1.6)
 * - Patient matching with fuzzy comparison (Requirement 6.1)
 *
 * Transformations applied in order:
 * 1. Trim: remove leading/trailing whitespace
 * 2. Uppercase: convert to UPPERCASE (unless preserveCase: true)
 * 3. Strip accents: remove diacritics, preserving Ñ (NFD + combining char removal)
 * 4. Collapse whitespace: convert multiple spaces to single space
 * 5. Remove punctuation: strip common punctuation (unless removePunctuation: false)
 */

export interface NormalizeOptions {
  /**
   * If true, preserve the original case. Default: false (convert to uppercase).
   */
  preserveCase?: boolean;

  /**
   * If true, remove common punctuation marks. Default: true.
   */
  removePunctuation?: boolean;

  /**
   * If true, collapse multiple spaces to single space. Default: true.
   */
  collapseWhitespace?: boolean;
}

/**
 * Normalize text for matching and deduplication.
 *
 * @param text - The input text to normalize
 * @param options - Normalization options
 * @returns Normalized text
 * @throws Error if text is not a string or is null/undefined
 *
 * @example
 * normalizeText("PEÑA González")           // → "PEÑA GONZALEZ"
 * normalizeText("josé maría pérez")        // → "JOSE MARIA PEREZ"
 * normalizeText("O'Brien")                 // → "OBRIEN"
 * normalizeText("García,  López")          // → "GARCIA LOPEZ"
 * normalizeText("  Multiple   Spaces  ")   // → "MULTIPLE SPACES"
 * normalizeText("Ñoño Martínez")           // → "ÑOÑO MARTINEZ"
 * normalizeText("saint-louis")             // → "SAINTLOUIS"
 * normalizeText("test", { preserveCase: true })  // → "test"
 * normalizeText("O'Brien", { removePunctuation: false }) // → "O'BRIEN"
 */
export function normalizeText(text: string | null | undefined, options?: NormalizeOptions): string {
  // Handle null/undefined: throw error for safety
  if (text == null) {
    throw new Error('normalizeText: input text must be a string, not null or undefined');
  }

  if (typeof text !== 'string') {
    throw new Error(`normalizeText: input must be a string, got ${typeof text}`);
  }

  const { preserveCase = false, removePunctuation = true, collapseWhitespace = true } = options ?? {};

  let result = text;

  // Step 1: Trim leading and trailing whitespace
  result = result.trim();

  // Step 2: Convert to uppercase (unless preserveCase option is true)
  if (!preserveCase) {
    result = result.toUpperCase();
  }

  // Step 3: Strip accents (remove diacritical marks while preserving Ñ)
  // Ñ in Unicode is represented as N (U+004E) + combining tilde (U+0303)
  // We need to remove all combining marks EXCEPT the tilde when it follows N
  result = result.normalize('NFD');

  // Process character by character
  const chars: string[] = [];
  for (let i = 0; i < result.length; i++) {
    const code = result.charCodeAt(i);

    // Keep non-combining characters (outside Unicode combining diacriticals range U+0300-U+036F)
    if (code < 0x0300 || code > 0x036f) {
      chars.push(result[i]);
    }
    // Special case: preserve combining tilde (U+0303) after N for Ñ
    else if (i > 0 && result.charCodeAt(i - 1) === 0x004e && code === 0x0303) {
      chars.push(result[i]);
    }
    // Skip all other combining marks (accents, umlauts, etc.)
  }

  // Recompose to NFC form (combining characters back to single chars where possible)
  result = chars.join('').normalize('NFC');

  // Step 4: Collapse multiple spaces to single space (BEFORE removing punctuation)
  // This way, punctuation that had spaces around it is preserved as space boundaries
  if (collapseWhitespace) {
    result = result.replace(/\s+/g, ' ').trim();
  }

  // Step 5: Remove punctuation
  if (removePunctuation) {
    // Remove common punctuation from legacy dataset: . , ; : ! ? ' " - ( ) [ ] { }
    result = result.replace(/[.,;:!?'"\-()[\]{}]/g, '');
  }

  return result;
}
