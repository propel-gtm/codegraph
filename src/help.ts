import { PROVIDERS } from "./codegraph.ts";

const providerOptionList = PROVIDERS.join("|");

export const HELP_TEXT = `codegraph

Generate a local AI coding usage heatmap from Codex, Claude Code, Vibe, and Grok Code session files.

Usage:
  codegraph [--ytd | --last-365 | --year YYYY] [--provider ${providerOptionList}] [--format svg|png|json] [--output ./codegraph-ytd.png]
  codegraph --dashboard [--ytd | --last-365 | --year YYYY] [--provider ${providerOptionList}] [--port 4269] [--refresh-minutes 5]

Options:
  --format, -f              Output format: svg, png, or json
  --output, -o              Output path
  --provider                Provider selection: ${providerOptionList}
  --dashboard               Start a persistent local dashboard server
  --host                    Dashboard host (default: 127.0.0.1)
  --port                    Dashboard port (default: 4269)
  --refresh-minutes         Dashboard refresh cadence in minutes (default: 5)
  --ytd                     Render from January 1 of the current year through today
  --last-365                Render the last 365 days through today
  --year                    Render a calendar year (for example: --year 2025)
  --codex-home              Override the Codex home directory
  --claude-config-dir       Override the Claude config directory
  --vibe-home               Override the Vibe home directory
  --grok-home               Override the Grok Code home directory
  --help, -h                Show this help
`;
