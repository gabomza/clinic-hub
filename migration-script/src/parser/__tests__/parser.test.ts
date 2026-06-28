import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parseDump, DumpParseResult, RawRow } from '../index';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Helper function to create a temporary dump file and parse it
 */
async function parseDumpFixture(content: string): Promise<DumpParseResult> {
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `test-dump-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);

  try {
    fs.writeFileSync(tmpFile, content, 'utf8');
    const result = await parseDump(tmpFile);
    return result;
  } finally {
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  }
}

describe('DumpParser', () => {
  describe('basic parsing', () => {
    it('should parse a simple CREATE TABLE and INSERT statement', async () => {
      const fixture = `
        CREATE TABLE fichas (
          idFicha int(11) NOT NULL,
          apellido varchar(60),
          nombre varchar(60),
          PRIMARY KEY (idFicha)
        ) ENGINE=MyISAM;

        INSERT INTO fichas VALUES (1, 'SMITH', 'JOHN');
      `;

      const result = await parseDumpFixture(fixture);

      expect(result.tables.has('fichas')).toBe(true);
      const table = result.tables.get('fichas')!;
      expect(table.columns).toEqual(['idFicha', 'apellido', 'nombre']);
      expect(table.rows).toHaveLength(1);
      expect(table.rows[0]).toEqual({
        idFicha: 1,
        apellido: 'SMITH',
        nombre: 'JOHN',
      });
    });

    it('should preserve column order from CREATE TABLE', async () => {
      const fixture = `
        CREATE TABLE test (
          col_c varchar(10),
          col_a varchar(10),
          col_b varchar(10),
          PRIMARY KEY (col_c)
        ) ENGINE=MyISAM;

        INSERT INTO test VALUES ('C', 'A', 'B');
      `;

      const result = await parseDumpFixture(fixture);
      const table = result.tables.get('test')!;
      expect(table.columns).toEqual(['col_c', 'col_a', 'col_b']);
    });
  });

  describe('escaped quotes handling', () => {
    it('should handle escaped single quotes in values', async () => {
      const fixture = `
        CREATE TABLE fichas (
          idFicha int(11),
          nombre varchar(60),
          PRIMARY KEY (idFicha)
        ) ENGINE=MyISAM;

        INSERT INTO fichas VALUES (1, 'O\\'Brien');
      `;

      const result = await parseDumpFixture(fixture);
      const row = result.tables.get('fichas')!.rows[0];
      expect(row.nombre).toBe("O'Brien");
    });

    it('should handle escaped quotes in historical data', async () => {
      const fixture = `
        CREATE TABLE historiaclinica (
          idHistoriaClinica int(11),
          datos text,
          PRIMARY KEY (idHistoriaClinica)
        ) ENGINE=MyISAM;

        INSERT INTO historiaclinica VALUES (1, 'EN\\'99-CONTROL');
      `;

      const result = await parseDumpFixture(fixture);
      const row = result.tables.get('historiaclinica')!.rows[0];
      expect(row.datos).toBe("EN'99-CONTROL");
    });
  });

  describe('embedded newlines and special characters', () => {
    it('should handle \\r\\n embedded in values', async () => {
      const fixture = `
        CREATE TABLE fichas (
          idFicha int(11),
          diagnostico varchar(255),
          PRIMARY KEY (idFicha)
        ) ENGINE=MyISAM;

        INSERT INTO fichas VALUES (1, 'LINE1\\r\\nLINE2');
      `;

      const result = await parseDumpFixture(fixture);
      const row = result.tables.get('fichas')!.rows[0];
      // Should be interpreted as carriage return and newline
      expect(row.diagnostico).toContain('\r');
      expect(row.diagnostico).toContain('\n');
    });

    it('should handle \\n embedded in text fields', async () => {
      const fixture = `
        CREATE TABLE historiaclinica (
          idHistoriaClinica int(11),
          datos text,
          PRIMARY KEY (idHistoriaClinica)
        ) ENGINE=MyISAM;

        INSERT INTO historiaclinica VALUES (1, 'FIRST LINE\\nSECOND LINE<br>');
      `;

      const result = await parseDumpFixture(fixture);
      const row = result.tables.get('historiaclinica')!.rows[0];
      expect(row.datos).toContain('\n');
      expect(row.datos).toContain('<br>');
    });

    it('should preserve text with actual newlines and <br> tags', async () => {
      const fixture = `
        CREATE TABLE historiaclinica (
          idHistoriaClinica int(11),
          datos text,
          PRIMARY KEY (idHistoriaClinica)
        ) ENGINE=MyISAM;

        INSERT INTO historiaclinica VALUES (1, 'EMISION CONTROL\\n<br>');
      `;

      const result = await parseDumpFixture(fixture);
      const row = result.tables.get('historiaclinica')!.rows[0];
      expect(row.datos).toContain('EMISION CONTROL');
      expect(row.datos).toContain('<br>');
    });
  });

  describe('NULL values', () => {
    it('should parse NULL values correctly', async () => {
      const fixture = `
        CREATE TABLE fichas (
          idFicha int(11),
          apellido varchar(60),
          nombre varchar(60),
          PRIMARY KEY (idFicha)
        ) ENGINE=MyISAM;

        INSERT INTO fichas VALUES (1, NULL, 'JOHN');
        INSERT INTO fichas VALUES (2, 'SMITH', NULL);
      `;

      const result = await parseDumpFixture(fixture);
      const rows = result.tables.get('fichas')!.rows;
      expect(rows[0].apellido).toBeNull();
      expect(rows[0].nombre).toBe('JOHN');
      expect(rows[1].apellido).toBe('SMITH');
      expect(rows[1].nombre).toBeNull();
    });

    it('should handle mixed NULL and quoted values', async () => {
      const fixture = `
        CREATE TABLE test (
          id int(11),
          col1 varchar(10),
          col2 varchar(10),
          col3 varchar(10),
          PRIMARY KEY (id)
        ) ENGINE=MyISAM;

        INSERT INTO test VALUES (1, 'A', NULL, 'B');
      `;

      const result = await parseDumpFixture(fixture);
      const row = result.tables.get('test')!.rows[0];
      expect(row.col1).toBe('A');
      expect(row.col2).toBeNull();
      expect(row.col3).toBe('B');
    });
  });

  describe('numeric values without quotes', () => {
    it('should parse numeric values correctly', async () => {
      const fixture = `
        CREATE TABLE fichas (
          idFicha int(11),
          edad int(11),
          valor decimal(10,2),
          PRIMARY KEY (idFicha)
        ) ENGINE=MyISAM;

        INSERT INTO fichas VALUES (1, 42, 123.45);
      `;

      const result = await parseDumpFixture(fixture);
      const row = result.tables.get('fichas')!.rows[0];
      expect(row.idFicha).toBe(1);
      expect(row.edad).toBe(42);
      expect(row.valor).toBe(123.45);
    });

    it('should handle negative numbers', async () => {
      const fixture = `
        CREATE TABLE test (
          id int(11),
          value int(11),
          PRIMARY KEY (id)
        ) ENGINE=MyISAM;

        INSERT INTO test VALUES (1, -42);
      `;

      const result = await parseDumpFixture(fixture);
      const row = result.tables.get('test')!.rows[0];
      expect(row.value).toBe(-42);
    });

    it('should distinguish zero from empty string', async () => {
      const fixture = `
        CREATE TABLE test (
          id int(11),
          num_col int(11),
          str_col varchar(10),
          PRIMARY KEY (id)
        ) ENGINE=MyISAM;

        INSERT INTO test VALUES (1, 0, '');
      `;

      const result = await parseDumpFixture(fixture);
      const row = result.tables.get('test')!.rows[0];
      expect(row.num_col).toBe(0);
      expect(row.str_col).toBe('');
    });
  });

  describe('multi-row INSERT statements', () => {
    it('should parse multi-row VALUES correctly', async () => {
      const fixture = `
        CREATE TABLE fichas (
          idFicha int(11),
          apellido varchar(60),
          PRIMARY KEY (idFicha)
        ) ENGINE=MyISAM;

        INSERT INTO fichas VALUES (1, 'SMITH'), (2, 'JOHNSON'), (3, 'WILLIAMS');
      `;

      const result = await parseDumpFixture(fixture);
      const rows = result.tables.get('fichas')!.rows;
      expect(rows).toHaveLength(3);
      expect(rows[0]).toEqual({ idFicha: 1, apellido: 'SMITH' });
      expect(rows[1]).toEqual({ idFicha: 2, apellido: 'JOHNSON' });
      expect(rows[2]).toEqual({ idFicha: 3, apellido: 'WILLIAMS' });
    });

    it('should handle multi-row with mixed types', async () => {
      const fixture = `
        CREATE TABLE test (
          id int(11),
          name varchar(20),
          count int(11),
          PRIMARY KEY (id)
        ) ENGINE=MyISAM;

        INSERT INTO test VALUES (1, 'A', 10), (2, 'B', NULL), (3, NULL, 30);
      `;

      const result = await parseDumpFixture(fixture);
      const rows = result.tables.get('test')!.rows;
      expect(rows).toHaveLength(3);
      expect(rows[1].count).toBeNull();
      expect(rows[2].name).toBeNull();
    });

    it('should handle many rows in single INSERT', async () => {
      const fixture = `
        CREATE TABLE test (
          id int(11),
          val varchar(10),
          PRIMARY KEY (id)
        ) ENGINE=MyISAM;

        INSERT INTO test VALUES
          (1, 'a'), (2, 'b'), (3, 'c'), (4, 'd'), (5, 'e'),
          (6, 'f'), (7, 'g'), (8, 'h'), (9, 'i'), (10, 'j');
      `;

      const result = await parseDumpFixture(fixture);
      const rows = result.tables.get('test')!.rows;
      expect(rows).toHaveLength(10);
      expect(rows[0].val).toBe('a');
      expect(rows[9].val).toBe('j');
    });
  });

  describe('directives and special SQL syntax', () => {
    it('should ignore /*!...*/ directives', async () => {
      const fixture = `
        /*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;

        CREATE TABLE fichas (
          idFicha int(11),
          nombre varchar(60),
          PRIMARY KEY (idFicha)
        ) ENGINE=MyISAM;

        /*!40000 ALTER TABLE fichas DISABLE KEYS */;
        INSERT INTO fichas VALUES (1, 'JOHN');
        /*!40000 ALTER TABLE fichas ENABLE KEYS */;
      `;

      const result = await parseDumpFixture(fixture);
      expect(result.tables.has('fichas')).toBe(true);
      expect(result.tables.get('fichas')!.rows).toHaveLength(1);
    });

    it('should ignore LOCK/UNLOCK TABLES statements', async () => {
      const fixture = `
        CREATE TABLE fichas (
          idFicha int(11),
          nombre varchar(60),
          PRIMARY KEY (idFicha)
        ) ENGINE=MyISAM;

        LOCK TABLES fichas WRITE;
        INSERT INTO fichas VALUES (1, 'JOHN');
        UNLOCK TABLES;
      `;

      const result = await parseDumpFixture(fixture);
      expect(result.tables.get('fichas')!.rows).toHaveLength(1);
    });

    it('should ignore comment lines', async () => {
      const fixture = `
        -- This is a comment
        CREATE TABLE fichas (
          idFicha int(11),
          nombre varchar(60),
          PRIMARY KEY (idFicha)
        ) ENGINE=MyISAM;

        -- Another comment
        INSERT INTO fichas VALUES (1, 'JOHN');
      `;

      const result = await parseDumpFixture(fixture);
      expect(result.tables.get('fichas')!.rows).toHaveLength(1);
    });
  });

  describe('table classification', () => {
    it('should classify tables in scope correctly', async () => {
      const fixture = `
        CREATE TABLE fichas (idFicha int(11), PRIMARY KEY (idFicha)) ENGINE=MyISAM;
        INSERT INTO fichas VALUES (1);

        CREATE TABLE caja (idCaja int(11), PRIMARY KEY (idCaja)) ENGINE=MyISAM;
        INSERT INTO caja VALUES (1);

        CREATE TABLE inst_doctor (inst_id int(11), PRIMARY KEY (inst_id)) ENGINE=MyISAM;
        INSERT INTO inst_doctor VALUES (1);
      `;

      const result = await parseDumpFixture(fixture);
      expect(result.tables.has('fichas')).toBe(true);
      expect(result.tables.has('caja')).toBe(true);
      expect(result.tables.has('inst_doctor')).toBe(true);
    });

    it('should classify excluded tables correctly', async () => {
      const fixture = `
        CREATE TABLE inst_alt (Alt_id int(11), PRIMARY KEY (Alt_id)) ENGINE=MyISAM;
        CREATE TABLE medias (id int(11), PRIMARY KEY (id)) ENGINE=MyISAM;
        CREATE TABLE ventamedias (id int(11), PRIMARY KEY (id)) ENGINE=MyISAM;
      `;

      const result = await parseDumpFixture(fixture);
      expect(result.excludedTables).toContain('inst_alt');
      expect(result.excludedTables).toContain('medias');
      expect(result.excludedTables).toContain('ventamedias');
      expect(result.tables.has('inst_alt')).toBe(false);
    });

    it('should classify unknown tables correctly', async () => {
      const fixture = `
        CREATE TABLE unknown_table (id int(11), PRIMARY KEY (id)) ENGINE=MyISAM;
        CREATE TABLE another_unknown (id int(11), PRIMARY KEY (id)) ENGINE=MyISAM;
      `;

      const result = await parseDumpFixture(fixture);
      expect(result.unknownTables).toContain('unknown_table');
      expect(result.unknownTables).toContain('another_unknown');
    });

    it('should not duplicate tables in multiple classifications', async () => {
      const fixture = `
        CREATE TABLE fichas (idFicha int(11), PRIMARY KEY (idFicha)) ENGINE=MyISAM;
        INSERT INTO fichas VALUES (1);
      `;

      const result = await parseDumpFixture(fixture);
      expect(result.tables.has('fichas')).toBe(true);
      expect(result.excludedTables).not.toContain('fichas');
      expect(result.unknownTables).not.toContain('fichas');
    });
  });

  describe('malformed input error handling', () => {
    it('should throw error when column count does not match', async () => {
      const fixture = `
        CREATE TABLE fichas (
          idFicha int(11),
          apellido varchar(60),
          PRIMARY KEY (idFicha)
        ) ENGINE=MyISAM;

        INSERT INTO fichas VALUES (1, 'SMITH', 'EXTRA');
      `;

      try {
        await parseDumpFixture(fixture);
        expect.fail('Should have thrown an error');
      } catch (err) {
        const error = err as Error;
        expect(error.message).toContain('Row length mismatch');
        expect(error.message).toContain('fichas');
        expect(error.message).toContain('expected 2 columns, got 3');
      }
    });

    it('should throw error for INSERT with too few columns', async () => {
      const fixture = `
        CREATE TABLE fichas (
          idFicha int(11),
          apellido varchar(60),
          nombre varchar(60),
          PRIMARY KEY (idFicha)
        ) ENGINE=MyISAM;

        INSERT INTO fichas VALUES (1, 'SMITH');
      `;

      try {
        await parseDumpFixture(fixture);
        expect.fail('Should have thrown an error');
      } catch (err) {
        const error = err as Error;
        expect(error.message).toContain('Row length mismatch');
        expect(error.message).toContain('expected 3 columns, got 2');
      }
    });

    it('should provide approximate line number in error messages', async () => {
      const fixture = `
        -- Line 1
        -- Line 2
        CREATE TABLE fichas (idFicha int(11), PRIMARY KEY (idFicha)) ENGINE=MyISAM;
        -- Line 4
        -- Line 5
        INSERT INTO fichas VALUES (1, 'EXTRA');
      `;

      try {
        await parseDumpFixture(fixture);
        expect.fail('Should have thrown an error');
      } catch (err) {
        const error = err as Error;
        expect(error.message).toContain('line');
        expect(error.message).toMatch(/line\s*~?\d+/i);
      }
    });
  });

  describe('complex real-world scenarios', () => {
    it('should handle historiaclinica with embedded text and newlines', async () => {
      const fixture = `
        CREATE TABLE historiaclinica (
          idHistoriaClinica int(11),
          fechaConsulta date,
          datos text,
          PRIMARY KEY (idHistoriaClinica, fechaConsulta)
        ) ENGINE=MyISAM;

        INSERT INTO historiaclinica VALUES
          (2, '1993-03-18', 'EN 4.89:S.I. + EMI BIL.BUENA EVOL. 11.90:EMI BIL.4.92:EMI MII. HARA 3\\r\\nEMI EN MII.  25.3: EMI CPPI. PROXIMA HACER ULTRASON.X MANCHAS PIERNA<br>');
      `;

      const result = await parseDumpFixture(fixture);
      const table = result.tables.get('historiaclinica')!;
      expect(table.rows).toHaveLength(1);
      const row = table.rows[0];
      expect(row.idHistoriaClinica).toBe(2);
      expect(row.fechaConsulta).toBe('1993-03-18');
      expect(row.datos).toContain('EMI EN MII');
      expect(row.datos).toContain('<br>');
    });

    it('should handle cirugias with escaped quotes', async () => {
      const fixture = `
        CREATE TABLE cirugias (
          id_cirugia int(11),
          apellido varchar(255),
          nombre varchar(255),
          datos text,
          PRIMARY KEY (id_cirugia)
        ) ENGINE=MyISAM;

        INSERT INTO cirugias VALUES (1, 'AGOSTINI', 'ESTHER DE', 'Notas en\\'99-control');
      `;

      const result = await parseDumpFixture(fixture);
      const row = result.tables.get('cirugias')!.rows[0];
      expect(row.nombre).toBe('ESTHER DE');
      expect(row.datos).toBe("Notas en'99-control");
    });

    it('should handle fichas with sentinel date values', async () => {
      const fixture = `
        CREATE TABLE fichas (
          idFicha int(11),
          apellido varchar(60),
          fechaNac date,
          primerConsulta date,
          PRIMARY KEY (idFicha)
        ) ENGINE=MyISAM;

        INSERT INTO fichas VALUES (1, 'SMITH', '0000-00-00', '1993-04-15');
        INSERT INTO fichas VALUES (2, 'JONES', '1952-09-06', '0000-00-00');
      `;

      const result = await parseDumpFixture(fixture);
      const rows = result.tables.get('fichas')!.rows;
      expect(rows[0].fechaNac).toBe('0000-00-00');
      expect(rows[0].primerConsulta).toBe('1993-04-15');
      expect(rows[1].fechaNac).toBe('1952-09-06');
      expect(rows[1].primerConsulta).toBe('0000-00-00');
    });
  });

  describe('data type correctness', () => {
    it('should preserve string types even for numeric-looking strings', async () => {
      const fixture = `
        CREATE TABLE fichas (
          idFicha int(11),
          nroObraSocial varchar(60),
          codigo varchar(20),
          PRIMARY KEY (idFicha)
        ) ENGINE=MyISAM;

        INSERT INTO fichas VALUES (1, '1305266797-01', '0123');
      `;

      const result = await parseDumpFixture(fixture);
      const row = result.tables.get('fichas')!.rows[0];
      expect(row.nroObraSocial).toBe('1305266797-01');
      expect(row.codigo).toBe('0123');
    });

    it('should handle empty strings differently from NULL', async () => {
      const fixture = `
        CREATE TABLE fichas (
          idFicha int(11),
          campo1 varchar(60),
          campo2 varchar(60),
          PRIMARY KEY (idFicha)
        ) ENGINE=MyISAM;

        INSERT INTO fichas VALUES (1, '', NULL);
      `;

      const result = await parseDumpFixture(fixture);
      const row = result.tables.get('fichas')!.rows[0];
      expect(row.campo1).toBe('');
      expect(row.campo1).not.toBeNull();
      expect(row.campo2).toBeNull();
    });
  });

  describe('multiple tables in single dump', () => {
    it('should parse multiple in-scope tables correctly', async () => {
      const fixture = `
        CREATE TABLE caja (idCaja int(11), PRIMARY KEY (idCaja)) ENGINE=MyISAM;
        INSERT INTO caja VALUES (1);

        CREATE TABLE fichas (idFicha int(11), PRIMARY KEY (idFicha)) ENGINE=MyISAM;
        INSERT INTO fichas VALUES (100);

        CREATE TABLE cirugias (id_cirugia int(11), PRIMARY KEY (id_cirugia)) ENGINE=MyISAM;
        INSERT INTO cirugias VALUES (50);
      `;

      const result = await parseDumpFixture(fixture);
      expect(result.tables.size).toBe(3);
      expect(result.tables.get('caja')!.rows[0].idCaja).toBe(1);
      expect(result.tables.get('fichas')!.rows[0].idFicha).toBe(100);
      expect(result.tables.get('cirugias')!.rows[0].id_cirugia).toBe(50);
    });

    it('should skip excluded tables in multi-table dump', async () => {
      const fixture = `
        CREATE TABLE fichas (idFicha int(11), PRIMARY KEY (idFicha)) ENGINE=MyISAM;
        INSERT INTO fichas VALUES (1);

        CREATE TABLE inst_alt (Alt_id int(11), PRIMARY KEY (Alt_id)) ENGINE=MyISAM;
        INSERT INTO inst_alt VALUES (999);

        CREATE TABLE caja (idCaja int(11), PRIMARY KEY (idCaja)) ENGINE=MyISAM;
        INSERT INTO caja VALUES (2);
      `;

      const result = await parseDumpFixture(fixture);
      expect(result.tables.has('fichas')).toBe(true);
      expect(result.tables.has('inst_alt')).toBe(false);
      expect(result.tables.has('caja')).toBe(true);
      expect(result.excludedTables).toContain('inst_alt');
    });
  });

  describe('utf8 and special characters', () => {
    it('should preserve UTF-8 characters (tildes, ñ, etc)', async () => {
      const fixture = `
        CREATE TABLE fichas (
          idFicha int(11),
          apellido varchar(60),
          PRIMARY KEY (idFicha)
        ) ENGINE=MyISAM;

        INSERT INTO fichas VALUES (1, 'PEÑA');
        INSERT INTO fichas VALUES (2, 'GARCÍA');
        INSERT INTO fichas VALUES (3, 'MÉXICO');
      `;

      const result = await parseDumpFixture(fixture);
      const rows = result.tables.get('fichas')!.rows;
      expect(rows[0].apellido).toBe('PEÑA');
      expect(rows[1].apellido).toBe('GARCÍA');
      expect(rows[2].apellido).toBe('MÉXICO');
    });
  });
});
