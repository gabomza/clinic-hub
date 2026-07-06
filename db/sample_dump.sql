-- MySQL dump 10.13  Distrib 5.5.8, for Win32 (x86)
--
-- Host: localhost    Database: instituto
-- ------------------------------------------------------
-- Server version	5.5.8

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `caja`
--

DROP TABLE IF EXISTS `caja`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `caja` (
  `idCaja` int(11) NOT NULL AUTO_INCREMENT,
  `fechaCaja` date NOT NULL DEFAULT '0000-00-00',
  `conceptoCaja` varchar(100) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `ingresosCaja` varchar(10) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `egresosCaja` varchar(10) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  PRIMARY KEY (`idCaja`)
) ENGINE=MyISAM AUTO_INCREMENT=3075 DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `caja`
--

LOCK TABLES `caja` WRITE;
/*!40000 ALTER TABLE `caja` DISABLE KEYS */;
INSERT INTO `caja` VALUES (1,'2004-01-01','saldo anterior','1350,48','0,00');
INSERT INTO `caja` VALUES (2,'2004-01-13','Medias 28/11/2003 al 13/01/2004','355,59','0,00');
INSERT INTO `caja` VALUES (3,'2004-01-02','caja fisiatria','110,00','0,00');
INSERT INTO `caja` VALUES (4,'2004-01-05','caja fisiatria','200,00','0,00');
INSERT INTO `caja` VALUES (5,'2004-01-06','caja fisiatria','340,00','0,00');
/*!40000 ALTER TABLE `caja` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `cirugias`
--

DROP TABLE IF EXISTS `cirugias`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `cirugias` (
  `id_cirugia` int(11) NOT NULL DEFAULT '0',
  `apellido` varchar(255) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `nombre` varchar(255) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `edad` int(11) NOT NULL DEFAULT '0',
  `domicilio` varchar(255) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `fecha` date NOT NULL DEFAULT '0000-00-00',
  `diagnostico` varchar(255) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `miembro` varchar(255) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `tecnica1` varchar(255) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `tecnica2` varchar(255) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `tecnica3` varchar(255) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `evolucion` varchar(255) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  PRIMARY KEY (`id_cirugia`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `cirugias`
--

LOCK TABLES `cirugias` WRITE;
/*!40000 ALTER TABLE `cirugias` DISABLE KEYS */;
INSERT INTO `cirugias` VALUES (1,'ABALLAY','ANGELA C.DE',55,'FRANCIA 1620 - GODOY CRUZ','1987-08-14','I.V.S.','M.I.I.','REEX.CAY','EMI','SHERMAN','BUENA 87');
INSERT INTO `cirugias` VALUES (2,'ACOSTA','EDELMIRA',40,'RAMPONI 5742 - GUAYMALLEN','1984-01-18','I.V.S.','M.I.D.','S.I.','EMI','','BUENA 84');
INSERT INTO `cirugias` VALUES (3,'ACOSTA','ELISA ZEIER DE',51,'NECOCHEA 1651 - GODOY CRUZ','1989-06-26','I.V.S.','M.I.I.','S.I.','EMI','SHERMAN','BUENA 89');
INSERT INTO `cirugias` VALUES (4,'AGOSTINI','ESTHER DE',49,'LA PLATA 288 - MENDOZA','1988-04-08','I.V.S.Y P.','M.I.I.','S.I.','EMI','COCKETT','BUENA 88');
INSERT INTO `cirugias` VALUES (5,'AGOSTINI','ESTHER DE',49,'LA PLATA 288 - MENDOZA','1988-09-05','I.V.S.','M.I.D.','S.I.','EMI','','BUENA 89');
INSERT INTO `cirugias` VALUES (6,'AGOSTINI','ESTHER DE',52,'LA PLATA 288 - MENDOZA','1991-02-06','I.V.P.C.','M.I.D.','','','COCKETT','NECROSIS');
INSERT INTO `cirugias` VALUES (7,'AGUILAR','MARIA',58,'RODEO DE LA CRUZ','1987-02-12','I.V.P.C.','M.I.I.','LINTON','','','NECROSIS');
/*!40000 ALTER TABLE `cirugias` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `fichas`
--

DROP TABLE IF EXISTS `fichas`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `fichas` (
  `idFicha` int(11) NOT NULL DEFAULT '0',
  `tipoDoc` varchar(2) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `documento` varchar(12) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `apellido` varchar(60) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `nombre` varchar(60) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `domicilio` varchar(255) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `departamento` varchar(60) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `provincia` varchar(60) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `fechaNac` date NOT NULL DEFAULT '0000-00-00',
  `sexo` char(1) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `obraSocial` varchar(60) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `nroObraSocial` varchar(60) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `telefono` char(30) COLLATE utf8_unicode_ci NOT NULL DEFAULT '0',
  `eMail` varchar(30) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `codPostal` varchar(5) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `estadoCivil` char(1) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `profesional` varchar(40) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `fuente` varchar(40) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `lugarTrabajo` varchar(40) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `tipoTrabajo` varchar(40) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `trabajoConyuge` varchar(40) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `tipoTrabajoConyuge` varchar(40) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `primerConsulta` date NOT NULL DEFAULT '0000-00-00',
  `ultimaConsulta` date NOT NULL DEFAULT '0000-00-00',
  `diagnostico` varchar(244) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `valorConsulta` varchar(6) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  PRIMARY KEY (`idFicha`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `fichas`
--

LOCK TABLES `fichas` WRITE;
/*!40000 ALTER TABLE `fichas` DISABLE KEYS */;
INSERT INTO `fichas` VALUES (1,'','','','NORMA DE',' - nro: 0 -  - barrio: UJEMVI -  - mzna: 10 -  - casa: 9 -','LAS HERAS','MENDOZA','0000-00-00','F','OSEP','4.551.215','4301214','','','','1','0','','0','','','0000-00-00','0000-00-00','NO DEFINIDO','\r');
INSERT INTO `fichas` VALUES (2,'DN','10.628.555','RODRIGUEZ DE SOSA','ILDA','CARLOS PAZ 1410 -  DORREGO','GUAYMALLEN','MENDOZA','1952-09-06','F','CIMESA','1305266797-01','4320271','','','','1','0','','0','','','1993-04-15','0000-00-00','LINFEDEMA M.S. / LINFEDEMA M.I. / I.V.S. -TELANGIECT.','\r');
INSERT INTO `fichas` VALUES (3,'','','PEDERNERA','ANGELA',' - nro: 0 -  - piso: 5 -  - depto: 6 -  - barrio: UNIMEV -  - monoblock: B4 -','GUAYMALLEN','MENDOZA','1900-03-01','F','EMSE','','260141','','','','1','0','','0','','','0000-00-00','0000-00-00','NO DEFINIDO','\r');
INSERT INTO `fichas` VALUES (5,'','','RODRIGUEZ','STELLA MARIS PAZ DE','calle: RODRIGUEZ - nro: 2853 -','CAPITAL','MENDOZA','1900-02-03','F','OSDE 310','60.372264-3.02','381002','','','','1','0','','0','','','0000-00-00','0000-00-00','NO DEFINIDO','\r');
INSERT INTO `fichas` VALUES (6,'','','JIRALA','NANCY DE','calle: CUYO - nro: 2380 -  - barrio: SANTA ANA -','GUAYMALLEN','MENDOZA','1900-02-03','F','OSEP','13.303.059','263912','','','','1','0','','0','','','0000-00-00','0000-00-00','NO DEFINIDO','\r');
INSERT INTO `fichas` VALUES (7,'','','ANDREANI','NORA PUCCINELLI DE','calle: TUCUMAN - nro: 619 -','CAPITAL','MENDOZA','1900-02-28','F','IOS - CORPSALUD','16.988/J','306356','','','','1','0','','0','','','0000-00-00','0000-00-00','NO DEFINIDO','\r');
INSERT INTO `fichas` VALUES (8,'','','HAIST','EVELINA','calle: CHILE - nro: 2535 -','CAPITAL','MENDOZA','1900-01-23','F','OSEP','0.609.996','0','','','','1','0','','0','','','0000-00-00','0000-00-00','NO DEFINIDO','\r');
INSERT INTO `fichas` VALUES (9,'','','ANDREOTTI','ZOILA DE','calle: JOSE M. GODOY - nro: 199 -','LAS HERAS','MENDOZA','1900-02-27','F','OSFA - CIMPRE','78811/1','307885','','','','1','0','','0','','','0000-00-00','0000-00-00','NO DEFINIDO','\r');
INSERT INTO `fichas` VALUES (10,'','','ESPRESATTI','SUSANA DE','calle: PEDERNERA - nro: 3019 -','GODOY CRUZ','MENDOZA','1900-02-08','F','IOS - CORPSALUD','115206-1','273656','','','','1','0','','0','','','0000-00-00','0000-00-00','NO DEFINIDO','\r');
INSERT INTO `fichas` VALUES (11,'','','GHINAUDO','MARGARITA','calle: COLOMBIA - nro: 1275 -  - localidad: VILLA NUEVA','GUAYMALLEN','MENDOZA','1900-02-17','F','APM','650-A','261099','','','','1','0','','0','','','0000-00-00','0000-00-00','NO DEFINIDO','\r');
INSERT INTO `fichas` VALUES (12,'','','ARRUPE','GRACIELA DE','calle: PARANA - nro: 671 -','CAPITAL','MENDOZA','1900-02-05','F','OSDE 310','11.202546.9-05','233247','','','','1','0','','0','','','0000-00-00','0000-00-00','NO DEFINIDO','\r');
INSERT INTO `fichas` VALUES (13,'','','MARCELLINI','PATROCINIA','calle: JOSE HERNANDEZ - nro: 1720 -','LAS HERAS','MENDOZA','1900-03-03','F','PARTICULAR','','306225','','','','1','0','','0','','','0000-00-00','0000-00-00','NO DEFINIDO','\r');
/*!40000 ALTER TABLE `fichas` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `historiaclinica`
--

DROP TABLE IF EXISTS `historiaclinica`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `historiaclinica` (
  `idHistoriaClinica` int(11) NOT NULL DEFAULT '0',
  `fechaConsulta` date NOT NULL DEFAULT '0000-00-00',
  `datos` text COLLATE utf8_unicode_ci NOT NULL,
  PRIMARY KEY (`idHistoriaClinica`,`fechaConsulta`)
) ENGINE=MyISAM DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `historiaclinica`
--

LOCK TABLES `historiaclinica` WRITE;
/*!40000 ALTER TABLE `historiaclinica` DISABLE KEYS */;
INSERT INTO `historiaclinica` VALUES (0,'1997-05-07','EVOLUCION OK. CONTROL EN OCTUBRE-5.3:HARA ESCL. 13.4:OX4 ESCL.CPP,PEMI<br>');
INSERT INTO `historiaclinica` VALUES (0,'1997-06-17','CA Y EPI.-1.7:CAIP Y MD.-8.7:CPP Y EMI.-15.7:CEP Y HPD.5.8:CIPIE Y PI.<br>');
INSERT INTO `historiaclinica` VALUES (0,'1998-08-12','OX4 ESCL. CEP Y MD -21,8:CEP Y MI.-31.8:CIP,R Y EMD.-30.9:CIP,R Y EMD.<br>');
INSERT INTO `historiaclinica` VALUES (0,'1998-10-22','EMI CAMD.-29.10:HPI-CONT. C/ESCL..-5.11:ESCL. CPP,HP,CPMD-HIRUDOID F..<br>');
INSERT INTO `historiaclinica` VALUES (0,'1998-11-24','OA EMI MII-DIOXAPARCHES.-30.11:CIPD-CONT.C/ESCL.EN\'99-CONTROL 20 DIAS.<br>');
INSERT INTO `historiaclinica` VALUES (0,'2000-06-15','ESCL. HP Y CPEMI.-22.06:HP Y CPMD.-29.06: CPEM Y HPI.-6.7:6');
INSERT INTO `historiaclinica` VALUES (0,'2000-08-03','CONT. CON ESCL.24.08:ESCL.HP Y CPIMI.-28.08:MID.-07.09:CPP,HP Y CPEMI.<br>');
INSERT INTO `historiaclinica` VALUES (1,'1993-03-18','LINFEDEMA 2 M.S.I.MASTECTOMIA SIN VACIAM.EN 1988. 2.92:METAST.COLUMNA<br>');
INSERT INTO `historiaclinica` VALUES (2,'1993-03-18','EN 4.89:S.I. + EMI BIL.BUENA EVOL. 11.90:EMI BIL.4.92:EMI MII. HARA 3<br>EMI EN MII.  25.3: EMI CPPI. PROXIMA HACER ULTRASON.X MANCHAS PIERNA<br>');
INSERT INTO `historiaclinica` VALUES (2,'1993-04-15','EMI CIPI-29.4:HPI. CONTROL EN 20 DIAS<br>');
INSERT INTO `historiaclinica` VALUES (2,'2002-03-07','REFIERE CALAMBRES NOCTURNOS IMPORTANTES Y FRECUENTES.CAMINA 30 MINUTOS<br>POR DIA.PESO NORMAL.PTA F EN CPIPI,CEPD Y CPIPD 1/3 SUP->EMIX4 TB-><br>ESCL.INDICO:HOLOMAGNESIO B 6 DAFLON 500/19.03.02 OX2 EMI CPIPI CERVEP<br>POMADA/26.3 CEPD/02.04.02 OX2 EMI CEPI<br>');
INSERT INTO `historiaclinica` VALUES (2,'2002-04-09','CAPI FALTAN 2 SESIONES EN CPIPD 1/3 SUP Y HPI/23.4 CPIPD/6.5 HPI<br>');
INSERT INTO `historiaclinica` VALUES (3,'1993-03-18','FLEBEC.CARA POST.AMBAS PIERNAS. 1`EMI:PIERNA D.(70)<br>');
/*!40000 ALTER TABLE `historiaclinica` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `inst_alt`
--

DROP TABLE IF EXISTS `inst_alt`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `inst_alt` (
  `Alt_id` int(11) NOT NULL AUTO_INCREMENT,
  `Alt_texto` text COLLATE utf8_unicode_ci NOT NULL,
  `Alt_fecha` date NOT NULL DEFAULT '0000-00-00',
  `Alt_doctor` int(11) NOT NULL DEFAULT '0',
  PRIMARY KEY (`Alt_id`)
) ENGINE=MyISAM AUTO_INCREMENT=255 DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `inst_alt`
--

LOCK TABLES `inst_alt` WRITE;
/*!40000 ALTER TABLE `inst_alt` DISABLE KEYS */;
INSERT INTO `inst_alt` VALUES (1,'','2005-03-16',1);
INSERT INTO `inst_alt` VALUES (2,'16.15 HS GONZALEZ (CONSULTA)........................\r\n17.30 HS GOYANO   (1','2005-03-17',1);
INSERT INTO `inst_alt` VALUES (3,'15.50 HS STOCO  (E)\r\n16.15 HS GOMEZ LILIANA (C)\r\n         PE','2005-03-18',1);
INSERT INTO `inst_alt` VALUES (4,'OLGUIN (1','2005-03-21',1);
INSERT INTO `inst_alt` VALUES (5,'MA','2005-03-22',1);
INSERT INTO `inst_alt` VALUES (6,'17.00 DEL OLMO 1','2005-03-23',1);
INSERT INTO `inst_alt` VALUES (7,'PALMA (CONTROL CIRUGIA)-----------------------------\r\nCASTRO (CONTROL CIRUGIA)----------------------------\r\n21.15 TRAVERSINI (X ESTUDIOS)-----------------------','2005-03-23',2);
INSERT INTO `inst_alt` VALUES (8,'15.45  LACOSTE (E)----------------------------------\r\n16.15  QUEVEDO  (M)---------------------------------\r\n17.00  VERA (M)-------------------------------------\r\n20.15 GONZALEZ (1','2005-03-28',1);
/*!40000 ALTER TABLE `inst_alt` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `inst_doctor`
--

DROP TABLE IF EXISTS `inst_doctor`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `inst_doctor` (
  `Doctor_id` int(11) NOT NULL AUTO_INCREMENT,
  `Doctor_nombre` varchar(50) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `Doctor_extra` varchar(50) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  PRIMARY KEY (`Doctor_id`)
) ENGINE=MyISAM AUTO_INCREMENT=6 DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `inst_doctor`
--

LOCK TABLES `inst_doctor` WRITE;
/*!40000 ALTER TABLE `inst_doctor` DISABLE KEYS */;
INSERT INTO `inst_doctor` VALUES (1,'Dr. Angel Guzman','');
INSERT INTO `inst_doctor` VALUES (2,'Dr. Alberto Silva','');
INSERT INTO `inst_doctor` VALUES (3,'Dra. Pelaez','');
/*!40000 ALTER TABLE `inst_doctor` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `inst_horarios`
--

DROP TABLE IF EXISTS `inst_horarios`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `inst_horarios` (
  `Horarios_id` int(11) NOT NULL AUTO_INCREMENT,
  `Horarios_hora` time NOT NULL DEFAULT '00:00:00',
  `Horarios_estado` int(11) NOT NULL DEFAULT '0',
  PRIMARY KEY (`Horarios_id`)
) ENGINE=MyISAM AUTO_INCREMENT=73 DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `inst_horarios`
--

LOCK TABLES `inst_horarios` WRITE;
/*!40000 ALTER TABLE `inst_horarios` DISABLE KEYS */;
INSERT INTO `inst_horarios` VALUES (1,'09:00:00',0);
INSERT INTO `inst_horarios` VALUES (2,'09:20:00',0);
INSERT INTO `inst_horarios` VALUES (3,'09:40:00',0);
INSERT INTO `inst_horarios` VALUES (4,'10:00:00',0);
INSERT INTO `inst_horarios` VALUES (5,'10:20:00',0);
INSERT INTO `inst_horarios` VALUES (6,'10:40:00',0);
INSERT INTO `inst_horarios` VALUES (7,'11:00:00',0);
INSERT INTO `inst_horarios` VALUES (8,'11:20:00',0);
INSERT INTO `inst_horarios` VALUES (9,'11:40:00',0);
INSERT INTO `inst_horarios` VALUES (10,'16:00:00',0);
INSERT INTO `inst_horarios` VALUES (11,'16:20:00',0);
INSERT INTO `inst_horarios` VALUES (12,'16:40:00',0);
INSERT INTO `inst_horarios` VALUES (13,'17:00:00',0);
INSERT INTO `inst_horarios` VALUES (14,'17:20:00',0);
INSERT INTO `inst_horarios` VALUES (15,'17:40:00',0);
INSERT INTO `inst_horarios` VALUES (16,'18:00:00',0);
INSERT INTO `inst_horarios` VALUES (17,'18:20:00',0);
INSERT INTO `inst_horarios` VALUES (18,'18:40:00',0);
INSERT INTO `inst_horarios` VALUES (19,'19:00:00',0);
INSERT INTO `inst_horarios` VALUES (20,'19:20:00',0);
INSERT INTO `inst_horarios` VALUES (21,'19:40:00',0);
INSERT INTO `inst_horarios` VALUES (22,'20:00:00',0);
INSERT INTO `inst_horarios` VALUES (23,'09:00:00',1);
INSERT INTO `inst_horarios` VALUES (24,'09:20:00',1);
INSERT INTO `inst_horarios` VALUES (25,'09:40:00',1);
INSERT INTO `inst_horarios` VALUES (26,'10:00:00',1);
INSERT INTO `inst_horarios` VALUES (27,'10:20:00',1);
INSERT INTO `inst_horarios` VALUES (28,'10:40:00',1);
INSERT INTO `inst_horarios` VALUES (29,'11:00:00',1);
INSERT INTO `inst_horarios` VALUES (30,'11:20:00',1);
INSERT INTO `inst_horarios` VALUES (31,'11:40:00',1);
INSERT INTO `inst_horarios` VALUES (32,'12:00:00',1);
INSERT INTO `inst_horarios` VALUES (33,'12:20:00',1);
INSERT INTO `inst_horarios` VALUES (34,'16:00:00',1);
INSERT INTO `inst_horarios` VALUES (35,'16:20:00',1);
INSERT INTO `inst_horarios` VALUES (36,'16:40:00',1);
INSERT INTO `inst_horarios` VALUES (37,'17:00:00',1);
INSERT INTO `inst_horarios` VALUES (38,'17:20:00',1);
INSERT INTO `inst_horarios` VALUES (42,'18:00:00',1);
INSERT INTO `inst_horarios` VALUES (41,'17:40:00',1);
INSERT INTO `inst_horarios` VALUES (43,'18:20:00',1);
INSERT INTO `inst_horarios` VALUES (44,'18:40:00',1);
INSERT INTO `inst_horarios` VALUES (45,'19:00:00',1);
INSERT INTO `inst_horarios` VALUES (46,'19:20:00',1);
INSERT INTO `inst_horarios` VALUES (47,'19:40:00',1);
INSERT INTO `inst_horarios` VALUES (48,'20:00:00',1);
INSERT INTO `inst_horarios` VALUES (49,'20:20:00',1);
INSERT INTO `inst_horarios` VALUES (50,'20:40:00',1);
INSERT INTO `inst_horarios` VALUES (51,'21:00:00',1);
INSERT INTO `inst_horarios` VALUES (52,'16:00:00',2);
INSERT INTO `inst_horarios` VALUES (53,'16:15:00',2);
INSERT INTO `inst_horarios` VALUES (54,'16:30:00',2);
INSERT INTO `inst_horarios` VALUES (55,'16:45:00',2);
INSERT INTO `inst_horarios` VALUES (56,'17:00:00',2);
INSERT INTO `inst_horarios` VALUES (57,'17:15:00',2);
INSERT INTO `inst_horarios` VALUES (58,'17:30:00',2);
INSERT INTO `inst_horarios` VALUES (59,'17:45:00',2);
INSERT INTO `inst_horarios` VALUES (60,'18:00:00',2);
INSERT INTO `inst_horarios` VALUES (61,'18:15:00',2);
INSERT INTO `inst_horarios` VALUES (62,'18:30:00',2);
INSERT INTO `inst_horarios` VALUES (63,'18:45:00',2);
INSERT INTO `inst_horarios` VALUES (70,'20:20:00',0);
INSERT INTO `inst_horarios` VALUES (65,'19:00:00',2);
INSERT INTO `inst_horarios` VALUES (66,'19:15:00',2);
INSERT INTO `inst_horarios` VALUES (67,'19:30:00',2);
INSERT INTO `inst_horarios` VALUES (68,'19:45:00',2);
INSERT INTO `inst_horarios` VALUES (69,'20:00:00',2);
INSERT INTO `inst_horarios` VALUES (71,'20:40:00',0);
INSERT INTO `inst_horarios` VALUES (72,'21:00:00',0);
/*!40000 ALTER TABLE `inst_horarios` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `inst_motivo`
--

DROP TABLE IF EXISTS `inst_motivo`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `inst_motivo` (
  `Motivo_id` int(11) NOT NULL AUTO_INCREMENT,
  `Motivo_texto` varchar(70) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `Motivo_estado` int(11) NOT NULL DEFAULT '1',
  PRIMARY KEY (`Motivo_id`)
) ENGINE=MyISAM AUTO_INCREMENT=10 DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `inst_motivo`
--

LOCK TABLES `inst_motivo` WRITE;
/*!40000 ALTER TABLE `inst_motivo` DISABLE KEYS */;
INSERT INTO `inst_motivo` VALUES (1,'Primer Consulta',1);
INSERT INTO `inst_motivo` VALUES (2,'Consulta',1);
INSERT INTO `inst_motivo` VALUES (3,'Esclerosis',1);
INSERT INTO `inst_motivo` VALUES (4,'Microcirugia',1);
INSERT INTO `inst_motivo` VALUES (5,'Control Cirugia',1);
INSERT INTO `inst_motivo` VALUES (6,'Control Micro',1);
INSERT INTO `inst_motivo` VALUES (7,'Sutura',1);
INSERT INTO `inst_motivo` VALUES (8,'Por Estudio',1);
INSERT INTO `inst_motivo` VALUES (9,'Por Celulitis',1);
/*!40000 ALTER TABLE `inst_motivo` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `inst_obrasoc`
--

DROP TABLE IF EXISTS `inst_obrasoc`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `inst_obrasoc` (
  `Obrasoc_id` int(11) NOT NULL AUTO_INCREMENT,
  `Obrasoc_texto` varchar(70) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `Obrasoc_estado` int(70) NOT NULL DEFAULT '1',
  PRIMARY KEY (`Obrasoc_id`)
) ENGINE=MyISAM AUTO_INCREMENT=19 DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `inst_obrasoc`
--

LOCK TABLES `inst_obrasoc` WRITE;
/*!40000 ALTER TABLE `inst_obrasoc` DISABLE KEYS */;
INSERT INTO `inst_obrasoc` VALUES (1,'----------------',1);
INSERT INTO `inst_obrasoc` VALUES (2,'CIMESA',1);
INSERT INTO `inst_obrasoc` VALUES (3,'OSEP',1);
INSERT INTO `inst_obrasoc` VALUES (4,'Docthos',1);
INSERT INTO `inst_obrasoc` VALUES (5,'Swiss Medical',1);
INSERT INTO `inst_obrasoc` VALUES (6,'DAMSU',1);
INSERT INTO `inst_obrasoc` VALUES (7,'MEDIFE',1);
INSERT INTO `inst_obrasoc` VALUES (8,'Petroleros Priv',1);
INSERT INTO `inst_obrasoc` VALUES (9,'TIM',1);
INSERT INTO `inst_obrasoc` VALUES (10,'Caja Forense',1);
INSERT INTO `inst_obrasoc` VALUES (11,'Poder Judicial',1);
INSERT INTO `inst_obrasoc` VALUES (12,'MEDICUS',1);
INSERT INTO `inst_obrasoc` VALUES (13,'CONSALUD',1);
INSERT INTO `inst_obrasoc` VALUES (14,'JERARQUICOSALUD',1);
INSERT INTO `inst_obrasoc` VALUES (15,'PARTICULAR',1);
INSERT INTO `inst_obrasoc` VALUES (16,'No Cobrar',1);
INSERT INTO `inst_obrasoc` VALUES (17,'OSDE',1);
INSERT INTO `inst_obrasoc` VALUES (18,'PAMI',1);
/*!40000 ALTER TABLE `inst_obrasoc` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `inst_turnos`
--

DROP TABLE IF EXISTS `inst_turnos`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `inst_turnos` (
  `Turno_id` int(11) NOT NULL AUTO_INCREMENT,
  `Turno_paciente` varchar(200) COLLATE utf8_unicode_ci NOT NULL DEFAULT '0',
  `Turno_motivoid` int(11) NOT NULL DEFAULT '0',
  `Turno_doctor` int(11) NOT NULL DEFAULT '0',
  `Turno_fecha` date NOT NULL DEFAULT '0000-00-00',
  `Turno_hora` int(11) NOT NULL DEFAULT '0',
  `Turno_estado` int(11) NOT NULL DEFAULT '1',
  `Turno_detalle` varchar(255) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `Turno_telefono` varchar(50) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `Turno_obrasocialid` int(11) NOT NULL DEFAULT '0',
  PRIMARY KEY (`Turno_id`)
) ENGINE=MyISAM AUTO_INCREMENT=14609 DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `inst_turnos`
--

LOCK TABLES `inst_turnos` WRITE;
/*!40000 ALTER TABLE `inst_turnos` DISABLE KEYS */;
INSERT INTO `inst_turnos` VALUES (1,'',4,1,'2005-03-15',11,0,'','',1);
INSERT INTO `inst_turnos` VALUES (2,'',4,1,'2005-03-15',15,0,'','',1);
INSERT INTO `inst_turnos` VALUES (3,'Amadei',3,1,'2005-03-14',10,1,'---------','',6);
/*!40000 ALTER TABLE `inst_turnos` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `medias`
--

DROP TABLE IF EXISTS `medias`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `medias` (
  `idMedia` int(11) NOT NULL AUTO_INCREMENT,
  `descripcion` varchar(245) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `costo` varchar(245) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `venta` varchar(245) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `codigo` varchar(245) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  PRIMARY KEY (`idMedia`)
) ENGINE=MyISAM AUTO_INCREMENT=17 DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `medias`
--

LOCK TABLES `medias` WRITE;
/*!40000 ALTER TABLE `medias` DISABLE KEYS */;
INSERT INTO `medias` VALUES (1,'3/4 - 8/15 - MUJER','13.7','35','1050');
INSERT INTO `medias` VALUES (2,'7/8 - 8/15 - MUJER','25.2','47','1550');
INSERT INTO `medias` VALUES (3,'PANTY - 8/15','29.9','47','2052');
INSERT INTO `medias` VALUES (4,'MATERNITY','31.1','67','2051');
INSERT INTO `medias` VALUES (5,'3/4 - 15/20 - MUJER','17.9','35','1051');
INSERT INTO `medias` VALUES (6,'7/8 - 15/20 - MUJER','33.6','62','1551');
INSERT INTO `medias` VALUES (7,'PANTY - 15/20','37.3','72','2560');
INSERT INTO `medias` VALUES (8,'3/4 - 8/15 - HOMBRE','18.8','35','342');
INSERT INTO `medias` VALUES (9,'DEPORTIVO HOMBRE','23.2','43','539');
INSERT INTO `medias` VALUES (10,'VENDA 3 m.','5.58','15','');
INSERT INTO `medias` VALUES (11,'3/4 - 15/20 - HOMBRE','48.5','62','');
INSERT INTO `medias` VALUES (12,'VENDA 3 m 1/2','6.51','17','');
INSERT INTO `medias` VALUES (13,'VENDA 4 m','7.44','20','');
INSERT INTO `medias` VALUES (14,'VENDA 2 m','3.72','13','');
INSERT INTO `medias` VALUES (15,'ANTITROMBOTICA','32','61','');
INSERT INTO `medias` VALUES (16,'VENDAS 2,4','4.65','12','');
/*!40000 ALTER TABLE `medias` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `ventamedias`
--

DROP TABLE IF EXISTS `ventamedias`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8 */;
CREATE TABLE `ventamedias` (
  `idVentaMedia` int(11) NOT NULL AUTO_INCREMENT,
  `fecha` date NOT NULL DEFAULT '0000-00-00',
  `cliente` varchar(100) COLLATE utf8_unicode_ci NOT NULL DEFAULT '',
  `tipo` int(11) NOT NULL DEFAULT '0',
  `cantidad` int(11) NOT NULL DEFAULT '0',
  `profesional` int(11) NOT NULL DEFAULT '0',
  `liquidado` int(11) NOT NULL DEFAULT '0',
  PRIMARY KEY (`idVentaMedia`)
) ENGINE=MyISAM AUTO_INCREMENT=1092 DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ventamedias`
--

LOCK TABLES `ventamedias` WRITE;
/*!40000 ALTER TABLE `ventamedias` DISABLE KEYS */;
INSERT INTO `ventamedias` VALUES (26,'2003-11-04','FICO',1,1,2,1);
INSERT INTO `ventamedias` VALUES (27,'2003-11-04','ESTEVEZ',10,1,1,1);
INSERT INTO `ventamedias` VALUES (28,'2003-11-04','FERNANDEZ',3,1,1,1);
INSERT INTO `ventamedias` VALUES (29,'2003-11-04','ARAUJO',8,2,2,1);
/*!40000 ALTER TABLE `ventamedias` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2018-02-08 20:30:27
