---
name: codegraph-guide
description: Use for work in this repository to enforce codegraph-specific commands and conventions.
---

Follow `AGENTS.md` as the primary repo contract for this repository.

Key reminders:

- Use `bun test`, `bun run typecheck`, `bun run build`, or `bun run check` for verification.
- Provider ingestion logic lives in `src/codex.ts`, `src/claude.ts`, and `src/vibe.ts`.
- Keep `README.md` and `test/` aligned with parser, CLI, and data-source discovery changes.
- Treat `dist/` as generated output.
