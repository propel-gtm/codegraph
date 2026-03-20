import { loadClaudeUsage } from "./claude.ts";
import { loadCodexUsage } from "./codex.ts";
import { loadGrokUsage } from "./grok.ts";
import { loadVibeUsage } from "./vibe.ts";
import { mergeUsageSummaries } from "./summary.ts";
import type { OutputFormat, ProviderId, UsageSummary } from "./types.ts";
import {
  getCalendarYearDates,
  getCustomDateRangeDates,
  getLastNDaysDates,
  getYtdDates,
} from "./utils.ts";

export interface DateSelection {
  end: Date;
  label: string;
  start: Date;
}

export interface ResolveDateSelectionOptions {
  endDate?: string;
  lastDays?: number;
  selectedYear?: number;
  startDate?: string;
}

export const PROVIDERS: ProviderId[] = ["codex", "claude", "vibe", "grok", "all"];

export function parseProvider(value?: string): ProviderId {
  const normalized = value?.trim().toLowerCase() ?? "all";

  if (PROVIDERS.includes(normalized as ProviderId)) {
    return normalized as ProviderId;
  }

  throw new Error(`Unsupported provider "${value}". Use codex, claude, vibe, grok, or all.`);
}

function getDefaultLabel({
  selectedYear,
  lastDays,
  startDate,
  endDate,
}: ResolveDateSelectionOptions): string {
  if (selectedYear !== undefined) {
    return String(selectedYear);
  }

  if (startDate !== undefined && endDate !== undefined) {
    return `${startDate}-to-${endDate}`;
  }

  return lastDays !== undefined ? `last-${lastDays}` : "ytd";
}

export function resolveDateSelection(
  options: ResolveDateSelectionOptions = {},
): DateSelection {
  const {
    selectedYear,
    lastDays,
    startDate,
    endDate,
  } = options;

  if ((startDate === undefined) !== (endDate === undefined)) {
    throw new Error("Use both --start-date and --end-date together.");
  }

  const { start, end } =
    startDate !== undefined && endDate !== undefined
      ? getCustomDateRangeDates(startDate, endDate)
      :
    selectedYear !== undefined
      ? getCalendarYearDates(selectedYear)
      : lastDays !== undefined
        ? getLastNDaysDates(lastDays)
        : getYtdDates();

  return {
    end,
    label: getDefaultLabel(options),
    start,
  };
}

export function getDefaultOutputName(
  format: OutputFormat,
  label: string,
  provider: ProviderId,
): string {
  const providerSuffix = provider === "all" ? "" : `-${provider}`;

  return `./codegraph-${label}${providerSuffix}.${format}`;
}

export function createMissingUsageError(provider: ProviderId): Error {
  if (provider === "all") {
    return new Error(
      "No Codex, Claude Code, Vibe, or Grok Code usage data was found in the requested window.",
    );
  }

  const name =
    provider === "claude"
      ? "Claude Code"
      : provider === "vibe"
        ? "Vibe"
        : provider === "grok"
          ? "Grok Code"
          : "Codex";

  return new Error(`No ${name} usage data was found in the requested window.`);
}

export async function loadRequestedSummary(
  provider: ProviderId,
  start: Date,
  end: Date,
  codexHome?: string,
  claudeConfigDir?: string,
  vibeHome?: string,
  grokHome?: string,
): Promise<UsageSummary | null> {
  const codexPromise =
    provider === "codex" || provider === "all"
      ? loadCodexUsage(codexHome ? { start, end, codexHome } : { start, end })
      : Promise.resolve(null);
  const claudePromise =
    provider === "claude" || provider === "all"
      ? loadClaudeUsage(claudeConfigDir ? { start, end, claudeConfigDir } : { start, end })
      : Promise.resolve(null);
  const vibePromise =
    provider === "vibe" || provider === "all"
      ? loadVibeUsage(vibeHome ? { start, end, vibeHome } : { start, end })
      : Promise.resolve(null);
  const grokPromise =
    provider === "grok" || provider === "all"
      ? loadGrokUsage(grokHome ? { start, end, grokHome } : { start, end })
      : Promise.resolve(null);
  const [codexSummary, claudeSummary, vibeSummary, grokSummary] = await Promise.all([
    codexPromise,
    claudePromise,
    vibePromise,
    grokPromise,
  ]);

  if (provider === "codex") {
    return codexSummary;
  }

  if (provider === "claude") {
    return claudeSummary;
  }

  if (provider === "vibe") {
    return vibeSummary;
  }

  if (provider === "grok") {
    return grokSummary;
  }

  return mergeUsageSummaries(
    [codexSummary, claudeSummary, vibeSummary, grokSummary].filter(
      (summary): summary is UsageSummary => summary !== null,
    ),
    start,
    end,
  );
}

export async function loadRequestedSummaryOrThrow(
  provider: ProviderId,
  start: Date,
  end: Date,
  codexHome?: string,
  claudeConfigDir?: string,
  vibeHome?: string,
  grokHome?: string,
): Promise<UsageSummary> {
  const summary = await loadRequestedSummary(
    provider,
    start,
    end,
    codexHome,
    claudeConfigDir,
    vibeHome,
    grokHome,
  );

  if (!summary) {
    throw createMissingUsageError(provider);
  }

  return summary;
}
