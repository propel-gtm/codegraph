# codegraph

`codegraph` is a Bun + TypeScript CLI package for local AI coding usage heatmaps.

By default, `codegraph` writes a PNG heatmap.
For a persistent local view, `codegraph --dashboard` starts a live dashboard that refreshes every 5 minutes.

## Supported providers

`codegraph` currently supports:

- Codex
- Claude Code
- Vibe
- Grok Code
- merged `all` view across all detected providers

By default, `codegraph` runs with `--provider all`.

If multiple providers have data in the requested window, the result is merged.
If only one provider has data, the result falls back to that provider.
If neither provider has data, the CLI exits with an error.

## Install

Use without installing:

```bash
npx @propel-code/codegraph --help
```

Install globally:

```bash
npm install -g @propel-code/codegraph
codegraph --help
```

Use with Bun:

```bash
bunx @propel-code/codegraph --help
```

For local development, clone the repository and install dependencies:

```bash
git clone https://github.com/propel-gtm/codegraph.git
cd codegraph
bun install
```

## Quickstart

Generate the default YTD PNG using all available providers:

```bash
codegraph
```

Start the persistent YTD dashboard on `http://127.0.0.1:4269`:

```bash
codegraph --dashboard
```

Start the dashboard with a custom refresh cadence:

```bash
codegraph --dashboard --refresh-minutes 10
```

Generate a merged last-365 PNG:

```bash
codegraph --last-365
```

Generate a rolling last-30-day PNG:

```bash
codegraph --last-30
```

Generate a custom date-range PNG:

```bash
codegraph --start-date 2026-02-18 --end-date 2026-03-20
```

Generate a specific calendar year:

```bash
codegraph --year 2025
```

Generate Codex-only output:

```bash
codegraph --provider codex
```

Generate Claude-only output:

```bash
codegraph --provider claude
```

Generate Vibe-only output:

```bash
codegraph --provider vibe
```

Generate Grok-only output:

```bash
codegraph --provider grok
```

Generate JSON instead of the default PNG:

```bash
codegraph --format json
```

Generate SVG instead of the default PNG:

```bash
codegraph --format svg
```

Write to a custom file:

```bash
codegraph --provider all --year 2025 --output ./out/codegraph-2025.png
```

Show help:

```bash
codegraph --help
```

## Fixture-backed example

This repository includes a small checked-in fixture bundle under
`test/fixtures` plus a normalized example export at
`examples/fixture-export-all.json`.

The smoke test loads those fixtures through the same public summary and JSON
export APIs the CLI uses, then validates the checked-in example file
byte-for-byte after normalizing machine-specific fields such as absolute
fixture paths and local timestamp formatting.

Excerpt:

```json
{
  "version": "0.3.0",
  "generatedAt": "2026-03-05T00:00:00.000Z",
  "summary": {
    "provider": {
      "id": "all",
      "title": "Codex + Claude Code + Vibe + Grok Code"
    },
    "metrics": {
      "input": 410,
      "output": 135,
      "total": 545
    }
  },
  "spend": null
}
```

The checked-in example keeps `spend` as `null` so it stays deterministic
without depending on cached or fetched pricing data.

## CLI reference

```bash
codegraph [--ytd | --last-N | --year YYYY | --start-date YYYY-MM-DD --end-date YYYY-MM-DD] [--provider codex|claude|vibe|grok|all] [--format svg|png|json] [--output PATH]
codegraph --dashboard [--ytd | --last-N | --year YYYY | --start-date YYYY-MM-DD --end-date YYYY-MM-DD] [--provider codex|claude|vibe|grok|all] [--host HOST] [--port PORT] [--refresh-minutes MINUTES]
```

Options:

- `--ytd`
  Render from January 1 of the current year through today.
- `--last-N`
  Render a rolling `N`-day window through today. Examples: `--last-30`, `--last-365`.
- `--year YYYY`
  Render a specific calendar year.
- `--start-date YYYY-MM-DD`
  Render from an explicit start date. Requires `--end-date`.
- `--end-date YYYY-MM-DD`
  Render through an explicit end date. Requires `--start-date`.
- `--provider codex|claude|vibe|grok|all`
  Choose a single provider or merge all available providers. Default is `all`.
