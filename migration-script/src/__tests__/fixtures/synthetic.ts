/**
 * Synthetic Volume Fixture Generator
 *
 * Generates realistic synthetic MySQL dump data with 10x volume compared to sample_dump.sql
 * for testing parser performance and migration batching capabilities.
 *
 * Volume targets (10x multiplier):
 * - fichas: ~500 rows
 * - inst_turnos: ~200 rows
 * - cirugias: ~100 rows
 * - historiaclinica: ~300 rows
 * - caja: ~400 rows
 * - Reference tables (inst_doctor, inst_obrasoc, inst_motivo, inst_horarios): seeds unchanged
 *
 * Uses multi-row INSERT syntax to generate realistic dump format.
 * Data is generated with realistic variations in names, dates, and amounts.
 */

// Spanish names and surnames commonly found in Argentina
const SURNAMES = [
  'García', 'López', 'González', 'Rodríguez', 'Martínez',
  'Pérez', 'Sánchez', 'Ramírez', 'Torres', 'Flores',
  'Rivera', 'Cruz', 'Morales', 'Gutierrez', 'Ortiz',
  'Jiménez', 'Méndez', 'Vázquez', 'Ruiz', 'Castro',
  'Silva', 'Vargas', 'Reyes', 'Díaz', 'Acosta',
  'Álvarez', 'Campos', 'Navarro', 'Ramos', 'Fuentes',
  'Córdoba', 'Fernández', 'Herrera', 'Iglesias', 'Jara',
  'Knobel', 'Lara', 'Medina', 'Nichols', 'Ortega',
  'Páez', 'Quintana', 'Rossi', 'Saavedra', 'Tejada',
  'Ureta', 'Vega', 'Walthery', 'Yáñez', 'Zamora',
  'Amadei', 'Benedetti', 'Cappello', 'D\'Angelo', 'Esposito',
  'Fontana', 'Garibaldi', 'Hoffmann', 'Innella', 'Jarpa',
];

const FIRST_NAMES_MALE = [
  'Juan', 'Carlos', 'José', 'Luis', 'Miguel',
  'Antonio', 'Francisco', 'Pedro', 'Vicente', 'Manuel',
  'Sergio', 'Roberto', 'Ricardo', 'Eduardo', 'Fernando',
  'Daniel', 'Héctor', 'Andrés', 'Raúl', 'Marcos',
  'Gonzalo', 'Rodrigo', 'Javier', 'Pablo', 'Alejandro',
];

const FIRST_NAMES_FEMALE = [
  'María', 'Rosa', 'Carmen', 'Juana', 'Magdalena',
  'Teresa', 'Francisca', 'Petronila', 'Encarnación', 'Soledad',
  'Esperanza', 'Paz', 'Amparo', 'Delicias', 'Consuelo',
  'Ángela', 'Elvira', 'Gloria', 'Josefina', 'Margarita',
  'Antonia', 'Benita', 'Catalina', 'Dolores', 'Enriqueta',
  'Filomena', 'Georgina', 'Hilaria', 'Irene', 'Juana',
  'Kangenia', 'Lupita', 'Manuela', 'Natalia', 'Olivia',
];

const ADDRESSES_PARTS = [
  'Avenida San Martín',
  'Calle Roca',
  'Ruta Nacional 40',
  'Avenida Libertador',
  'Calle Gutiérrez',
  'Avenida Mitre',
  'Calle Rivadavia',
  'Avenida Colón',
  'Calle Garibaldi',
  'Avenida Belgrano',
  'Calle Tucumán',
  'Avenida O\'Higgins',
  'Calle Maipú',
  'Avenida Sarmiento',
  'Calle España',
];

const DEPARTMENTS = [
  'CAPITAL', 'GODOY CRUZ', 'GUAYMALLEN', 'LAS HERAS',
  'DORREGO', 'LUJAN DE CUYO', 'MAIPÚ', 'RIVADAVIA',
];

