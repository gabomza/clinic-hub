# Requirements Document

## Introduction

Este documento define los requisitos del script de migración de datos que traslada la información de la base de datos legacy MySQL "instituto" (PHP, motor MyISAM, sin foreign keys declaradas) hacia la nueva base de datos PostgreSQL en Supabase, cuyo esquema ya fue diseñado y aprobado (`schema.sql`, documentado en `docs/sdd.md` secciones 4 y 5).

El script es una herramienta de migración de datos, ejecutada una vez (o re-ejecutable de forma controlada), independiente de la aplicación Next.js. No forma parte de la UI ni de los flujos de la aplicación en producción. Su responsabilidad es leer el dump legacy, transformar los datos según las reglas ya acordadas, resolver las referencias de pacientes que en el sistema legacy se almacenaban como texto libre, cargar los datos en el nuevo esquema, y producir evidencia auditable de lo que hizo.

El mapeo de tablas legacy → nuevas, y las transformaciones de datos involucradas, ya fueron decididos y documentados en `docs/sdd.md` (secciones 4 y 5); este documento toma esas decisiones como entrada fija y las traduce a criterios de aceptación verificables. El punto más delicado y menos resuelto —y por lo tanto el que recibe el tratamiento más detallado en este documento— es la vinculación de pacientes para los registros de `cirugias` e `inst_turnos`, donde el paciente está identificado únicamente por texto libre y no por una clave foránea.

Una restricción explícita de este proyecto es que, al momento de escribir este documento, solo se dispone de `sample_dump.sql` (una muestra reducida de filas por tabla). El dump completo de producción se entregará más adelante. El script debe diseñarse y construirse para funcionar correctamente contra la muestra disponible hoy, y debe quedar preparado para ser validado y ajustado cuando llegue el dump real, sin que ese ajuste futuro implique un rediseño.

Fuera de alcance: cualquier requisito de interfaz de usuario, de la aplicación Next.js, o de tablas explícitamente ignoradas (`inst_alt`, `medias`, `ventamedias`).

## Requirements

### Requirement 1: Migración de tablas de referencia (lookup tables ya seedeadas)

**User Story:** Como responsable de la migración, quiero que el script migre los datos completos de doctores, obras sociales, motivos de consulta y horarios desde el dump legacy, para asegurar que ningún registro adicional presente en el dump completo de producción quede fuera, aun cuando estas tablas ya tengan datos de muestra cargados manualmente en el nuevo esquema.

#### Acceptance Criteria

1. WHEN el script procesa la tabla `inst_doctor` THEN el sistema SHALL insertar en `doctors` cualquier doctor presente en el dump que no exista todavía en la tabla destino, preservando el resto de los doctores ya seedeados.
2. WHEN el script procesa la tabla `inst_obrasoc` THEN el sistema SHALL insertar en `health_insurances` cualquier obra social presente en el dump que no exista todavía en la tabla destino.
3. WHEN el script procesa la tabla `inst_motivo` THEN el sistema SHALL insertar en `visit_reasons` cualquier motivo de consulta presente en el dump que no exista todavía en la tabla destino.
4. WHEN el script procesa la tabla `inst_horarios` THEN el sistema SHALL verificar que cada fila del dump tenga una correspondencia en `schedules` por id original, y SHALL reportar como advertencia cualquier horario presente en el dump que no exista en `schedules`.
5. IF un registro de `inst_horarios` referencia un valor de `Horarios_estado` distinto de 0, 1 o 2 THEN el sistema SHALL marcar ese registro como error de mapeo de doctor y SHALL excluirlo de la carga, sin detener la migración completa.
6. WHEN el script detecta un registro de referencia (doctor, obra social, motivo) cuyo nombre coincide de forma exacta (case-insensitive, espacios normalizados) con uno ya existente en el destino THEN el sistema SHALL tratarlo como ya migrado y SHALL NOT crear un duplicado.

### Requirement 2: Migración de pacientes (`fichas` → `patients`)

