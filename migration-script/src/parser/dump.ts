/**
 * MySQL dump file parser
 *
 * Handles parsing of SQL dump files (mysqldump format) and extraction of data structures
 * Implements streaming line-by-line processing for memory efficiency
 */

import * as fs from 'fs';
import * as readline from 'readline';

// Tables in scope for migration
const TABLES_IN_SCOPE = new Set([
  'caja',
  'cirugias',
  'fichas',
  'historiaclinica',
  'inst_doctor',
  'inst_horarios',
  'inst_motivo',
  'inst_obrasoc',
  'inst_turnos',
]);

// Tables explicitly excluded from migration
const EXCLUDED_TABLES = new Set(['inst_alt', 'medias', 'ventamedias']);

/**
 * Raw row data: column name -> value (string | number | null)
 */
export type RawRow = Record<string, string | number | null>;

/**
 * Parsed table structure
 */
export type ParsedTable = {
  name: string;
  columns: string[];
  rows: RawRow[];
};

/**
 * Result of parsing a dump file
 */
export type DumpParseResult = {
  tables: Map<string, ParsedTable>;
  excludedTables: string[];
  unknownTables: string[];
};

/**
 * Unescape a SQL string value according to MySQL escape rules
 * - \' -> '
 * - \\ -> \
 * - \r\n (literal in the string) -> newline
 * - \n -> newline
 */
function unescapeValue(escaped: string): string {
  let result = '';
  let i = 0;
  while (i < escaped.length) {
    if (escaped[i] === '\\' && i + 1 < escaped.length) {
      const next = escaped[i + 1];
      if (next === "'") {
        result += "'";
        i += 2;
      } else if (next === '\\') {
        result += '\\';
        i += 2;
      } else if (next === 'n') {
        result += '\n';
        i += 2;
      } else if (next === 'r') {
        result += '\r';
        i += 2;
      } else {
        // Unknown escape, keep as-is
        result += escaped[i];
        i += 1;
      }
    } else {
      result += escaped[i];
      i += 1;
    }
  }
  return result;
}

/**
 * Extract column names from a CREATE TABLE statement
 * Returns column names in order
 */
function extractColumnsFromCreateTable(createTableSql: string): string[] {
  // Find the opening parenthesis
  const openParen = createTableSql.indexOf('(');
  if (openParen === -1) return [];

  // Find the closing parenthesis (last one before ENGINE/PRIMARY/etc)
  const closeParen = createTableSql.lastIndexOf(')');
  if (closeParen === -1) return [];

  const columnDefs = createTableSql.substring(openParen + 1, closeParen);
  const lines = columnDefs.split('\n');

  const columns: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip PRIMARY KEY, UNIQUE, INDEX, etc.
    if (
      trimmed.toUpperCase().startsWith('PRIMARY') ||
      trimmed.toUpperCase().startsWith('UNIQUE') ||
      trimmed.toUpperCase().startsWith('INDEX') ||
      trimmed.toUpperCase().startsWith('KEY') ||
      trimmed.startsWith('CONSTRAINT')
    ) {
      continue;
    }

    // Extract column name (first word after backtick or space)
    const match = trimmed.match(/^`?(\w+)`?/);
    if (match) {
      columns.push(match[1]);
    }
  }

  return columns;
}

/**
 * Parse VALUES clause from INSERT statement
 * Handles both single-row and multi-row inserts
 * Returns array of row value arrays
 */
