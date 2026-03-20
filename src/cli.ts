import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  getDefaultOutputName,
  loadRequestedSummaryOrThrow,
  parseProvider,
  resolveDateSelection,
} from "./codegraph.ts";
import { startDashboardServer } from "./dashboard.ts";
import { HELP_TEXT } from "./help.ts";
import { renderHeatmapPng, renderHeatmapSvg } from "./heatmap.ts";
import { buildJsonExport } from "./json-export.ts";
import { estimateUsageSpend } from "./pricing.ts";
import { getUpgradeNotice } from "./update.ts";
import {
  ensureParentDirectory,
  extractRollingWindowArgs,
  inferFormat,
} from "./utils.ts";

function printHelp(): void {
  process.stdout.write(HELP_TEXT);
}

function parseYear(value?: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    throw new Error("--year must be a 4-digit calendar year.");
  }

  return parsed;
}

function parsePort(value?: string): number {
  if (value === undefined) {
    return 4269;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error("--port must be an integer between 0 and 65535.");
  }

  return parsed;
}

function parseRefreshMinutes(value?: string): number {
  if (value === undefined) {
    return 5;
  }

  const parsed = Number.parseFloat(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("--refresh-minutes must be a positive number.");
  }

  return parsed;
}

async function main(): Promise<void> {
  const { normalizedArgs, lastDays } = extractRollingWindowArgs(process.argv.slice(2));
  const { values } = parseArgs({
    args: normalizedArgs,
    options: {
      format: { type: "string", short: "f" },
      output: { type: "string", short: "o" },
      provider: { type: "string" },
      dashboard: { type: "boolean" },
      host: { type: "string" },
      port: { type: "string" },
      "refresh-minutes": { type: "string" },
      ytd: { type: "boolean" },
      year: { type: "string" },
      "codex-home": { type: "string" },
      "claude-config-dir": { type: "string" },
      "vibe-home": { type: "string" },
      "grok-home": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });

  if (values.help) {
    printHelp();
    return;
  }

  const selectedModes = [
    values.ytd,
    lastDays !== undefined,
    Boolean(values.year),
  ].filter(Boolean).length;

  if (selectedModes > 1) {
    throw new Error(
      "Use only one date mode: --ytd, --last-N, or --year.",
    );
  }

  if (values.dashboard && (values.format || values.output)) {
    throw new Error("--dashboard does not support --format or --output.");
  }

  const provider = parseProvider(values.provider);
  const format = inferFormat(values.format, values.output);
  const selectedYear = parseYear(values.year);
  const { start, end, label } = resolveDateSelection(selectedYear, lastDays);

  if (values.dashboard) {
    const refreshMinutes = parseRefreshMinutes(values["refresh-minutes"]);
    const refreshIntervalMs = Math.round(refreshMinutes * 60_000);
    const handle = await startDashboardServer({
      end,
      host: values.host?.trim() || "127.0.0.1",
      port: parsePort(values.port),
      provider,
      refreshIntervalMs,
      start,
      label,
      ...(values["claude-config-dir"]
        ? { claudeConfigDir: values["claude-config-dir"] }
        : {}),
      ...(values["codex-home"]
        ? { codexHome: values["codex-home"] }
        : {}),
      ...(values["vibe-home"]
        ? { vibeHome: values["vibe-home"] }
        : {}),
      ...(values["grok-home"]
        ? { grokHome: values["grok-home"] }
        : {}),
    });
    const upgradeNotice = await getUpgradeNotice();

    process.stdout.write(
      `${JSON.stringify(
        {
          mode: "dashboard",
          provider,
          refreshMinutes,
          start: start.toISOString(),
          end: end.toISOString(),
          url: handle.url,
        },
        null,
        2,
      )}\n`,
    );

    if (upgradeNotice) {
      process.stderr.write(`${upgradeNotice}\n`);
    }

    return;
  }

  const defaultLabel = label;
  const defaultOutput = getDefaultOutputName(format, defaultLabel, provider);
  const outputPath = resolve(values.output ?? defaultOutput);
  const summary = await loadRequestedSummaryOrThrow(
    provider,
    start,
    end,
    values["codex-home"],
    values["claude-config-dir"],
    values["vibe-home"],
    values["grok-home"],
  );

  await ensureParentDirectory(outputPath);
  const spend = await estimateUsageSpend(summary);

  if (format === "json") {
    await writeFile(
      outputPath,
      `${JSON.stringify(buildJsonExport(summary, spend), null, 2)}\n`,
      "utf8",
    );
  } else if (format === "png") {
    const png = renderHeatmapPng(summary, { spend });

    await writeFile(outputPath, png);
  } else {
    const svg = renderHeatmapSvg(summary, { spend });

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

  const upgradeNotice = await getUpgradeNotice();

  if (upgradeNotice) {
    process.stderr.write(`${upgradeNotice}\n`);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
