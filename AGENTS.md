# Codegraph Agent Guide

Use this file as the root contract for working in this repository.

## Project Overview

- `codegraph` is a Bun + TypeScript CLI that reads local AI coding usage and renders heatmaps, JSON summaries, or a live dashboard.
- The main entrypoints are `src/cli.ts` for CLI parsing, `src/codegraph.ts` for provider orchestration, and `src/dashboard.ts` for dashboard mode.
- Provider-specific ingestion lives in `src/codex.ts`, `src/claude.ts`, and `src/vibe.ts`.

## Repository Map

- `src/`: CLI, provider loaders, aggregation, rendering, dashboard, update checks, and shared utilities.
- `test/`: Bun tests covering loaders, summaries, pricing, dashboard output, and utilities.
- `README.md`: user-facing CLI, data source, and behavior documentation.
- `dist/`: build output generated from `src/`. Do not hand-edit generated files.

## Working Rules

- Prefer small, targeted changes over broad refactors.
- Keep parser behavior changes aligned across source, tests, and `README.md`.
- When changing CLI flags, defaults, output naming, or data source discovery, update the matching documentation in the same change.
- Add or update focused tests when loader or aggregation behavior changes.
- Reuse shared helpers in `src/summary.ts` and `src/utils.ts` instead of duplicating aggregation or normalization logic.

## Commands

- `bun test`
- `bun run typecheck`
- `bun run build`
- `bun run check`

## Implementation Notes

- Use Bun for local development commands unless there is a specific reason not to.
- Keep provider discovery logic explicit and easy to audit; avoid hidden fallbacks that are not documented.
- Normalize model names and token totals consistently with existing helpers so provider summaries stay comparable.