- `--dashboard`
  Start a persistent local dashboard server instead of writing a file.
- `--host HOST`
  Dashboard bind host. Default is `127.0.0.1`.
- `--port PORT`
  Dashboard bind port. Default is `4269`.
- `--refresh-minutes MINUTES`
  Browser refresh cadence for dashboard mode. Default is `5`.
- `--format svg|png|json`
  Output SVG, PNG, or JSON. Default is inferred from `--output`, otherwise `png`.
- `--output PATH`
  Override the output file location.
- `--codex-home PATH`
  Override the Codex data directory.
- `--claude-config-dir PATH`
  Override the Claude config directory.
- `--vibe-home PATH`
  Override the Vibe home directory.
- `--grok-home PATH`
  Override the Grok Code home directory.
- `--help`
  Print usage information.

Rules:

- If no date mode is passed, `codegraph` defaults to YTD.
- `--ytd`, `--last-N`, `--year`, and explicit `--start-date` + `--end-date` ranges are mutually exclusive.
- `--start-date` and `--end-date` must be passed together.
- `--dashboard` cannot be combined with `--format` or `--output`.
- If `--year` is the current year, the end date is clamped to today instead of rendering future empty days.
- Default output names depend on both the date window and provider.

## Dashboard mode

`codegraph --dashboard` starts a small local HTTP server and keeps running until you stop it.

Behavior:

- the browser view auto-refreshes every 5 minutes by default
- the server also refreshes its in-memory snapshot on the same cadence
- `Refresh now` forces an immediate reload without restarting the process
- `/api/dashboard` exposes JSON with `refreshError`, `refreshIntervalMs`, and a `snapshot` payload for local integrations

## Default output files

Merged `all` output:

- `codegraph-ytd.png`
- `codegraph-ytd.svg`
- `codegraph-ytd.json`
- `codegraph-last-30.png`
- `codegraph-last-30.svg`
- `codegraph-last-30.json`
- `codegraph-2026-02-18-to-2026-03-20.png`
- `codegraph-last-365.png`
- `codegraph-last-365.svg`
- `codegraph-last-365.json`
- `codegraph-2025.png`
- `codegraph-2025.svg`
- `codegraph-2025.json`

Single-provider output adds the provider suffix:

- `codegraph-ytd-codex.png`
- `codegraph-ytd-codex.svg`
- `codegraph-ytd-claude.png`
- `codegraph-ytd-claude.svg`
- `codegraph-last-30-codex.json`
- `codegraph-2026-02-18-to-2026-03-20-codex.json`
- `codegraph-ytd-vibe.png`
- `codegraph-ytd-grok.png`
- `codegraph-last-365-codex.json`
- `codegraph-2025-claude.png`
- `codegraph-2025-claude.svg`
- `codegraph-2025-vibe.json`

## Data sources

### Codex

`codegraph` reads Codex session files from:

- `$CODEX_HOME/sessions`
- `~/.codex/sessions` if `CODEX_HOME` is not set

You can override that root with:

```bash
codegraph --provider codex --codex-home /path/to/.codex
```

### Claude Code

`codegraph` reads Claude Code session files from:

- `$CLAUDE_CONFIG_DIR/projects`
- `./.claude/projects`
- `~/.claude/projects`
- `~/.config/claude/projects`

If present, `codegraph` also uses Claude session metadata from the matching
`usage-data/session-meta` directories as a fallback when a session is not represented
by a project log.

You can override that root with:

```bash
codegraph --provider claude --claude-config-dir /path/to/.claude
```

### Vibe

`codegraph` reads Vibe session metadata from:

- `$VIBE_HOME/logs/session`
- `./.vibe/logs/session`
- `~/.vibe/logs/session`

You can override that root with:

```bash
codegraph --provider vibe --vibe-home /path/to/.vibe
```

### Grok Code

`codegraph` reads Grok Code session files from:

- `$GROK_HOME/sessions`
- `~/.grok-code/sessions`

You can override that root with:

```bash
codegraph --provider grok --grok-home /path/to/.grok-code
```

## Aggregation behavior

### Codex parsing

`codegraph` treats Codex `event_msg` records with `payload.type === "token_count"` as the source of truth.

Behavior:

- if `total_token_usage` is present, it is treated as cumulative usage
- repeated status events are de-duplicated by subtracting the previous cumulative total
- if `last_token_usage` is present on the first relevant event, that value is used directly
- model names are normalized to remove trailing date suffixes such as `-20251101`

### Claude Code parsing

`codegraph` reads Claude assistant message usage from `message.usage`.

Behavior:

- `input` includes `input_tokens + cache_read_input_tokens`
- `output` includes `output_tokens + cache_creation_input_tokens`
- cache tokens are preserved in `cache.input` and `cache.output`
- `usage-data/session-meta/*.json` is used as a fallback source when a session is missing from `projects/`
- zero-token Claude records are ignored
- model names are normalized the same way as Codex names

### Vibe parsing

`codegraph` reads Vibe session metadata from each session's `meta.json`.

Behavior:

- `input` uses `stats.session_prompt_tokens`
- `output` uses `stats.session_completion_tokens`
- totals use `stats.session_total_llm_tokens` when present
- activity is attributed to `end_time`, falling back to `start_time`
- model names come from `config.active_model`

### Merged provider behavior

When `--provider all` is used:

- daily totals are merged by date
- model totals are merged by model name
- last-30-day totals are recomputed from the merged daily rows
- parser stats are summed across providers

## What the Heatmap Shows

- Monday-first contribution-style heatmap
- theoretical token spend using LiteLLM model pricing
- total tokens in the last 30 days
- cumulative input tokens
- cumulative output tokens
- most-used model
- latest model
- longest streak
- current streak

Pricing data is resolved in this order:

- bundled prices in the codebase for common supported models
- cached LiteLLM pricing in `~/.codegraph/litellm-pricing.json`
- LiteLLM's published model cost map only when a model is still unknown

## JSON export shape

The JSON export contains:

- `version`
- `generatedAt`
- `spend`
- `summary.provider`
- `summary.start`
- `summary.end`
- `summary.daily[]`
- `summary.metrics`
- `summary.insights`
- `summary.stats`

`summary.insights` includes:

- `mostUsedModel`
- `recentMostUsedModel`
  This now reflects the most recently used model, with total tokens for that model in the selected window.
- `latestModel`
  This retains the raw timestamped latest-model record used to derive recency.
- `streaks`

`spend` includes:

- `totalUsd`
- `pricedModels`
- `unpricedModels[]`

If `unpricedModels` is non-empty, `totalUsd` reflects only the models with resolved pricing.

Each daily row contains:

- `date`
- `input`
- `output`
- `cache.input`
- `cache.output`
- `total`
- `breakdown[]`

Each `summary.stats` object contains:

- `sourceLabel`
- `sourcePaths[]`
- `filesScanned`
- `filesFailed`
- `linesScanned`
- `badLines`
- `eventsConsumed`

## Project structure

- `src/cli.ts`
  CLI argument parsing, provider selection, date-range selection, and file output.
- `src/bin.ts`
  Node-facing executable wrapper for published installs.
- `src/codex.ts`
  Codex session scanning and token aggregation.
- `src/claude.ts`
  Claude Code session scanning and token aggregation.
- `src/vibe.ts`
  Vibe session scanning and token aggregation.
- `src/summary.ts`
  Shared daily/model aggregation and merged-summary utilities.
- `src/update.ts`
  Package version checks for published CLI installs.
- `src/heatmap.ts`
  SVG rendering and PNG export.
- `src/utils.ts`
  Shared date, formatting, and filesystem helpers.
- `src/types.ts`
  Shared TypeScript types.
- `tsconfig.build.json`
  Emit configuration for the publishable `dist/` CLI build.

## Development

Run tests:

```bash
bun test
```

Run static typechecking:

```bash
bun run typecheck
```

Run the CLI during development:

```bash
bun run start -- --provider all --ytd
```

Disable update checks:

```bash
CODEGRAPH_DISABLE_UPDATE_CHECK=1 codegraph --help
```

## Verification

Typical verification loop:

```bash
bun run typecheck
bun test
bun run build
npx @propel-code/codegraph --help
node dist/cli.js --provider codex --ytd
node dist/cli.js --provider all --last-365
node dist/cli.js --provider claude --year 2025 --format json
node dist/cli.js --provider vibe --ytd --format json
```