**User Story:** Como responsable de la migración, quiero que cada ficha de paciente del sistema legacy se convierta en un registro de `patients` con sus datos limpios y su relación a doctor resuelta, para que el nuevo sistema tenga la base de pacientes completa y consistente.

#### Acceptance Criteria

1. WHEN el script procesa cada fila de `fichas` THEN el sistema SHALL crear un registro en `patients` mapeando los campos según lo documentado en `docs/sdd.md` sección 4 (excluyendo los campos eliminados: `fuente`, `lugarTrabajo`, `tipoTrabajo`, `trabajoConyuge`, `tipoTrabajoConyuge`).
2. WHEN el campo `fichas.profesional` tiene el valor `'0'` THEN el sistema SHALL asignar `patients.doctor_id = NULL`.
3. WHEN el campo `fichas.profesional` tiene un valor numérico distinto de `'0'` correspondiente a un doctor existente THEN el sistema SHALL asignar ese valor como `patients.doctor_id`.
4. IF el campo `fichas.profesional` contiene un valor que no corresponde a ningún doctor migrado THEN el sistema SHALL asignar `patients.doctor_id = NULL` y SHALL registrar el caso en el reporte de migración como advertencia.
5. WHEN un campo de fecha de origen (por ejemplo `valorConsulta` asociado, fechas de primera/última visita) tiene el valor sentinela `'0000-00-00'` THEN el sistema SHALL convertirlo a `NULL` en el campo de fecha correspondiente del destino.
6. WHEN `fichas.valorConsulta` está presente THEN el sistema SHALL trasladar ese valor como dato de referencia hacia `clinical_records.visit_fee` en los registros de historia clínica derivados de ese paciente, según lo documentado en `docs/sdd.md`, y NOT SHALL almacenarlo en `patients`.
7. WHEN el script finaliza la migración de `fichas` THEN el sistema SHALL preservar el id original de `fichas.idFicha` como referencia interna (mapeo legacy id → nuevo id de `patients`) disponible para los pasos posteriores de vinculación de `cirugias`, `inst_turnos` e `historiaclinica`.

### Requirement 3: Migración de turnos (`inst_turnos` → `appointments`)

**User Story:** Como responsable de la migración, quiero que los turnos históricos se carguen en `appointments` con sus referencias a paciente, horario y doctor correctamente resueltas, para conservar el historial de citas del instituto.

#### Acceptance Criteria

1. WHEN el script procesa cada fila de `inst_turnos` THEN el sistema SHALL crear un registro en `appointments` mapeando `Turno_motivoid` a `reason_id`, `Turno_doctor` a `doctor_id`, `Turno_fecha` a `date`, `Turno_hora` a `schedule_id` (copia directa de id) y `Turno_obrasocialid` a `insurance_id`.
2. WHEN el script procesa `inst_turnos` THEN el sistema SHALL descartar el campo `Turno_telefono` sin migrarlo, dado que el teléfono del paciente se obtiene a través de `patients.phone` vía la relación `patient_id`.
3. WHEN el campo `Turno_paciente` debe resolverse a un paciente THEN el sistema SHALL aplicar la estrategia de vinculación de pacientes por coincidencia de texto descrita en el Requirement 6.
4. IF `Turno_hora` referencia un id de horario que no existe en `schedules` THEN el sistema SHALL insertar el turno con `schedule_id = NULL` y SHALL registrar el caso en el reporte como advertencia.
5. WHEN `Turno_estado` u otros campos de estado del turno deben mapearse a `appointments.status` THEN el sistema SHALL aplicar un mapeo determinístico y documentado en el propio script, y SHALL registrar como advertencia cualquier valor de estado de origen no contemplado en el mapeo, asignando el status por defecto `'pending'` en ese caso.

### Requirement 4: Migración de historias clínicas (`historiaclinica` → `clinical_records`)

**User Story:** Como responsable de la migración, quiero que cada entrada de historia clínica se convierta en un registro independiente con su texto limpio y su referencia a paciente correcta, para preservar el historial médico legible de cada paciente.

#### Acceptance Criteria

