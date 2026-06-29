# Code Conventions - clinic-hub Project

Rules that apply to the entire project (migration-script, Next.js app, and other modules).

---

## 🧠 Intent Classification Protocol (Kiro IDE Mode)

For every prompt, analyze my underlying intent before writing code. Determine if I am asking for an informal change or an architectural expansion. Route your response according to these two modes:

### 🚀 Mode A: Vibe Coding (Informal/Iterative Changes)

- **Trigger:** Small feature updates, quick styling changes, localized debugging, refactoring, or iterative prompt-tweaking.
- **Behavior:** Jump straight into editing the codebase. Do not require planning paperwork. Keep a rapid, highly conversational loop. Implement the requested edits immediately in the file tree while adhering to the project's documentation.

### 📝 Mode B: SDD (Specification-Driven Development)

- **Trigger:** Creation of a new feature from scratch, major architectural modifications, changes cutting across multiple modules, or requests that explicitly mention "spec", "plan", or "docs".
- **Behavior:** **HALT code execution immediately.** Execute the following SDD workflow before a single line of application code is touched:
  1. Check for the existence of a `docs/specs/` directory or a `.docs/` directory. Create it if missing.
  2. Draft or update a markdown architecture specification file mapping out the exact components, API boundaries, and data flow.
  3. Present this specification draft to me inside the chat panel.
  4. Wait for explicit user confirmation (e.g., "Looks good, implement it") before proceeding to generate the actual codebase files.

#### Parallel Agents Configuration for SDD Tasks:

- **Default Count:** 1 agent (recommended for controlled iteration, better change auditing, and consistency in the SDD workflow).
- **Scope:** Apply to `spec-requirements`, `spec-design`, `spec-tasks`, and `spec-impl`.
- **Exception:** Only use multiple agents (3+) if explicitly requested for a specific task.

---

## 📚 Extended Reference Documentation

When executing tasks, look up and read from these deep-dive files for specific implementation blueprints:

- **Coding Style & Patterns:** `docs/CODING_STANDARDS.md`
- **Folder & Module Architecture:** `docs/MODULE_ORGANIZATION.md`

---

## How to Contribute

When you discover a new convention or pattern that should be applied globally, update the relevant file in the `docs/` folder or edit this main file. Conventions evolve as we learn more about the project.