const PROVINCES = [
  'MENDOZA', 'BUENOS AIRES', 'CÓRDOBA', 'SANTA FE',
];

const HEALTH_INSURANCES = [
  'OSEP', 'OSDE', 'CIMESA', 'EMSE', 'IOS',
  'PARTICULAR', 'SANS', 'MEDIFÉ', 'ACIBER', 'COSIFER',
];

const VISIT_REASONS = [
  'Consulta general',
  'Seguimiento postoperatorio',
  'Evaluación vascular',
  'Revisión de herida',
  'Estudio complementario',
];

const DIAGNOSES = [
  'I.V.S.',
  'I.V.P.C.',
  'VARICES',
  'ÚLCERA VARICOSA',
  'EDEMA',
  'LINFEDEMA',
  'TELANGIECTASIA',
];

const BODY_PARTS = [
  'M.I.D.',
  'M.I.I.',
  'M.S.D.',
  'M.S.I.',
  'PIERNA DERECHA',
  'PIERNA IZQUIERDA',
  'BRAZO DERECHO',
  'BRAZO IZQUIERDO',
];

const TECHNIQUES = [
  'S.I.',
  'EMI',
  'REEX.CAY',
  'SHERMAN',
  'LINTON',
  'COCKETT',
  'PHLEBOEXTRACCIÓN',
  'ESCLEROTERAPIA',
];

const SURGICAL_OUTCOMES = [
  'BUENA',
  'ACEPTABLE',
  'COMPLICACIÓN',
  'NECROSIS',
  'INFECCIÓN',
  'RECURRENCIA',
];

const CONCEPT_DESCRIPTIONS = [
  'saldo anterior',
  'consulta médica',
  'procedimiento quirúrgico',
  'material médico',
  'pago de personal',
  'servicios varios',
  'insumos clínicos',
];

