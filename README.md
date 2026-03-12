# codegraph

`codegraph` is a Bun + TypeScript CLI package for local AI coding usage heatmaps.

By default, `codegraph` writes a PNG heatmap.
For a persistent local view, `codegraph --dashboard` starts a live dashboard that refreshes every 5 minutes.

## Supported providers

`codegraph` currently supports:

- Codex
- Claude Code
- merged `all` view across both providers

By default, `codegraph` runs with `--provider all`.

If both providers have data in the requested window, the result is merged.
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

## CLI reference

```bash
codegraph [--ytd | --last-365 | --year YYYY] [--provider codex|claude|all] [--format svg|png|json] [--output PATH]
codegraph --dashboard [--ytd | --last-365 | --year YYYY] [--provider codex|claude|all] [--host HOST] [--port PORT] [--refresh-minutes MINUTES]
```

Options:

- `--ytd`
  Render from January 1 of the current year through today.
- `--last-365`
  Render a rolling 365-day window through today.
- `--year YYYY`
  Render a specific calendar year.
- `--provider codex|claude|all`
  Choose a single provider or merge both. Default is `all`.
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
- `--help`
  Print usage information.

Rules:

- If no date mode is passed, `codegraph` defaults to YTD.
- `--ytd`, `--last-365`, and `--year` are mutually exclusive.
- `--dashboard` cannot be combined with `--format` or `--output`.
- If `--year` is the current year, the end date is clamped to today instead of rendering future empty days.
- Default output names depend on both the date window and provider.

## Dashboard mode

`codegraph --dashboard` starts a small local HTTP server and keeps running until you stop it.

Behavior:

- the browser view auto-refreshes every 5 minutes by default
- the server also refreshes its in-memory snapshot on the same cadence
- `Refresh now` forces an immediate reload without restarting the process
- `/api/dashboard` exposes the current dashboard state as JSON for local integrations

## Default output files

Merged `all` output:

- `codegraph-ytd.png`
- `codegraph-ytd.svg`
- `codegraph-ytd.json`
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
- `codegraph-last-365-codex.json`
- `codegraph-2025-claude.png`
- `codegraph-2025-claude.svg`

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
- `~/.claude/projects`
- `~/.config/claude/projects`

You can override that root with:

```bash
codegraph --provider claude --claude-config-dir /path/to/.claude
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
- zero-token Claude records are ignored
- model names are normalized the same way as Codex names

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

- bundled prices in the codebase for common Codex and Claude models
- cached LiteLLM pricing in `~/.codegraph/litellm-pricing.json`
- LiteLLM's published model cost map only when a model is still unknown

## JSON export shape

The JSON export contains:

- `version`
- `generatedAt`
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
```
