import { describe, it, expect } from 'vitest';
import { normalizeText } from '../normalize';

describe('normalizeText', () => {
  describe('basic normalization', () => {
    it('should convert lowercase to uppercase', () => {
      expect(normalizeText('test')).toBe('TEST');
      expect(normalizeText('hello')).toBe('HELLO');
    });

    it('should handle already uppercase text', () => {
      expect(normalizeText('TEST')).toBe('TEST');
      expect(normalizeText('HELLO')).toBe('HELLO');
    });

    it('should handle mixed case', () => {
      expect(normalizeText('TeSt')).toBe('TEST');
      expect(normalizeText('HeLoO')).toBe('HELOO');
    });

    it('should trim leading and trailing spaces', () => {
      expect(normalizeText('  test  ')).toBe('TEST');
      expect(normalizeText('\t\n  hello  \n\t')).toBe('HELLO');
      expect(normalizeText('   ')).toBe('');
    });
  });

  describe('accent and diacritic removal', () => {
    it('should remove accents from vowels', () => {
      expect(normalizeText('josé')).toBe('JOSE');
      expect(normalizeText('María')).toBe('MARIA');
      expect(normalizeText('Pérez')).toBe('PEREZ');
      expect(normalizeText('Ramón')).toBe('RAMON');
    });

    it('should preserve Ñ', () => {
      expect(normalizeText('PEÑA')).toBe('PEÑA');
      expect(normalizeText('peña')).toBe('PEÑA');
      expect(normalizeText('ñoño')).toBe('ÑOÑO');
      expect(normalizeText('Ñoño Martínez')).toBe('ÑOÑO MARTINEZ');
    });

    it('should handle mixed accents and Ñ', () => {
      expect(normalizeText('Peña González')).toBe('PEÑA GONZALEZ');
      expect(normalizeText('María José García')).toBe('MARIA JOSE GARCIA');
      expect(normalizeText('José María Pérez García')).toBe(
        'JOSE MARIA PEREZ GARCIA',
      );
    });

    it('should preserve case distinction between N and Ñ', () => {
      // This is important: PEÑA should stay PEÑA, not become PENA
      expect(normalizeText('PEÑA')).toBe('PEÑA');
      expect(normalizeText('PENA')).toBe('PENA');
      expect(normalizeText('peña')).toBe('PEÑA');
      expect(normalizeText('pena')).toBe('PENA');
    });

    it('should handle all common Spanish diacritics', () => {
      expect(normalizeText('àáâãäå')).toBe('AAAAAA');
      expect(normalizeText('èéêë')).toBe('EEEE');
      expect(normalizeText('ìíîï')).toBe('IIII');
      expect(normalizeText('òóôõö')).toBe('OOOOO');
      expect(normalizeText('ùúûü')).toBe('UUUU');
    });
  });

  describe('whitespace collapsing', () => {
    it('should collapse multiple spaces to single space', () => {
      expect(normalizeText('  a   b  ')).toBe('A B');
      expect(normalizeText('a  b  c')).toBe('A B C');
      expect(normalizeText('a    b    c    d')).toBe('A B C D');
    });

    it('should handle mixed whitespace (spaces, tabs, newlines)', () => {
      expect(normalizeText('a\t\tb')).toBe('A B');
      expect(normalizeText('a\n\nb')).toBe('A B');
      expect(normalizeText('a  \t  \n  b')).toBe('A B');
    });

    it('should handle whitespace-only input', () => {
      expect(normalizeText('   ')).toBe('');
      expect(normalizeText('\t\t')).toBe('');
      expect(normalizeText('\n\n')).toBe('');
    });

    it('should respect collapseWhitespace option', () => {
      expect(normalizeText('a  b', { collapseWhitespace: false })).toBe('A  B');
      expect(normalizeText('a\t\tb', { collapseWhitespace: false })).toBe('A\t\tB');
    });
  });

  describe('punctuation removal', () => {
    it('should remove common punctuation marks', () => {
      expect(normalizeText("O'Brien")).toBe('OBRIEN');
      expect(normalizeText('García, López')).toBe('GARCIA LOPEZ');
      expect(normalizeText("saint-louis")).toBe('SAINTLOUIS');
      expect(normalizeText('Smith, Jr.')).toBe('SMITH JR');
    });

    it('should remove all specified punctuation marks', () => {
      expect(normalizeText('.,;:!?\'"-()')).toBe('');
      expect(normalizeText('a.b,c;d:e!f?g\'h"i-j(k)l')).toBe('ABCDEFGHIJKL');
      expect(normalizeText('a[b]c{d}e')).toBe('ABCDE');
    });

    it('should handle complex real-world cases', () => {
      expect(normalizeText("O'Donnell-Smith")).toBe('ODONNELLSMITH');
      expect(normalizeText('García, López García')).toBe('GARCIA LOPEZ GARCIA');
      // Note: "O'Connor, Jr." has spaces around comma, so after collapse becomes "O CONNOR JR"
      // But O'Connor has no space after apostrophe, so it becomes OCONNOR
      expect(normalizeText("José María O'Connor, Jr.")).toBe('JOSE MARIA OCONNOR JR');
    });

    it('should respect removePunctuation option', () => {
      expect(normalizeText("O'Brien", { removePunctuation: false })).toBe("O'BRIEN");
      expect(normalizeText('García, López', { removePunctuation: false })).toBe(
        'GARCIA, LOPEZ',
      );
      expect(normalizeText('saint-louis', { removePunctuation: false })).toBe(
        'SAINT-LOUIS',
      );
    });
  });

  describe('preserveCase option', () => {
    it('should preserve case when option is enabled', () => {
      expect(normalizeText('José', { preserveCase: true })).toBe('Jose');
      expect(normalizeText('test', { preserveCase: true })).toBe('test');
      expect(normalizeText('TeSt', { preserveCase: true })).toBe('TeSt');
      expect(normalizeText('HELLO', { preserveCase: true })).toBe('HELLO');
    });

    it('should still apply other normalizations with preserveCase', () => {
      expect(normalizeText('José  María', { preserveCase: true })).toBe('Jose Maria');
      expect(normalizeText("O'Brien", { preserveCase: true })).toBe('OBrien');
      expect(normalizeText('  test  ', { preserveCase: true })).toBe('test');
    });
  });

  describe('real-world dataset cases', () => {
    it('should handle real names from sample_dump.sql', () => {
      expect(normalizeText('María José Martínez García')).toBe(
        'MARIA JOSE MARTINEZ GARCIA',
      );
      expect(normalizeText('Peña González López')).toBe('PEÑA GONZALEZ LOPEZ');
      expect(normalizeText("O'Donnell-Smith")).toBe('ODONNELLSMITH');
    });

    it('should normalize duplicate patient names correctly', () => {
      const name1 = normalizeText('josé María pérez');
      const name2 = normalizeText('José María Pérez');
      expect(name1).toBe(name2);
      expect(name1).toBe('JOSE MARIA PEREZ');
    });

    it('should detect duplicates with spacing variations', () => {
      const name1 = normalizeText('García  López');
      const name2 = normalizeText('García, López');
      const name3 = normalizeText('Garcia Lopez');
      expect(name1).toBe(name2); // Both normalize to "GARCIA LOPEZ"
      expect(name1).toBe(name3); // All three should be equal after normalization (accents removed)
    });
  });

  describe('combined options', () => {
    it('should apply multiple options correctly', () => {
      expect(
        normalizeText("José O'Connor", {
          preserveCase: true,
          removePunctuation: true,
          collapseWhitespace: true,
        }),
      ).toBe('Jose OConnor');

      expect(
        normalizeText("JOSÉ  O'CONNOR", {
          preserveCase: false,
          removePunctuation: false,
          collapseWhitespace: true,
        }),
      ).toBe("JOSE O'CONNOR");
    });

    it('should handle empty string with options', () => {
      expect(normalizeText('', { preserveCase: true })).toBe('');
      expect(normalizeText('', { removePunctuation: false })).toBe('');
      expect(normalizeText('', { collapseWhitespace: false })).toBe('');
    });
  });

  describe('edge cases and empty input', () => {
    it('should handle empty string', () => {
      expect(normalizeText('')).toBe('');
    });

    it('should handle whitespace-only strings', () => {
      expect(normalizeText('   ')).toBe('');
      expect(normalizeText('\t\n\r')).toBe('');
    });

    it('should handle single character', () => {
      expect(normalizeText('a')).toBe('A');
      expect(normalizeText('é')).toBe('E');
      expect(normalizeText('ñ')).toBe('Ñ');
    });

    it('should throw error on null input', () => {
      expect(() => normalizeText(null as any)).toThrow('must be a string, not null');
    });

    it('should throw error on undefined input', () => {
      expect(() => normalizeText(undefined as any)).toThrow('must be a string, not null');
    });

    it('should throw error on non-string input', () => {
      expect(() => normalizeText(123 as any)).toThrow('input must be a string');
      expect(() => normalizeText({} as any)).toThrow('input must be a string');
      expect(() => normalizeText([] as any)).toThrow('input must be a string');
    });
  });

  describe('comprehensive integration test', () => {
    it('should handle complex multi-step transformation', () => {
      const input = "  José María García-López O'Connor, Jr.  ";
      // García-López becomes GARCIALOPEZ (guion removed without space)
      // O'Connor becomes OCONNOR (apostrophe removed without space)
      // Jr. becomes JR (period removed after collapse and trim)
      const expected = 'JOSE MARIA GARCIALOPEZ OCONNOR JR';
      expect(normalizeText(input)).toBe(expected);
    });

    it('should match patient names from different sources', () => {
      // Simulating legacy data vs new data
      const legacyName = normalizeText("García, José María  O'Brien");
      const newName = normalizeText('jose maria garcia obrien');
      // After normalization both should have the same components (order might differ in real app)
      const legacyNormalized = legacyName.split(' ').sort().join(' ');
      const newNormalized = newName.split(' ').sort().join(' ');
      expect(legacyNormalized).toBe(newNormalized);
    });

    it('should be pure function (no side effects)', () => {
      const input = 'José García';
      const original = input;
      normalizeText(input);
      expect(input).toBe(original);
    });

    it('should be deterministic', () => {
      const input = "María José García, López";
      const result1 = normalizeText(input);
      const result2 = normalizeText(input);
      expect(result1).toBe(result2);
    });
  });

  describe('performance characteristics', () => {
    it('should handle long strings efficiently', () => {
      const longString = 'José María '.repeat(100);
      const startTime = performance.now();
      const result = normalizeText(longString);
      const endTime = performance.now();
      // Should complete in less than 10ms for a moderately long string
      expect(endTime - startTime).toBeLessThan(10);
      expect(result).toContain('JOSE MARIA');
    });
  });
});
