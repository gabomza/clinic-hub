import { describe, it, expect, beforeEach } from 'vitest';
import { loadConfig, MigrationConfig } from '../index';

describe('ConfigLoader - loadConfig', () => {
  const defaultEnv: NodeJS.ProcessEnv = {
    DATABASE_URL: 'postgres://localhost/test',
    DUMP_FILE_PATH: '/path/to/dump.sql',
  };

  beforeEach(() => {
    // Reset environment for each test to ensure isolation
  });

  describe('CLI argument parsing', () => {
    it('should parse --flag value format', () => {
      const argv: string[] = ['--dump-file', '/path/to/dump.sql', '--database-url', 'postgres://localhost/test'];
      const config = loadConfig(argv, {});
      expect(config.dumpFilePath).toBe('/path/to/dump.sql');
      expect(config.databaseUrl).toBe('postgres://localhost/test');
    });

    it('should parse --flag=value format', () => {
      const argv: string[] = ['--dump-file=/path/to/dump.sql', '--database-url=postgres://localhost/test'];
      const config = loadConfig(argv, {});
      expect(config.dumpFilePath).toBe('/path/to/dump.sql');
      expect(config.databaseUrl).toBe('postgres://localhost/test');
    });

    it('should parse numeric values correctly', () => {
      const argv: string[] = [
        '--match-threshold',
        '0.85',
        '--match-min-threshold',
        '0.60',
        '--insert-batch-size',
        '1000',
      ];
      const config = loadConfig(argv, defaultEnv);
      expect(config.matchConfidenceThreshold).toBe(0.85);
      expect(config.matchMinConsiderationThreshold).toBe(0.6);
      expect(config.insertBatchSize).toBe(1000);
    });

    it('should handle mixed --flag value and --flag=value formats', () => {
      const argv: string[] = ['--dump-file=/path/to/dump.sql', '--database-url', 'postgres://localhost/test'];
      const config = loadConfig(argv, {});
      expect(config.dumpFilePath).toBe('/path/to/dump.sql');
      expect(config.databaseUrl).toBe('postgres://localhost/test');
    });

    it('should handle flags with empty string values', () => {
      const argv: string[] = ['--dump-file', '', '--database-url', 'postgres://test'];
      expect(() => loadConfig(argv, {})).toThrow('DUMP_FILE_PATH es requerida');
    });

    it('should stop parsing when encountering another flag', () => {
      const argv: string[] = ['--dump-file', '--database-url', 'postgres://test'];
      expect(() => loadConfig(argv, {})).toThrow();
    });
  });

  describe('Configuration priority (CLI > ENV > defaults)', () => {
    it('should prioritize CLI arguments over environment variables', () => {
      const argv: string[] = ['--database-url', 'postgres://cli-url'];
      const env = {
        DATABASE_URL: 'postgres://env-url',
        DUMP_FILE_PATH: '/path/to/dump.sql',
      };
      const config = loadConfig(argv, env);
      expect(config.databaseUrl).toBe('postgres://cli-url');
    });

    it('should prioritize environment variables over defaults', () => {
      const env = {
        MATCH_CONFIDENCE_THRESHOLD: '0.75',
        DATABASE_URL: 'postgres://localhost/test',
        DUMP_FILE_PATH: '/path/to/dump.sql',
      };
      const config = loadConfig([] as string[], env);
      expect(config.matchConfidenceThreshold).toBe(0.75);
    });

    it('should use default values when CLI and ENV are not provided', () => {
      const argv: string[] = [];
      const env = {
        DATABASE_URL: 'postgres://localhost/test',
        DUMP_FILE_PATH: '/path/to/dump.sql',
      };
      const config = loadConfig(argv, env);
      expect(config.matchConfidenceThreshold).toBe(0.92);
      expect(config.matchMinConsiderationThreshold).toBe(0.75);
      expect(config.resetMode).toBe('log-only');
      expect(config.reportOutputDir).toBe('./reports');
      expect(config.insertBatchSize).toBe(500);
    });
  });

  describe('Default values', () => {
    it('should apply all default values', () => {
      const env = {
        DATABASE_URL: 'postgres://localhost/test',
        DUMP_FILE_PATH: '/path/to/dump.sql',
      };
      const config = loadConfig([] as string[], env);

      expect(config.matchConfidenceThreshold).toBe(0.92);
      expect(config.matchMinConsiderationThreshold).toBe(0.75);
      expect(config.resetMode).toBe('log-only');
      expect(config.reportOutputDir).toBe('./reports');
      expect(config.insertBatchSize).toBe(500);
    });
  });

  describe('Validation: Required fields', () => {
    it('should fail if databaseUrl is empty', () => {
      const argv: string[] = [];
      const env = {
        DUMP_FILE_PATH: '/path/to/dump.sql',
      };
      expect(() => loadConfig(argv, env)).toThrow('DATABASE_URL es requerida y no puede estar vacía');
    });

    it('should fail if databaseUrl is only whitespace', () => {
      const argv = ['--database-url', '   '];
      const env = {
        DUMP_FILE_PATH: '/path/to/dump.sql',
      };
      expect(() => loadConfig(argv, env)).toThrow('DATABASE_URL es requerida y no puede estar vacía');
    });

    it('should fail if dumpFilePath is empty', () => {
      const argv: string[] = [];
      const env = {
        DATABASE_URL: 'postgres://localhost/test',
      };
      expect(() => loadConfig(argv, env)).toThrow('DUMP_FILE_PATH es requerida y no puede estar vacía');
    });

    it('should fail if dumpFilePath is only whitespace', () => {
      const argv = ['--dump-file', '   '];
      const env = {
        DATABASE_URL: 'postgres://localhost/test',
      };
      expect(() => loadConfig(argv, env)).toThrow('DUMP_FILE_PATH es requerida y no puede estar vacía');
    });
  });

  describe('Validation: Thresholds range [0, 1]', () => {
    it('should fail if matchConfidenceThreshold is negative', () => {
      const argv = ['--match-threshold', '-0.1'];
      const env = defaultEnv;
      expect(() => loadConfig(argv, env)).toThrow('matchConfidenceThreshold debe estar en el rango [0, 1]');
    });

    it('should fail if matchConfidenceThreshold is greater than 1', () => {
      const argv = ['--match-threshold', '1.5'];
      const env = defaultEnv;
      expect(() => loadConfig(argv, env)).toThrow('matchConfidenceThreshold debe estar en el rango [0, 1]');
    });

    it('should accept matchConfidenceThreshold of 0', () => {
      const argv = ['--match-threshold', '0', '--match-min-threshold', '0'];
      const env = defaultEnv;
      const config = loadConfig(argv, env);
      expect(config.matchConfidenceThreshold).toBe(0);
    });

    it('should accept matchConfidenceThreshold of 1', () => {
      const argv = ['--match-threshold', '1'];
      const env = defaultEnv;
      const config = loadConfig(argv, env);
      expect(config.matchConfidenceThreshold).toBe(1);
    });

    it('should fail if matchMinConsiderationThreshold is negative', () => {
      const argv = ['--match-min-threshold', '-0.1'];
      const env = defaultEnv;
      expect(() => loadConfig(argv, env)).toThrow('matchMinConsiderationThreshold debe estar en el rango [0, 1]');
    });

    it('should fail if matchMinConsiderationThreshold is greater than 1', () => {
      const argv = ['--match-min-threshold', '1.1'];
      const env = defaultEnv;
      expect(() => loadConfig(argv, env)).toThrow('matchMinConsiderationThreshold debe estar en el rango [0, 1]');
    });

    it('should accept matchMinConsiderationThreshold of 0', () => {
      const argv = ['--match-min-threshold', '0'];
      const env = defaultEnv;
      const config = loadConfig(argv, env);
      expect(config.matchMinConsiderationThreshold).toBe(0);
    });

    it('should accept matchMinConsiderationThreshold of 1', () => {
      const argv = ['--match-min-threshold', '1', '--match-threshold', '1'];
      const env = defaultEnv;
      const config = loadConfig(argv, env);
      expect(config.matchMinConsiderationThreshold).toBe(1);
    });

    it('should fail if thresholds are NaN', () => {
      const argv = ['--match-threshold', 'not-a-number'];
      const env = defaultEnv;
      expect(() => loadConfig(argv, env)).toThrow();
    });
  });

  describe('Validation: Threshold relationship', () => {
    it('should fail if matchMinConsiderationThreshold > matchConfidenceThreshold', () => {
      const argv = ['--match-threshold', '0.70', '--match-min-threshold', '0.80'];
      const env = defaultEnv;
      expect(() => loadConfig(argv, env)).toThrow(
        'matchMinConsiderationThreshold (0.8) no puede ser mayor a matchConfidenceThreshold (0.7)',
      );
    });

    it('should pass if matchMinConsiderationThreshold equals matchConfidenceThreshold', () => {
      const argv = ['--match-threshold', '0.75', '--match-min-threshold', '0.75'];
      const env = defaultEnv;
      const config = loadConfig(argv, env);
      expect(config.matchConfidenceThreshold).toBe(0.75);
      expect(config.matchMinConsiderationThreshold).toBe(0.75);
    });

    it('should pass if matchMinConsiderationThreshold < matchConfidenceThreshold', () => {
      const argv = ['--match-threshold', '0.92', '--match-min-threshold', '0.60'];
      const env = defaultEnv;
      const config = loadConfig(argv, env);
      expect(config.matchConfidenceThreshold).toBe(0.92);
      expect(config.matchMinConsiderationThreshold).toBe(0.6);
    });
  });

  describe('Validation: Batch size', () => {
    it('should fail if insertBatchSize is 0', () => {
      const argv = ['--insert-batch-size', '0'];
      const env = defaultEnv;
      expect(() => loadConfig(argv, env)).toThrow('insertBatchSize debe ser >= 1');
    });

    it('should fail if insertBatchSize is negative', () => {
      const argv = ['--insert-batch-size', '-10'];
      const env = defaultEnv;
      expect(() => loadConfig(argv, env)).toThrow('insertBatchSize debe ser >= 1');
    });

    it('should accept insertBatchSize of 1', () => {
      const argv = ['--insert-batch-size', '1'];
      const env = defaultEnv;
      const config = loadConfig(argv, env);
      expect(config.insertBatchSize).toBe(1);
    });

    it('should accept large insertBatchSize values', () => {
      const argv = ['--insert-batch-size', '10000'];
      const env = defaultEnv;
      const config = loadConfig(argv, env);
      expect(config.insertBatchSize).toBe(10000);
    });

    it('should accept and truncate float values for insertBatchSize', () => {
      const argv = ['--insert-batch-size', '10.9'];
      const env = defaultEnv;
      const config = loadConfig(argv, env);
      expect(config.insertBatchSize).toBe(10); // parseInt truncates
    });

    it('should fail if insertBatchSize is NaN', () => {
      const argv = ['--insert-batch-size', 'not-a-number'];
      const env = defaultEnv;
      expect(() => loadConfig(argv, env)).toThrow();
    });
  });

  describe('Validation: Reset mode', () => {
    it('should accept resetMode "log-only"', () => {
      const argv = ['--reset', 'log-only'];
      const env = defaultEnv;
      const config = loadConfig(argv, env);
      expect(config.resetMode).toBe('log-only');
    });

    it('should accept resetMode "full"', () => {
      const argv = ['--reset', 'full'];
      const env = defaultEnv;
      const config = loadConfig(argv, env);
      expect(config.resetMode).toBe('full');
    });

    it('should fail if resetMode is invalid', () => {
      const argv = ['--reset', 'invalid-mode'];
      const env = defaultEnv;
      expect(() => loadConfig(argv, env)).toThrow("resetMode debe ser 'log-only' o 'full'");
    });

    it('should use default resetMode if not provided', () => {
      const argv: string[] = [];
      const env = defaultEnv;
      const config = loadConfig(argv, env);
      expect(config.resetMode).toBe('log-only');
    });
  });

  describe('Validation: Report output directory', () => {
    it('should accept any non-empty reportOutputDir', () => {
      const argv = ['--report-output-dir', '/custom/reports'];
      const env = defaultEnv;
      const config = loadConfig(argv, env);
      expect(config.reportOutputDir).toBe('/custom/reports');
    });

    it('should use default reportOutputDir if not provided', () => {
      const argv: string[] = [];
      const env = defaultEnv;
      const config = loadConfig(argv, env);
      expect(config.reportOutputDir).toBe('./reports');
    });

    it('should read reportOutputDir from environment variable', () => {
      const argv: string[] = [];
      const env = {
        ...defaultEnv,
        REPORT_OUTPUT_DIR: '/env/reports',
      };
      const config = loadConfig(argv, env);
      expect(config.reportOutputDir).toBe('/env/reports');
    });
  });

  describe('Fail-fast validation', () => {
    it('should validate all required fields before thresholds', () => {
      const argv = [
        '--database-url',
        '',
        '--match-threshold',
        '2.0', // Invalid but not checked because required field fails first
      ];
      const env = { DUMP_FILE_PATH: '/path/to/dump.sql' };
      expect(() => loadConfig(argv, env)).toThrow('DATABASE_URL es requerida');
    });

    it('should validate threshold range before relationship', () => {
      const argv = [
        '--match-threshold',
        '1.5', // Invalid range
        '--match-min-threshold',
        '0.80',
      ];
      const env = defaultEnv;
      expect(() => loadConfig(argv, env)).toThrow('matchConfidenceThreshold debe estar en el rango [0, 1]');
    });

    it('should throw error on first validation failure', () => {
      const argv = ['--match-threshold', '-1.0', '--insert-batch-size', '-1'];
      const env = defaultEnv;
      expect(() => loadConfig(argv, env)).toThrow('matchConfidenceThreshold debe estar en el rango [0, 1]');
    });
  });

  describe('Integration scenarios', () => {
    it('should load complete valid configuration from CLI', () => {
      const argv = [
        '--dump-file',
        '/dumps/mysql.sql',
        '--database-url',
        'postgres://user:pass@localhost:5432/db',
        '--match-threshold',
        '0.85',
        '--match-min-threshold',
        '0.65',
        '--reset',
        'full',
        '--report-output-dir',
        './migration-reports',
        '--insert-batch-size',
        '1000',
      ];
      const config = loadConfig(argv, {});

      expect(config).toEqual({
        dumpFilePath: '/dumps/mysql.sql',
        databaseUrl: 'postgres://user:pass@localhost:5432/db',
        matchConfidenceThreshold: 0.85,
        matchMinConsiderationThreshold: 0.65,
        resetMode: 'full',
        reportOutputDir: './migration-reports',
        insertBatchSize: 1000,
      });
    });

    it('should load complete valid configuration from environment', () => {
      const env = {
        DUMP_FILE_PATH: '/dumps/mysql.sql',
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
        MATCH_CONFIDENCE_THRESHOLD: '0.88',
        MATCH_MIN_CONSIDERATION_THRESHOLD: '0.70',
        RESET_MODE: 'full',
        REPORT_OUTPUT_DIR: './reports-out',
        INSERT_BATCH_SIZE: '2000',
      };
      const config = loadConfig([] as string[], env);

      expect(config).toEqual({
        dumpFilePath: '/dumps/mysql.sql',
        databaseUrl: 'postgres://user:pass@localhost:5432/db',
        matchConfidenceThreshold: 0.88,
        matchMinConsiderationThreshold: 0.7,
        resetMode: 'full',
        reportOutputDir: './reports-out',
        insertBatchSize: 2000,
      });
    });

    it('should load mixed configuration with CLI override', () => {
      const argv = ['--match-threshold', '0.90'];
      const env = {
        DUMP_FILE_PATH: '/dumps/mysql.sql',
        DATABASE_URL: 'postgres://localhost/db',
        MATCH_MIN_CONSIDERATION_THRESHOLD: '0.65',
        RESET_MODE: 'full',
      };
      const config = loadConfig(argv, env);

      expect(config.dumpFilePath).toBe('/dumps/mysql.sql');
      expect(config.databaseUrl).toBe('postgres://localhost/db');
      expect(config.matchConfidenceThreshold).toBe(0.9); // From CLI
      expect(config.matchMinConsiderationThreshold).toBe(0.65); // From env
      expect(config.resetMode).toBe('full'); // From env
      expect(config.reportOutputDir).toBe('./reports'); // Default
      expect(config.insertBatchSize).toBe(500); // Default
    });

    it('should handle empty argv and env (use defaults only for optional fields)', () => {
      const env = {
        DATABASE_URL: 'postgres://localhost/db',
        DUMP_FILE_PATH: '/path/to/dump.sql',
      };
      const config = loadConfig([] as string[], env);

      expect(config.dumpFilePath).toBe('/path/to/dump.sql');
      expect(config.databaseUrl).toBe('postgres://localhost/db');
      expect(config.matchConfidenceThreshold).toBe(0.92);
      expect(config.matchMinConsiderationThreshold).toBe(0.75);
      expect(config.resetMode).toBe('log-only');
      expect(config.reportOutputDir).toBe('./reports');
      expect(config.insertBatchSize).toBe(500);
    });
  });

  describe('Edge cases', () => {
    it('should handle float values with many decimal places', () => {
      const argv: string[] = ['--match-threshold', '0.923456789'];
      const env = defaultEnv;
      const config = loadConfig(argv, env);
      expect(config.matchConfidenceThreshold).toBeCloseTo(0.923456789);
    });

    it('should handle scientific notation for threshold values', () => {
      const argv: string[] = ['--match-threshold', '1e-1', '--match-min-threshold', '1e-2'];
      const env = defaultEnv;
      const config = loadConfig(argv, env);
      expect(config.matchConfidenceThreshold).toBe(0.1);
      expect(config.matchMinConsiderationThreshold).toBe(0.01);
    });

    it('should handle leading/trailing spaces in numeric values', () => {
      const argv: string[] = ['--match-threshold', '  0.9  '];
      const env = defaultEnv;
      const config = loadConfig(argv, env);
      expect(config.matchConfidenceThreshold).toBe(0.9);
    });

    it('should handle undefined argv and env', () => {
      const env = {
        DATABASE_URL: 'postgres://localhost/db',
        DUMP_FILE_PATH: '/path/to/dump.sql',
      };
      const config = loadConfig(undefined as any, env);
      expect(config.databaseUrl).toBe('postgres://localhost/db');
    });

    it('should handle empty string in environment variable', () => {
      const argv: string[] = [];
      const env = {
        DATABASE_URL: 'postgres://localhost/db',
        DUMP_FILE_PATH: '/path/to/dump.sql',
        MATCH_CONFIDENCE_THRESHOLD: '', // Empty string
      };
      const config = loadConfig(argv, env);
      expect(config.matchConfidenceThreshold).toBe(0.92); // Uses default
    });

    it('should ignore flags that are not recognized', () => {
      const argv = ['--unknown-flag', 'value', '--database-url', 'postgres://localhost/db'];
      const env = {
        DUMP_FILE_PATH: '/path/to/dump.sql',
      };
      const config = loadConfig(argv, env);
      expect(config.databaseUrl).toBe('postgres://localhost/db');
    });
  });

  describe('Error messages in Spanish', () => {
    it('should provide Spanish error messages', () => {
      const env = { DUMP_FILE_PATH: '/path/to/dump.sql' };
      expect(() => loadConfig([] as string[], env)).toThrow(/requerida/);
    });

    it('should include invalid value in error message', () => {
      const argv = ['--match-threshold', '-0.5'];
      const env = defaultEnv;
      expect(() => loadConfig(argv, env)).toThrow('-0.5');
    });

    it('should include field name in threshold error', () => {
      const argv = ['--match-threshold', '1.5'];
      const env = defaultEnv;
      expect(() => loadConfig(argv, env)).toThrow('matchConfidenceThreshold');
    });
  });
});
