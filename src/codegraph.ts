import { loadClaudeUsage } from "./claude.ts";
import { loadCodexUsage } from "./codex.ts";
import { mergeUsageSummaries } from "./summary.ts";
import type { OutputFormat, ProviderId, UsageSummary } from "./types.ts";
import {
  getCalendarYearDates,
  getLast365DaysDates,
  getYtdDates,
} from "./utils.ts";

export interface DateSelection {
  end: Date;
  label: string;
  start: Date;
}

export const PROVIDERS: ProviderId[] = ["codex", "claude", "all"];

export function parseProvider(value?: string): ProviderId {
  const normalized = value?.trim().toLowerCase() ?? "all";

  if (PROVIDERS.includes(normalized as ProviderId)) {
    return normalized as ProviderId;
  }

  throw new Error(`Unsupported provider "${value}". Use codex, claude, or all.`);
}

function getDefaultLabel(year?: number, isLast365 = false): string {
  if (year !== undefined) {
    return String(year);
  }

  return isLast365 ? "last-365" : "ytd";
}

export function resolveDateSelection(
  selectedYear?: number,
  isLast365 = false,
): DateSelection {
  const { start, end } =
    selectedYear !== undefined
      ? getCalendarYearDates(selectedYear)
      : isLast365
        ? getLast365DaysDates()
        : getYtdDates();

  return {
    end,
    label: getDefaultLabel(selectedYear, isLast365),
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
      "No Codex or Claude Code usage data was found in the requested window.",
    );
  }

  return new Error(
    `No ${provider === "claude" ? "Claude Code" : "Codex"} usage data was found in the requested window.`,
  );
}

export async function loadRequestedSummary(
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

export async function loadRequestedSummaryOrThrow(
  provider: ProviderId,
  start: Date,
  end: Date,
  codexHome?: string,
  claudeConfigDir?: string,
): Promise<UsageSummary> {
  const summary = await loadRequestedSummary(
    provider,
    start,
    end,
    codexHome,
    claudeConfigDir,
  );

  if (!summary) {
    throw createMissingUsageError(provider);
  }

  return summary;
}