1. WHEN el script procesa cada fila de `historiaclinica` THEN el sistema SHALL crear un registro independiente en `clinical_records` con un id autogenerado, sin intentar preservar la clave compuesta original `(idHistoriaClinica, fechaConsulta)`.
2. WHEN el script mapea `historiaclinica.idHistoriaClinica` THEN el sistema SHALL tratarlo como referencia directa a `fichas.idFicha` y SHALL resolverlo a `clinical_records.patient_id` usando el mapeo de ids generado en el Requirement 2.
3. IF `historiaclinica.idHistoriaClinica` no corresponde a ningún paciente migrado THEN el sistema SHALL excluir esa fila de la carga (dado que `clinical_records.patient_id` es `NOT NULL`) y SHALL registrar el caso en el reporte como error.
4. WHEN el script procesa el campo `historiaclinica.datos` THEN el sistema SHALL reemplazar toda ocurrencia de la etiqueta `<br>` por un salto de línea antes de insertar el valor en `clinical_records.notes`.
5. WHEN el script mapea `fechaConsulta` THEN el sistema SHALL asignarlo a `clinical_records.visit_date`.

### Requirement 5: Migración de cirugías y extracción de tablas de lookup

**User Story:** Como responsable de la migración, quiero que los registros de cirugías se normalicen contra tablas de lookup de diagnósticos, partes del cuerpo y técnicas, y que sus pacientes queden vinculados, para que la información quirúrgica histórica quede estructurada y consultable.

#### Acceptance Criteria

1. WHEN el script se ejecuta THEN el sistema SHALL poblar `surgery_diagnoses` con cada valor distinto y no vacío de `cirugias.diagnostico` antes de migrar las filas de `cirugias`.
2. WHEN el script se ejecuta THEN el sistema SHALL poblar `body_parts` con cada valor distinto y no vacío de `cirugias.miembro` antes de migrar las filas de `cirugias`.
3. WHEN el script se ejecuta THEN el sistema SHALL poblar `surgery_techniques` con cada valor distinto y no vacío entre `cirugias.tecnica1`, `cirugias.tecnica2` y `cirugias.tecnica3` antes de migrar las filas de `cirugias`.
4. WHEN el script procesa cada fila de `cirugias` THEN el sistema SHALL crear un registro en `surgeries` con `diagnosis_id` y `body_part_id` resueltos contra las tablas de lookup pobladas, `date` desde `cirugias.fecha`, y `outcome` desde `cirugias.evolucion`.
5. IF `cirugias.diagnostico` o `cirugias.miembro` están vacíos en la fila de origen THEN el sistema SHALL insertar el registro de `surgeries` con `diagnosis_id` o `body_part_id` en `NULL` respectivamente, sin crear una entrada de lookup para el valor vacío.
6. WHEN una fila de `cirugias` tiene valores no vacíos en `tecnica1`, `tecnica2` y/o `tecnica3` THEN el sistema SHALL crear una fila en `surgery_applied_techniques` por cada técnica no vacía, vinculada al `surgery_id` correspondiente, con `order_index` 1, 2 o 3 según la columna de origen.
7. WHEN el script resuelve el paciente de una fila de `cirugias` (campos `apellido`, `nombre`, `edad`, `domicilio`) THEN el sistema SHALL aplicar la estrategia de vinculación de pacientes descrita en el Requirement 6, usando `apellido` y `nombre` como criterio de comparación.
8. WHEN el script vincula una fila de `cirugias` a un paciente existente THEN el sistema SHALL NOT sobrescribir los datos ya presentes en `patients` (`address`, etc.) con los valores en texto libre de `cirugias`; estos últimos se usan solo como entrada al proceso de matching y para el registro auditable.

### Requirement 6: Estrategia de vinculación de pacientes en texto libre (matching de duplicados)

**User Story:** Como responsable de la migración, quiero una estrategia explícita y auditable para vincular los pacientes mencionados como texto libre en `cirugias` e `inst_turnos` contra los registros ya migrados en `patients`, distinguiendo automáticamente los casos seguros de los ambiguos y de los sin match, para evitar tanto vínculos incorrectos como pérdida silenciosa de información, y para poder analizar y decidir manualmente qué hacer con los casos dudosos.

