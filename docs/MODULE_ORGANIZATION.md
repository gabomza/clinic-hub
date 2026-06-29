# Module Organization & Directory Architecture

This document governs the file trees, public boundaries, and module access structures across the migration script and Next.js applications.

## Barrel Exports via index.ts

### Rule

`index.ts` files inside module folders must contain **ONLY** imports and re-exports. No application logic, database operations, or raw type definitions are allowed to live within an index file.

### Expected Directory Structure

Ensure your modules follow this strict encapsulation pattern:

src/config/
├── index.ts # Re-exports only
├── loader.ts # Contains loadConfig logic + validation
└── tests/
└── config.test.ts

src/parser/
├── index.ts # Re-exports only
├── dump.ts # Contains parser logic
└── tests/
└── parser.test.ts

### Correct `index.ts` Implementation Example

```typescript
// Inside src/config/index.ts
export type { MigrationConfig } from './loader';
export { loadConfig } from './loader';
```

### Technical Benefits

- **Clear Separation of Concerns:** Isolates operational code from architectural links.
- **Navigation Efficiency:** Easier to map and follow internal data mutations.
- **Refactoring Safeguards:** Allows internal file reassignments and renaming without breaking external imports.
- **Public Ports:** `index.ts` files act as well-defined, secure public ports for other codebase domains.
