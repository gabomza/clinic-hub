# Coding Standards & Type Conventions

This document outlines the strict code style requirements for JavaScript, TypeScript, and React across the Fichas Project.

## TypeScript Types vs Interfaces

### Rule

Use `type` instead of `interface`, except when extension is needed.

### Rationale

The `type` keyword is more flexible, robust, and consistent for data shape definitions within our modern TypeScript environment.

### Exception

If an object definition explicitly needs to be extended by another object shape using the `extends` keyword, use `interface`.

### Code Examples

```typescript
// ❌ INCORRECT (Using interface for basic types)
interface MigrationConfig {
  dumpFilePath: string;
  databaseUrl: string;
}

// ✅ CORRECT (Use type for static definitions)
export type RawRow = Record<string, string | number | null>;
export type MigrationConfig = {
  dumpFilePath: string;
  databaseUrl: string;
};

// ✅ CORRECT (Use interface only when extending shapes)
export interface BaseEntity {
  id: number;
  createdAt: Date;
}

export interface Patient extends BaseEntity {
  name: string;
}
```