#### Acceptance Criteria

1. WHEN el script necesita resolver una referencia de paciente en texto libre (desde `cirugias.apellido`+`cirugias.nombre`, o desde `inst_turnos.Turno_paciente`) THEN el sistema SHALL comparar ese texto contra `patients.last_name` y `patients.first_name` usando una función de coincidencia aproximada (fuzzy match) que tolere diferencias menores de escritura (acentos, mayúsculas/minúsculas, abreviaturas comunes, orden de palabras, espacios).
2. IF la comparación produce exactamente un candidato cuya similitud supera el umbral de confianza definido por el script THEN el sistema SHALL vincular automáticamente el registro de origen a ese `patient_id` y SHALL registrar el vínculo en el reporte de auditoría como "auto-vinculado", incluyendo el texto original, el paciente vinculado y el puntaje de similitud.
3. IF la comparación produce dos o más candidatos cuya similitud supera el umbral mínimo de consideración, sin que ninguno se distinga claramente como el mejor (ambigüedad) THEN el sistema SHALL insertar el registro de origen con `patient_id = NULL` y SHALL marcarlo en el reporte de auditoría como "pendiente de revisión manual", incluyendo el texto original y la lista completa de candidatos con sus puntajes.
4. IF la comparación no produce ningún candidato por encima del umbral mínimo de consideración THEN el sistema SHALL insertar el registro de origen con `patient_id = NULL` y SHALL marcarlo en el reporte de auditoría como "sin coincidencia", incluyendo el texto original.
5. WHERE el texto de origen contiene únicamente el apellido (caso típico de `inst_turnos.Turno_paciente`, por ejemplo `'Amadei'`) THEN el sistema SHALL ejecutar el matching solo contra `patients.last_name`, SHALL considerar válido un resultado únicamente si produce un único candidato confiable, y SHALL tratar cualquier otro resultado (cero candidatos o más de uno) según los criterios 6.3 o 6.4 según corresponda.
6. WHEN el texto de origen está vacío o es un valor sin información (por ejemplo cadena vacía o solo espacios) THEN el sistema SHALL clasificar el registro directamente como "sin coincidencia" sin ejecutar el algoritmo de fuzzy matching.
7. WHEN el script vincula pacientes desde `cirugias` y desde `inst_turnos` por separado THEN el sistema SHALL ejecutar el mismo algoritmo y los mismos umbrales de decisión para ambas fuentes, de forma que el criterio de vinculación sea consistente entre tablas.
8. WHEN el proceso de matching finaliza THEN el sistema SHALL producir un reporte consolidado y legible por humanos (Requirement 8) que permita identificar y analizar todos los casos de "pendiente de revisión manual" y "sin coincidencia", para que un humano decida cómo tratarlos.
9. WHERE el umbral de confianza y el umbral mínimo de consideración son valores configurables del script THEN el sistema SHALL permitir ajustarlos sin modificar la lógica central de matching, de forma que puedan recalibrarse al validar contra el dump completo de producción.
10. IF se detectan dentro de `patients` (luego de migrado) dos o más registros que el algoritmo de matching consideraría duplicados entre sí (mismo apellido y nombre con similitud sobre el umbral de confianza) THEN el sistema SHALL incluir esa situación en el reporte de auditoría como una sección separada de "posibles pacientes duplicados en destino", sin fusionar ni modificar automáticamente esos registros.

### Requirement 7: Migración de movimientos de caja (`caja` → `cash_entries`)

**User Story:** Como responsable de la migración, quiero que los montos de caja, almacenados como texto con coma decimal en dos columnas separadas, se conviertan en un monto numérico único con su tipo correspondiente, para que la información financiera histórica sea consultable y agregable en el nuevo esquema.

#### Acceptance Criteria

