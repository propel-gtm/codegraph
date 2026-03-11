#!/usr/bin/env bun

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadClaudeUsage } from "./claude.ts";
import { loadCodexUsage } from "./codex.ts";
import { renderHeatmapSvg } from "./heatmap.ts";
import { mergeUsageSummaries } from "./summary.ts";
import type { ProviderId, UsageSummary } from "./types.ts";
import {
  ensureParentDirectory,
  getCalendarYearDates,
  getLast365DaysDates,
  getYtdDates,
  inferFormat,
} from "./utils.ts";

const JSON_EXPORT_VERSION = "0.1.0";
const PROVIDERS: ProviderId[] = ["codex", "claude", "all"];

const HELP_TEXT = `codegraph

Generate a local AI coding usage heatmap from Codex and Claude Code session files.

Usage:
  codegraph [--ytd | --last-365 | --year YYYY] [--provider codex|claude|all] [--format svg|json] [--output ./codegraph-ytd.svg]

Options:
  --format, -f              Output format: svg or json
  --output, -o              Output path
  --provider                Provider selection: codex, claude, or all
  --ytd                     Render from January 1 of the current year through today
  --last-365                Render the last 365 days through today
  --year                    Render a calendar year (for example: --year 2025)
  --codex-home              Override the Codex home directory
  --claude-config-dir       Override the Claude config directory
  --help, -h                Show this help
`;

function printHelp(): void {
  process.stdout.write(HELP_TEXT);
}

function parseProvider(value?: string): ProviderId {
  const normalized = value?.trim().toLowerCase() ?? "all";

  if (PROVIDERS.includes(normalized as ProviderId)) {
    return normalized as ProviderId;
  }

  throw new Error(`Unsupported provider "${value}". Use codex, claude, or all.`);
}

function getDefaultLabel(year?: number, isLast365 = false): string {
  if (year) {
    return String(year);
  }

  return isLast365 ? "last-365" : "ytd";
}

function getDefaultOutputName(
  format: "svg" | "json",
  label: string,
  provider: ProviderId,
): string {
  const providerSuffix = provider === "all" ? "" : `-${provider}`;
  const extension = format === "json" ? "json" : "svg";

  return `./codegraph-${label}${providerSuffix}.${extension}`;
}

async function loadRequestedSummary(
  provider: ProviderId,
  start: Date,
  end: Date,
  codexHome?: string,
  claudeConfigDir?: string,
): Promise<UsageSummary | null> {
  const codexPromise =
    provider === "codex" || provider === "all"
      ? loadCodexUsage(
          codexHome
            ? { start, end, codexHome }
            : { start, end },
        )
      : Promise.resolve(null);
  const claudePromise =
    provider === "claude" || provider === "all"
      ? loadClaudeUsage(
          claudeConfigDir
            ? { start, end, claudeConfigDir }
            : { start, end },
        )
      : Promise.resolve(null);
  const [codexSummary, claudeSummary] = await Promise.all([
    codexPromise,
    claudePromise,
  ]);

  if (provider === "codex") {
    return codexSummary;
  }

  if (provider === "claude") {
    return claudeSummary;
  }

  return mergeUsageSummaries(
    [codexSummary, claudeSummary].filter(
      (summary): summary is UsageSummary => summary !== null,
    ),
    start,
    end,
  );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      format: { type: "string", short: "f" },
      output: { type: "string", short: "o" },
      provider: { type: "string" },
      ytd: { type: "boolean" },
      "last-365": { type: "boolean" },
      year: { type: "string" },
      "codex-home": { type: "string" },
      "claude-config-dir": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });

  if (values.help) {
    printHelp();
    return;
  }

  const selectedModes = [values.ytd, values["last-365"], Boolean(values.year)]
    .filter(Boolean).length;

  if (selectedModes > 1) {
    throw new Error("Use only one date mode: --ytd, --last-365, or --year.");
  }

  const provider = parseProvider(values.provider);
  const format = inferFormat(values.format, values.output);
  const selectedYear = values.year
    ? Number.parseInt(values.year, 10)
    : undefined;
  const isLast365 = values["last-365"] === true;
  const { start, end } = selectedYear
    ? getCalendarYearDates(selectedYear)
    : isLast365
      ? getLast365DaysDates()
      : getYtdDates();
  const defaultLabel = getDefaultLabel(selectedYear, isLast365);
  const defaultOutput = getDefaultOutputName(format, defaultLabel, provider);
  const outputPath = resolve(values.output ?? defaultOutput);
  const summary = await loadRequestedSummary(
    provider,
    start,
    end,
    values["codex-home"],
    values["claude-config-dir"],
  );

  if (summary === null) {
    if (provider === "all") {
      throw new Error(
        "No Codex or Claude Code usage data was found in the requested window.",
      );
    }

    throw new Error(
      `No ${provider === "claude" ? "Claude Code" : "Codex"} usage data was found in the requested window.`,
    );
  }

  await ensureParentDirectory(outputPath);

  if (format === "json") {
    await writeFile(
      outputPath,
      `${JSON.stringify(
        {
          version: JSON_EXPORT_VERSION,
          generatedAt: new Date().toISOString(),
          summary,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  } else {
    const svg = renderHeatmapSvg(summary);

    await writeFile(outputPath, `${svg}\n`, "utf8");
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        output: outputPath,
        format,
        provider: summary.provider.id,
        start: summary.start,
        end: summary.end,
        totalTokens: summary.metrics.total,
        activeDays: summary.daily.filter((row) => row.total > 0).length,
        filesScanned: summary.stats.filesScanned,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