// Helper: Generate random element from array
function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Helper: Generate random integer between min and max (inclusive)
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Helper: Generate random date in a range
function randomDate(startYear: number, endYear: number): string {
  const year = randomInt(startYear, endYear);
  const month = String(randomInt(1, 12)).padStart(2, '0');
  const day = String(randomInt(1, 28)).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Helper: Format currency (decimal with comma)
function formatCurrency(amount: number): string {
  return amount.toFixed(2).replace('.', ',');
}

// Helper: Escape SQL string values
function escapeSqlString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * Generate realistic patient data (fichas) in multi-row INSERT format
 * Total: ~500 rows (10x sample dump which has ~50)
 */
function generateFichasData(count: number): string {
  const rows: string[] = [];

  for (let i = 1; i <= count; i++) {
    const isFemale = Math.random() > 0.5;
    const surname = escapeSqlString(randomElement(SURNAMES));
    const firstName = escapeSqlString(
      isFemale
        ? randomElement(FIRST_NAMES_FEMALE)
        : randomElement(FIRST_NAMES_MALE)
    );

    const idFicha = i;
    const tipoDoc = Math.random() > 0.3 ? 'DN' : '';
    const documento = tipoDoc ? String(randomInt(1000000, 50000000)) : '';
    const address = escapeSqlString(
      `${randomElement(ADDRESSES_PARTS)} ${randomInt(100, 5000)}`
    );
    const department = randomElement(DEPARTMENTS);
    const province = randomElement(PROVINCES);
    const birthDate = randomDate(1930, 1980);
    const gender = isFemale ? 'F' : 'M';
    const healthInsurance = escapeSqlString(randomElement(HEALTH_INSURANCES));
    const insuranceNumber = escapeSqlString(String(randomInt(100000, 99999999)));
    const phone = String(randomInt(2000000, 9999999));
    const email = '';
    const postalCode = String(randomInt(5000, 5999));
    const maritalStatus = randomElement(['S', 'C', 'D', 'V']);
    const doctorId = randomInt(1, 20); // Assuming we have doctors 1-20
    const source = '';
    const workPlace = '';
    const workType = '';
    const spouseWork = '';
    const spouseWorkType = '';
    const firstVisit = Math.random() > 0.3 ? randomDate(1990, 2000) : '0000-00-00';
    const lastVisit = Math.random() > 0.2 ? randomDate(2000, 2023) : '0000-00-00';
    const diagnosis = escapeSqlString(
      Math.random() > 0.4 ? randomElement(DIAGNOSES) : 'NO DEFINIDO'
    );
    const visitFee = Math.random() > 0.5 ? String(randomInt(50, 500)) : '0';

    rows.push(
      `(${idFicha},'${tipoDoc}','${documento}','${surname}','${firstName}',` +
      `'${address}','${department}','${province}','${birthDate}','${gender}',` +
      `'${healthInsurance}','${insuranceNumber}','${phone}','${email}','${postalCode}',` +
      `'${maritalStatus}','${doctorId}','${source}','${workPlace}','${workType}',` +
      `'${spouseWork}','${spouseWorkType}','${firstVisit}','${lastVisit}','${diagnosis}','${visitFee}')`
    );
  }

  // Split into chunks of 50 rows per INSERT for realism
  const chunks: string[] = [];
  for (let i = 0; i < rows.length; i += 50) {
    chunks.push(`INSERT INTO fichas VALUES ${rows.slice(i, i + 50).join(', ')};`);
  }

  return chunks.join('\n');
}

/**
 * Generate appointment data (inst_turnos) in multi-row INSERT format
 * Total: ~200 rows (10x sample dump which has ~20)
 */
function generateTurnosData(count: number): string {
  const rows: string[] = [];

  for (let i = 1; i <= count; i++) {
    const surname = escapeSqlString(randomElement(SURNAMES));
    const doctorId = randomInt(1, 20);
    const visitReasonId = randomInt(1, 5);
    const date = randomDate(2000, 2023);
    const scheduleId = randomInt(1, 30);
    const insuranceId = randomInt(1, 20);
    const phone = '';
    const status = randomInt(0, 3);

    rows.push(
      `(${i},'${surname}',${doctorId},${visitReasonId},'${date}',` +
      `${scheduleId},${insuranceId},'${phone}',${status})`
    );
  }

  // Split into chunks of 50 rows per INSERT for realism
  const chunks: string[] = [];
  for (let i = 0; i < rows.length; i += 50) {
    chunks.push(`INSERT INTO inst_turnos VALUES ${rows.slice(i, i + 50).join(', ')};`);
  }

  return chunks.join('\n');
}

/**
 * Generate surgery data (cirugias) in multi-row INSERT format
 * Total: ~100 rows (10x sample dump which has ~10)
 */
function generateCirugiasData(count: number): string {
  const rows: string[] = [];

  for (let i = 1; i <= count; i++) {
    const isFemale = Math.random() > 0.5;
    const surname = escapeSqlString(randomElement(SURNAMES));
    const firstName = escapeSqlString(
      isFemale
        ? randomElement(FIRST_NAMES_FEMALE)
        : randomElement(FIRST_NAMES_MALE)
    );

    const age = randomInt(30, 85);
    const address = escapeSqlString(
      `${randomElement(ADDRESSES_PARTS)} ${randomInt(100, 5000)}`
    );
    const date = randomDate(1980, 2023);
    const diagnosis = escapeSqlString(
      Math.random() > 0.2 ? randomElement(DIAGNOSES) : ''
    );
    const bodyPart = escapeSqlString(
      Math.random() > 0.2 ? randomElement(BODY_PARTS) : ''
    );
    const technique1 = escapeSqlString(
      Math.random() > 0.3 ? randomElement(TECHNIQUES) : ''
    );
    const technique2 = escapeSqlString(
      Math.random() > 0.5 ? randomElement(TECHNIQUES) : ''
    );
    const technique3 = escapeSqlString(
      Math.random() > 0.6 ? randomElement(TECHNIQUES) : ''
    );
    const evolution = escapeSqlString(
      Math.random() > 0.2
        ? `${randomElement(SURGICAL_OUTCOMES)} ${randomInt(85, 95)}`
        : ''
    );

    rows.push(
      `(${i},'${surname}','${firstName}',${age},'${address}','${date}',` +
      `'${diagnosis}','${bodyPart}','${technique1}','${technique2}','${technique3}','${evolution}')`
    );
  }

  // Split into chunks of 50 rows per INSERT
  const chunks: string[] = [];
  for (let i = 0; i < rows.length; i += 50) {
    chunks.push(
      `INSERT INTO cirugias VALUES ${rows.slice(i, i + 50).join(', ')};`
    );
  }

  return chunks.join('\n');
}

/**
 * Generate clinical record data (historiaclinica) in multi-row INSERT format
 * Total: ~300 rows (10x sample dump which has ~30)
 */
function generateHistoriaclinicaData(count: number): string {
  const rows: string[] = [];

  const clinicalNotes = [
    'Paciente presenta síntomas de edema en extremidad inferior izquierda.',
    'Se observan varices en ambas extremidades inferiores.',
    'Úlcera varicosa en proceso de cicatrización.',
    'Consulta de seguimiento postoperatorio. Herida bien. Sin signos de infección.',
    'Linfedema en extremidad superior. Se recomienda drenaje linfático.',
    'Paciente refiere dolor en pierna derecha. Se indica estudio vascular.',
    'Teleangiectasia. Se realiza escleroterapia como tratamiento.',
    'Revisión de resultados de ecografía doppler.',
    'Prescripción de medias compresivas. Orientación en cuidados.',
    'Paciente con evolución satisfactoria. Control en 1 mes.',
  ];

  for (let i = 1; i <= count; i++) {
    const patientId = randomInt(1, 500); // Reference to fichas
    const consultDate = randomDate(2000, 2023);
    const notes = escapeSqlString(randomElement(clinicalNotes));
    const docId = randomInt(1, 20);

    rows.push(`(${patientId},'${consultDate}','${notes}',${docId})`);
  }

  // Split into chunks of 50 rows per INSERT
  const chunks: string[] = [];
  for (let i = 0; i < rows.length; i += 50) {
    chunks.push(
      `INSERT INTO historiaclinica VALUES ${rows
        .slice(i, i + 50)
        .join(', ')};`
    );
  }

  return chunks.join('\n');
}

/**
 * Generate cash entry data (caja) in multi-row INSERT format
 * Total: ~400 rows (10x sample dump which has ~40)
 */
function generateCajaData(count: number): string {
  const rows: string[] = [];

  for (let i = 1; i <= count; i++) {
    const date = randomDate(2000, 2023);
    const concept = escapeSqlString(randomElement(CONCEPT_DESCRIPTIONS));
    const isIncome = Math.random() > 0.4;
    const amount = randomInt(50, 3000);

    const income = isIncome ? formatCurrency(amount + Math.random() * 100) : '0,00';
    const expense = !isIncome ? formatCurrency(amount + Math.random() * 100) : '0,00';

    rows.push(`(${i},'${date}','${concept}','${income}','${expense}')`);
  }

  // Split into chunks of 50 rows per INSERT
  const chunks: string[] = [];
  for (let i = 0; i < rows.length; i += 50) {
    chunks.push(`INSERT INTO caja VALUES ${rows.slice(i, i + 50).join(', ')};`);
  }

  return chunks.join('\n');
}

/**
 * Generate the complete synthetic MySQL dump with CREATE TABLE statements and synthetic data
 *
 * @param config Configuration options for volume generation
 * @returns Complete MySQL dump as string
 */
export function generateSyntheticMysqlDump(config?: {
  fichasCount?: number;
  turnosCount?: number;
  cirugiasCount?: number;
  historiaclinicaCount?: number;
  cajaCount?: number;
}): string {
  const fichasCount = config?.fichasCount ?? 500;
  const turnosCount = config?.turnosCount ?? 200;
  const cirugiasCount = config?.cirugiasCount ?? 100;
  const historiaclinicaCount = config?.historiaclinicaCount ?? 300;
  const cajaCount = config?.cajaCount ?? 400;

  const lines: string[] = [
    '-- Synthetic MySQL dump for volume testing',
    '-- Generated for migration script testing',
    '',
    '/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;',
    '/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;',
    '/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;',
    '/*!40101 SET NAMES utf8 */;',
    '',
    '-- Reference Data (from sample_dump.sql)',
    '',
    'CREATE TABLE `inst_doctor` (',
    '  `idProf` int(11) NOT NULL,',
    '  `Profesional` varchar(60) NOT NULL,',
    '  PRIMARY KEY (`idProf`)',
    ') ENGINE=MyISAM;',
    '',
    'INSERT INTO inst_doctor VALUES',
    Array.from({ length: 20 }, (_, i) => {
      const names = [
        'Dr. García',
        'Dr. López',
        'Dra. Martínez',
        'Dr. Rodríguez',
        'Dr. Fernández',
        'Dra. González',
        'Dr. Sánchez',
        'Dr. Pérez',
        'Dra. Ramírez',
        'Dr. Torres',
        'Dr. Silva',
        'Dra. Vega',
        'Dr. Castro',
        'Dr. Ruiz',
        'Dra. Morales',
        'Dr. Díaz',
        'Dr. Jiménez',
        'Dra. Herrera',
        'Dr. Ortiz',
        'Dra. Flores',
      ];
      return `(${i + 1},'${names[i]}')`;
    }).join(',\n')
      .concat(';'),
    '',
    'CREATE TABLE `inst_obrasoc` (',
    '  `idObra` int(11) NOT NULL,',
    '  `obrasocial` varchar(60) NOT NULL,',
    '  PRIMARY KEY (`idObra`)',
    ') ENGINE=MyISAM;',
    '',
    'INSERT INTO inst_obrasoc VALUES',
    `(1,'OSEP'),(2,'OSDE'),(3,'CIMESA'),(4,'EMSE'),(5,'IOS'),`,
    `(6,'SANS'),(7,'MEDIFÉ'),(8,'ACIBER'),(9,'COSIFER'),(10,'OBRA SOCIAL ESTATAL'),`,
    `(11,'PARTICULAR'),(12,'IOMA'),(13,'PAMI'),(14,'IPROSS'),(15,'SANCOR SEGUROS');`,
    '',
    'CREATE TABLE `inst_motivo` (',
    '  `idMotivo` int(11) NOT NULL,',
    '  `Motivo` varchar(100) NOT NULL,',
    '  PRIMARY KEY (`idMotivo`)',
    ') ENGINE=MyISAM;',
    '',
    'INSERT INTO inst_motivo VALUES',
    `(1,'Consulta general'),(2,'Seguimiento postoperatorio'),(3,'Evaluación vascular'),`,
    `(4,'Revisión de herida'),(5,'Estudio complementario');`,
    '',
    'CREATE TABLE `inst_horarios` (',
    '  `Horarios_id` int(11) NOT NULL,',
    '  `Horarios_hora` time NOT NULL,',
    '  `Horarios_estado` int(11) NOT NULL,',
    '  PRIMARY KEY (`Horarios_id`)',
    ') ENGINE=MyISAM;',
    '',
    'INSERT INTO inst_horarios VALUES',
    Array.from({ length: 30 }, (_, i) => {
      const hour = String(Math.floor(8 + (i % 9))).padStart(2, '0');
      const minute = String((i % 2) * 30).padStart(2, '0');
      const estado = Math.floor(i % 3);
      return `(${i + 1},'${hour}:${minute}:00',${estado})`;
    }).join(',\n')
      .concat(';'),
    '',
    '-- Synthetic Data (10x volume)',
    '',
    'CREATE TABLE `fichas` (',
    '  `idFicha` int(11) NOT NULL,',
    '  `tipoDoc` varchar(2),',
    '  `documento` varchar(12),',
    '  `apellido` varchar(60),',
    '  `nombre` varchar(60),',
    '  `domicilio` varchar(255),',
    '  `departamento` varchar(60),',
    '  `provincia` varchar(60),',
    '  `fechaNac` date NOT NULL DEFAULT \'0000-00-00\',',
    '  `sexo` char(1),',
    '  `obraSocial` varchar(60),',
    '  `nroObraSocial` varchar(60),',
    '  `telefono` char(30),',
    '  `eMail` varchar(30),',
    '  `codPostal` varchar(5),',
    '  `estadoCivil` char(1),',
    '  `profesional` varchar(40),',
    '  `fuente` varchar(40),',
    '  `lugarTrabajo` varchar(40),',
    '  `tipoTrabajo` varchar(40),',
    '  `trabajoConyuge` varchar(40),',
    '  `tipoTrabajoConyuge` varchar(40),',
    '  `primerConsulta` date,',
    '  `ultimaConsulta` date,',
    '  `diagnostico` varchar(244),',
    '  `valorConsulta` varchar(6),',
    '  PRIMARY KEY (`idFicha`)',
    ') ENGINE=MyISAM;',
    '',
    generateFichasData(fichasCount),
    '',
    'CREATE TABLE `inst_turnos` (',
    '  `Turno_id` int(11) NOT NULL AUTO_INCREMENT,',
    '  `Turno_paciente` varchar(255),',
    '  `Turno_doctor` int(11),',
    '  `Turno_motivoid` int(11),',
    '  `Turno_fecha` date,',
    '  `Turno_hora` int(11),',
    '  `Turno_obrasocialid` int(11),',
    '  `Turno_telefono` varchar(30),',
    '  `Turno_estado` int(11),',
    '  PRIMARY KEY (`Turno_id`)',
    ') ENGINE=MyISAM;',
    '',
    generateTurnosData(turnosCount),
    '',
    'CREATE TABLE `cirugias` (',
    '  `id_cirugia` int(11) NOT NULL,',
    '  `apellido` varchar(255),',
    '  `nombre` varchar(255),',
    '  `edad` int(11),',
    '  `domicilio` varchar(255),',
    '  `fecha` date,',
    '  `diagnostico` varchar(255),',
    '  `miembro` varchar(255),',
    '  `tecnica1` varchar(255),',
    '  `tecnica2` varchar(255),',
    '  `tecnica3` varchar(255),',
    '  `evolucion` varchar(255),',
    '  PRIMARY KEY (`id_cirugia`)',
    ') ENGINE=MyISAM;',
    '',
    generateCirugiasData(cirugiasCount),
    '',
    'CREATE TABLE `historiaclinica` (',
    '  `idHistoriaClinica` int(11),',
    '  `fechaConsulta` date,',
    '  `datos` longtext,',
    '  `profesionalId` int(11),',
    '  PRIMARY KEY (`idHistoriaClinica`,`fechaConsulta`)',
    ') ENGINE=MyISAM;',
    '',
    generateHistoriaclinicaData(historiaclinicaCount),
    '',
    'CREATE TABLE `caja` (',
    '  `idCaja` int(11) NOT NULL AUTO_INCREMENT,',
    '  `fechaCaja` date NOT NULL,',
    '  `conceptoCaja` varchar(100),',
    '  `ingresosCaja` varchar(10),',
    '  `egresosCaja` varchar(10),',
    '  PRIMARY KEY (`idCaja`)',
    ') ENGINE=MyISAM;',
    '',
    generateCajaData(cajaCount),
    '',
    '/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;',
    '/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;',
    '/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;',
  ];

  return lines.join('\n');
}