1. WHEN el script procesa cada fila de `caja` THEN el sistema SHALL convertir los valores de `ingresosCaja` y `egresosCaja` de VARCHAR con coma decimal (por ejemplo `'1350,48'`) a un valor DECIMAL reemplazando la coma por un punto.
2. IF `ingresosCaja` es distinto de cero y `egresosCaja` es igual a cero THEN el sistema SHALL crear un registro en `cash_entries` con `amount = ingresosCaja` (convertido) y `type = 'income'`.
3. IF `egresosCaja` es distinto de cero y `ingresosCaja` es igual a cero THEN el sistema SHALL crear un registro en `cash_entries` con `amount = egresosCaja` (convertido) y `type = 'expense'`.
4. IF ambas columnas `ingresosCaja` y `egresosCaja` son distintas de cero en la misma fila THEN el sistema SHALL registrar el caso en el reporte de migración como error de datos ambiguos y SHALL excluir esa fila de la carga sin detener la migración completa.
5. IF ambas columnas `ingresosCaja` y `egresosCaja` son iguales a cero o están vacías en la misma fila THEN el sistema SHALL excluir esa fila de la carga (no genera movimiento) y SHALL registrarla en el reporte como omitida por no representar un movimiento real.
6. WHEN el campo `fechaCaja` de origen tiene el valor sentinela `'0000-00-00'` THEN el sistema SHALL registrar la fila en el reporte como error de fecha inválida y SHALL excluirla de la carga, dado que `cash_entries.date` es `NOT NULL`.
7. WHEN el script mapea `conceptoCaja` THEN el sistema SHALL asignarlo a `cash_entries.description`.

### Requirement 8: Reporte auditable de la migración

**User Story:** Como responsable de la migración, quiero un reporte legible y estructurado de todo lo que el script hizo, marcó para revisión o no pudo procesar, para poder analizar los casos puntuales de duplicados y dar conformidad a la migración antes de considerarla completa.

#### Acceptance Criteria

1. WHEN el script finaliza su ejecución (con o sin errores) THEN el sistema SHALL generar un reporte que incluya, como mínimo, por cada tabla de origen procesada: cantidad de filas leídas, cantidad de filas migradas exitosamente, cantidad de filas excluidas y cantidad de advertencias.
2. WHEN el script realiza una vinculación de paciente (Requirement 6) THEN el sistema SHALL incluir en el reporte el detalle de cada caso de "auto-vinculado", "pendiente de revisión manual" y "sin coincidencia", de forma que cada caso sea identificable individualmente (texto de origen, tabla y fila de origen, resultado).
3. WHEN el script excluye o transforma con advertencia una fila por cualquier motivo (dato inválido, referencia rota, ambigüedad, etc.) THEN el sistema SHALL registrar en el reporte la tabla de origen, un identificador de la fila de origen, el motivo y la acción tomada.
4. WHEN el reporte se genera THEN el sistema SHALL producir el contenido en un formato estructurado y legible tanto por humanos como por herramientas de análisis posterior (por ejemplo archivos separados o secciones claramente delimitadas para: resumen por tabla, casos de revisión manual, casos sin coincidencia, errores).
5. WHEN el script se ejecuta múltiples veces sobre el mismo dump de entrada THEN el sistema SHALL producir un reporte nuevo identificable (por ejemplo con marca de tiempo) sin sobrescribir silenciosamente reportes de ejecuciones anteriores.
6. IF el usuario necesita revisar específicamente los casos de posible duplicado de pacientes THEN el sistema SHALL permitir ubicar esa información en el reporte sin tener que inspeccionar la base de datos destino directamente.

### Requirement 9: Idempotencia y repetibilidad de la ejecución

**User Story:** Como responsable de la migración, quiero poder ejecutar el script más de una vez sobre el mismo origen sin duplicar datos en el destino, para poder probarlo contra la muestra actual, corregirlo y volver a ejecutarlo sin tener que limpiar manualmente la base cada vez.

#### Acceptance Criteria

