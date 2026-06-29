/**
 * Configuration loading and validation
 *
 * Handles loading and validating environment variables and CLI arguments for the migration process.
 * Implements fail-fast validation to ensure critical configuration issues are caught early.
 */

/**
 * Migration configuration
 * Defines all required and optional configuration parameters for the data migration process
 */
export type MigrationConfig = {
  /** Path to the MySQL dump file to migrate from */
  dumpFilePath: string;
  /** PostgreSQL database connection URL */
  databaseUrl: string;
  /** Confidence threshold for field matching (0-1) */
  matchConfidenceThreshold: number;
  /** Minimum consideration threshold for field matching (0-1) */
  matchMinConsiderationThreshold: number;
  /** Reset mode: 'log-only' for dry-run or 'full' for actual reset */
  resetMode: 'log-only' | 'full';
  /** Output directory for migration reports */
  reportOutputDir: string;
  /** Batch size for insert operations */
  insertBatchSize: number;
};

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Omit<MigrationConfig, 'dumpFilePath' | 'databaseUrl'> = {
  matchConfidenceThreshold: 0.92,
  matchMinConsiderationThreshold: 0.75,
  resetMode: 'log-only',
  reportOutputDir: './reports',
  insertBatchSize: 500,
};

/**
 * Parses command-line arguments into a key-value map
 * Supports formats: --key value or --key=value
 */
function parseCliArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    // Handle --key=value format
    if (arg.includes('=')) {
      const [key, value] = arg.split('=', 2);
      const normalizedKey = key.replace(/^--/, '');
      args.set(normalizedKey, value);
    }
    // Handle --key value format
    else if (arg.startsWith('--')) {
      const key = arg.replace(/^--/, '');
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args.set(key, argv[i + 1]);
        i++; // Skip next iteration since we consumed the value
      }
    }
  }

  return args;
}

/**
 * Validates a numeric threshold is within [0, 1] range
 */
function validateThreshold(value: number, name: string): void {
  if (Number.isNaN(value) || value < 0 || value > 1) {
    throw new Error(`${name} debe estar en el rango [0, 1]. Valor proporcionado: ${value}`);
  }
}

/**
 * Validates the complete migration configuration
 * Implements fail-fast strategy to catch all issues early
 */
function validateConfig(config: MigrationConfig): void {
  // Validate required fields
  if (!config.databaseUrl || config.databaseUrl.trim() === '') {
    throw new Error('DATABASE_URL es requerida y no puede estar vacía');
  }

  if (!config.dumpFilePath || config.dumpFilePath.trim() === '') {
    throw new Error('DUMP_FILE_PATH es requerida y no puede estar vacía');
  }

  // Validate thresholds
  validateThreshold(config.matchConfidenceThreshold, 'matchConfidenceThreshold');
  validateThreshold(config.matchMinConsiderationThreshold, 'matchMinConsiderationThreshold');

  // Validate threshold relationship
  if (config.matchMinConsiderationThreshold > config.matchConfidenceThreshold) {
    throw new Error(
      `matchMinConsiderationThreshold (${config.matchMinConsiderationThreshold}) ` +
        `no puede ser mayor a matchConfidenceThreshold (${config.matchConfidenceThreshold})`,
    );
  }

  // Validate batch size
  if (config.insertBatchSize < 1) {
    throw new Error(`insertBatchSize debe ser >= 1. Valor proporcionado: ${config.insertBatchSize}`);
  }

  // Validate reset mode
  if (!['log-only', 'full'].includes(config.resetMode)) {
    throw new Error(`resetMode debe ser 'log-only' o 'full'. Valor proporcionado: ${config.resetMode}`);
  }
}

/**
 * Converts a string value to a number, with fallback to default
 */
function parseNumber(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value === '') {
    return defaultValue;
  }

  const parsed = parseFloat(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`No se puede convertir a número: "${value}"`);
  }

  return parsed;
}

/**
 * Converts a string value to an integer, with fallback to default
 */
function parseInteger(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value === '') {
    return defaultValue;
  }

  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`No se puede convertir a entero: "${value}"`);
  }

  return parsed;
}

/**
 * Loads and validates migration configuration from CLI arguments and environment variables
 *
 * Priority order (highest to lowest):
 * 1. CLI arguments (--flag value)
 * 2. Environment variables
 * 3. Default values
 *
 * @param argv Command-line arguments (typically process.argv.slice(2))
 * @param env Environment variables object (typically process.env)
 * @returns Validated MigrationConfig object
 * @throws Error if validation fails (fail-fast strategy)
 */
export function loadConfig(argv: string[] = [], env: NodeJS.ProcessEnv = {}): MigrationConfig {
  const cliArgs = parseCliArgs(argv);

  // Load dumpFilePath
  const dumpFilePath = cliArgs.get('dump-file') || env.DUMP_FILE_PATH || '';

  // Load databaseUrl
  const databaseUrl = cliArgs.get('database-url') || env.DATABASE_URL || '';

  // Load matchConfidenceThreshold
  const matchConfidenceThreshold = parseNumber(
    cliArgs.get('match-threshold') || env.MATCH_CONFIDENCE_THRESHOLD,
    DEFAULT_CONFIG.matchConfidenceThreshold,
  );

  // Load matchMinConsiderationThreshold
  const matchMinConsiderationThreshold = parseNumber(
    cliArgs.get('match-min-threshold') || env.MATCH_MIN_CONSIDERATION_THRESHOLD,
    DEFAULT_CONFIG.matchMinConsiderationThreshold,
  );

  // Load resetMode
  const resetMode = (cliArgs.get('reset') || env.RESET_MODE || DEFAULT_CONFIG.resetMode) as 'log-only' | 'full';

  // Load reportOutputDir
  const reportOutputDir = cliArgs.get('report-output-dir') || env.REPORT_OUTPUT_DIR || DEFAULT_CONFIG.reportOutputDir;

  // Load insertBatchSize
  const insertBatchSize = parseInteger(
    cliArgs.get('insert-batch-size') || env.INSERT_BATCH_SIZE,
    DEFAULT_CONFIG.insertBatchSize,
  );

  const config: MigrationConfig = {
    dumpFilePath,
    databaseUrl,
    matchConfidenceThreshold,
    matchMinConsiderationThreshold,
    resetMode,
    reportOutputDir,
    insertBatchSize,
  };

  // Validate configuration (fail-fast)
  validateConfig(config);

  return config;
}