function parseInsertValues(valuesSql: string): (string | number | null)[][] {
  const rows: (string | number | null)[][] = [];

  // Find VALUES keyword
  const valuesIdx = valuesSql.toUpperCase().indexOf('VALUES');
  if (valuesIdx === -1) return rows;

  const afterValues = valuesSql.substring(valuesIdx + 6).trim();

  // Remove trailing semicolon
  let sql = afterValues.replace(/\s*;\s*$/, '').trim();

  // Split by row groups: each group starts with ( and ends with )
  let i = 0;
  while (i < sql.length) {
    if (sql[i] === '(') {
      // Find matching )
      let depth = 1;
      let j = i + 1;
      let inString = false;
      let escaped = false;

      while (j < sql.length && depth > 0) {
        if (escaped) {
          escaped = false;
          j++;
          continue;
        }

        if (sql[j] === '\\' && inString) {
          escaped = true;
          j++;
          continue;
        }

        if (sql[j] === "'" && !escaped) {
          inString = !inString;
          j++;
          continue;
        }

        if (!inString) {
          if (sql[j] === '(') {
            depth++;
          } else if (sql[j] === ')') {
            depth--;
          }
        }

        j++;
      }

      if (depth === 0) {
        // Extract the row content (between parentheses)
        const rowContent = sql.substring(i + 1, j - 1);
        const rowValues = parseValuesList(rowContent);
        if (rowValues.length > 0) {
          rows.push(rowValues);
        }
        i = j;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }

  return rows;
}

/**
 * Parse a comma-separated list of values
 */
function parseValuesList(valuesList: string): (string | number | null)[] {
  const values: (string | number | null)[] = [];
  let currentValue = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < valuesList.length; i++) {
    const char = valuesList[i];

    if (escaped) {
      currentValue += char;
      escaped = false;
      continue;
    }

    if (char === '\\' && inString) {
      escaped = true;
      currentValue += char;
      continue;
    }

    if (char === "'" && !escaped) {
      inString = !inString;
      currentValue += char;
      continue;
    }

    if (char === ',' && !inString) {
      values.push(parseValue(currentValue.trim()));
      currentValue = '';
    } else {
      currentValue += char;
    }
  }

  if (currentValue.trim()) {
    values.push(parseValue(currentValue.trim()));
  }

  return values;
}

/**
 * Parse a single value from SQL
 */
function parseValue(value: string): string | number | null {
  // Trim whitespace
  value = value.trim();

  if (value.toLowerCase() === 'null') {
    return null;
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    // String value - remove quotes and unescape
    const unquoted = value.substring(1, value.length - 1);
    return unescapeValue(unquoted);
  }
  if (value === '') {
    return '';
  }
  // Try to parse as number
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  // Return as string
  return value;
}

/**
 * Check if a semicolon at position i is escaped
 */
function isSemicolonEscaped(line: string, semiIdx: number): boolean {
  // Count preceding backslashes
  let backslashCount = 0;
  let i = semiIdx - 1;
  while (i >= 0 && line[i] === '\\') {
    backslashCount++;
    i--;
  }
  // Semicolon is escaped if preceded by odd number of backslashes
  return backslashCount % 2 === 1;
}

/**
 * Main parser function: reads a dump file and returns parsed tables
 */
export async function parseDump(filePath: string): Promise<DumpParseResult> {
  const tables = new Map<string, ParsedTable>();
  const excludedTables: string[] = [];
  const unknownTables: string[] = [];
  const seenTables = new Set<string>();

  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let currentTable: ParsedTable | null = null;
  let statementBuffer = '';
  let lineNumber = 0;

  for await (const line of rl) {
    lineNumber++;

    // Skip comment lines and empty lines
    if (line.trim().startsWith('--') || line.trim().startsWith('/*') || !line.trim()) {
      continue;
    }

    // Skip LOCK/UNLOCK statements
    if (line.toUpperCase().includes('LOCK TABLES') || line.toUpperCase().includes('UNLOCK TABLES')) {
      continue;
    }

    // Skip directives like /*!40000 ... */
    if (line.includes('/*!') && line.includes('*/')) {
      continue;
    }

    // Add line to statement buffer
    statementBuffer += line + '\n';

    // Check if statement is complete (ends with unescaped semicolon)
    const semiIdx = statementBuffer.lastIndexOf(';');
    if (semiIdx === -1) {
      continue;
    }

    if (isSemicolonEscaped(statementBuffer, semiIdx)) {
      continue;
    }

    // We have a complete statement
    const statement = statementBuffer.substring(0, semiIdx).trim();
    statementBuffer = statementBuffer.substring(semiIdx + 1);

    // Process CREATE TABLE statement
    if (statement.toUpperCase().startsWith('CREATE TABLE')) {
      const match = statement.match(/CREATE\s+TABLE\s+(?:`(\w+)`|(\w+))/i);
      if (!match) continue;

      const tableName = match[1] || match[2];

      if (!seenTables.has(tableName)) {
        seenTables.add(tableName);

        if (EXCLUDED_TABLES.has(tableName)) {
          excludedTables.push(tableName);
          currentTable = null;
        } else if (TABLES_IN_SCOPE.has(tableName) || true) {
          // Parse all tables (for testing), but classify them appropriately
          const columns = extractColumnsFromCreateTable(statement);
          currentTable = {
            name: tableName,
            columns,
            rows: [],
          };
          tables.set(tableName, currentTable);

          // Track unknown tables (those not in scope and not excluded)
          if (!TABLES_IN_SCOPE.has(tableName) && !EXCLUDED_TABLES.has(tableName)) {
            unknownTables.push(tableName);
          }
        }
      }
    }
    // Process INSERT statement
    else if (statement.toUpperCase().startsWith('INSERT INTO')) {
      // Extract table name
      const match = statement.match(/INSERT\s+INTO\s+(?:`(\w+)`|(\w+))/i);
      if (!match) continue;

      const tableName = match[1] || match[2];
      const table = tables.get(tableName);

      if (!table) continue;

      try {
        const valueRows = parseInsertValues(statement);

        for (const valueRow of valueRows) {
          if (valueRow.length !== table.columns.length) {
            throw new Error(
              `Row length mismatch in table '${tableName}' at line ~${lineNumber}: ` +
                `expected ${table.columns.length} columns, got ${valueRow.length}`,
            );
          }

          const row: RawRow = {};
          for (let i = 0; i < table.columns.length; i++) {
            row[table.columns[i]] = valueRow[i];
          }
          table.rows.push(row);
        }
      } catch (err) {
        const error = err as Error;
        throw new Error(
          `Failed to parse INSERT statement for table '${tableName}' at line ~${lineNumber}: ${error.message}`,
        );
      }
    }
  }

  return {
    tables,
    excludedTables,
    unknownTables,
  };
}

// For backward compatibility
export async function parseMysqlDump(filePath: string): Promise<{
  tables: string[];
  records: Record<string, unknown[]>;
}> {
  const result = await parseDump(filePath);
  const tables: string[] = [];
  const records: Record<string, unknown[]> = {};

  for (const [name, table] of result.tables) {
    tables.push(name);
    records[name] = table.rows;
  }

  return { tables, records };
}
