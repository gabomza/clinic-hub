# Convenciones de Código - Fichas Project

Reglas que aplican a todo el proyecto (migration-script, Next.js app, y otros módulos).

## TypeScript Types vs Interfaces

**Regla:** Usar `type` en lugar de `interface`, excepto cuando sea necesario extender.

**Justificación:** `type` es más flexible y consistente para definiciones de formas de datos.

**Excepción:** Si una definición necesita ser extendida por otra (usando `extends`), usar `interface`.

**Ejemplos:**

```typescript
// ✅ Usar type (no se extiende)
export type RawRow = Record<string, string | number | null>;
export type MigrationConfig = {
  dumpFilePath: string;
  databaseUrl: string;
};

// ✅ Usar interface (se extiende)
export interface BaseEntity {
  id: number;
  createdAt: Date;
}

export interface Patient extends BaseEntity {
  name: string;
}
```

---

## Organización de Módulos

**Regla:** Los archivos `index.ts` en carpetas de módulos deben contener SOLO imports y re-exports. Ninguna lógica o definiciones de tipos debe vivir allí.

**Estructura esperada:**

```
src/config/
├── index.ts           # Solo re-exports
├── loader.ts          # Lógica de loadConfig + validación
└── __tests__/
    └── config.test.ts

src/parser/
├── index.ts           # Solo re-exports
├── dump.ts            # Lógica del parser
└── __tests__/
    └── parser.test.ts
```

**Ejemplo de index.ts correcto:**

```typescript
// src/config/index.ts
export type { MigrationConfig } from './loader';
export { loadConfig } from './loader';
```

**Ventajas:**
- Separación clara de responsabilidades
- Facilita navegar la estructura del código
- Permite reasignaciones de archivos sin cambiar imports externos
- Los index.ts actúan como puertos públicos bien definidos

---

---

## Preferencias de Spec-Driven Development

**Agents paralelos para tareas de especificación:** 1 (recomendado)
- Razón: iteración controlada, mejor auditoría de cambios, consistencia en el workflow SDD
- Aplicar a: `spec-requirements`, `spec-design`, `spec-tasks`, `spec-impl`
- Excepción: solo usar múltiples agentes (3+) si el usuario lo pide explícitamente para una tarea

---

## Cómo Contribuir

Cuando descubras una nueva convención o patrón que deba aplicarse globalmente, actualiza este archivo. Las convenciones evolucionan según aprendemos más sobre el proyecto.