1. WHEN el script se ejecuta más de una vez con el mismo archivo de entrada y el destino ya contiene los datos de una ejecución previa THEN el sistema SHALL detectar los registros ya migrados y SHALL NOT crear duplicados de los mismos registros de origen.
2. WHEN el script necesita determinar si un registro de origen ya fue migrado THEN el sistema SHALL basarse en un criterio determinístico y documentado (por ejemplo preservación de id original, o una marca de procedencia), consistente con las tablas que preservan ids explícitos (`doctors`, `health_insurances`, `visit_reasons`, `schedules`) y con las que no los preservan (`patients`, `appointments`, `clinical_records`, `surgeries`, `cash_entries`).
3. IF el usuario solicita explícitamente una re-ejecución completa desde cero THEN el sistema SHALL proveer un mecanismo documentado para hacerlo (por ejemplo un modo de reseteo) sin requerir intervención manual directa sobre la base de datos.
4. WHEN el script se interrumpe a mitad de ejecución (error no controlado, corte de conexión) THEN el sistema SHALL dejar el destino en un estado del cual una re-ejecución posterior pueda continuar o completarse sin duplicar lo ya insertado.
5. WHEN el script vincula pacientes (Requirement 6) en una re-ejecución THEN el sistema SHALL producir el mismo resultado de matching que en la ejecución original, dado el mismo estado de `patients`, de forma que el proceso sea determinístico y no dependa de azar o de orden no determinista de lectura.

### Requirement 10: Operación contra una muestra de datos y preparación para el dump completo

**User Story:** Como responsable de la migración, quiero que el script funcione correctamente y de forma verificable contra la muestra de datos disponible hoy (`sample_dump.sql`), y quiero que quede explícitamente preparado para ser validado contra el dump completo de producción cuando esté disponible, para no bloquear el desarrollo y la revisión del script mientras se espera ese dump.

#### Acceptance Criteria

1. WHEN el script se ejecuta contra `sample_dump.sql` THEN el sistema SHALL completar la migración de todas las tablas en alcance (Requirements 1 a 7) sin requerir cambios de código específicos para el archivo de muestra.
2. WHEN el script lee el archivo de entrada THEN el sistema SHALL tratar la ubicación y el nombre del dump como un parámetro configurable, de forma que apuntar al dump completo de producción en el futuro no requiera modificar la lógica de migración.
3. IF el dump completo de producción introduce volúmenes de datos significativamente mayores a los de la muestra THEN el sistema SHALL seguir aplicando los mismos criterios de aceptación de este documento (transformación, matching, reporte, idempotencia) sin asumir límites de cantidad de filas codificados de forma fija.
4. WHILE no se disponga del dump completo de producción THEN el sistema SHALL considerarse validado únicamente contra `sample_dump.sql`, y el reporte de auditoría (Requirement 8) generado contra la muestra SHALL dejarse disponible como referencia para comparar contra los resultados obtenidos cuando se ejecute contra el dump real.
5. WHEN se reciba el dump completo de producción THEN el sistema SHALL permitir ejecutar el mismo script sin modificaciones estructurales, y cualquier ajuste necesario (por ejemplo recalibración de umbrales de matching del Requirement 6 ante mayor volumen y variedad de nombres) SHALL realizarse mediante los parámetros configurables ya previstos, no mediante reescritura de la lógica.
6. IF durante la validación contra el dump completo se detectan casos no contemplados por el sample (por ejemplo nuevos valores de `Horarios_estado`, formatos de monto no vistos en la muestra, o nuevas variantes de nombre de paciente) THEN el sistema SHALL manejarlos mediante los mecanismos genéricos de advertencia y exclusión ya definidos en los Requirements 1, 6 y 7, en lugar de fallar de forma no controlada.

### Requirement 11: Tablas explícitamente excluidas de la migración

**User Story:** Como responsable de la migración, quiero que el script ignore deliberadamente las tablas legacy sin equivalente en el nuevo esquema, para evitar trabajo innecesario y datos huérfanos en el destino.

#### Acceptance Criteria

1. WHEN el script procesa el dump de origen THEN el sistema SHALL NOT migrar las tablas `inst_alt`, `medias` y `ventamedias`.
2. WHEN el script genera el reporte de migración (Requirement 8) THEN el sistema SHALL listar explícitamente las tablas excluidas y el motivo de exclusión, para que quede registrado que la omisión fue intencional y no un olvido.
