import type {
  DailyUsage,
  ModelUsage,
  ParserStats,
  ProviderId,
  TokenTotals,
  UsageSummary,
} from "./types.ts";
import {
  addTokens,
  buildDateRange,
  cloneTokens,
  createEmptyTokens,
  formatLocalDate,
  getRecentWindowStart,
} from "./utils.ts";

export interface DailyAggregateEntry {
  tokens: TokenTotals;
  models: Map<string, TokenTotals>;
}

function getDailyEntry(
  dailyByDate: Map<string, DailyAggregateEntry>,
  dateKey: string,
): DailyAggregateEntry {
  let entry = dailyByDate.get(dateKey);

  if (!entry) {
    entry = {
      tokens: createEmptyTokens(),
      models: new Map<string, TokenTotals>(),
    };
    dailyByDate.set(dateKey, entry);
  }

  return entry;
}

export function addModelUsage(
  modelTotals: Map<string, TokenTotals>,
  modelName: string,
  tokens: TokenTotals,
): void {
  const existing = modelTotals.get(modelName) ?? createEmptyTokens();

  addTokens(existing, tokens);
  modelTotals.set(modelName, existing);
}

export function addDailyUsage(
  dailyByDate: Map<string, DailyAggregateEntry>,
  dateKey: string,
  modelName: string,
  tokens: TokenTotals,
): void {
  const entry = getDailyEntry(dailyByDate, dateKey);

  addTokens(entry.tokens, tokens);
  addModelUsage(entry.models, modelName, tokens);
}

function buildBreakdown(modelTotals: Map<string, TokenTotals>): ModelUsage[] {
  return [...modelTotals.entries()]
    .sort((left, right) => right[1].total - left[1].total)
    .map(([name, tokens]) => ({
      name,
      tokens: cloneTokens(tokens),
    }));
}

function topModelUsage(
  modelTotals: Map<string, TokenTotals>,
): ModelUsage | null {
  const bestEntry = [...modelTotals.entries()].sort(
    (left, right) => right[1].total - left[1].total,
  )[0];

  if (!bestEntry) {
    return null;
  }

  const [name, tokens] = bestEntry;

  return {
    name,
    tokens: cloneTokens(tokens),
  };
}

function computeStreaks(
  daily: DailyUsage[],
): UsageSummary["insights"]["streaks"] {
  let longest = 0;
  let running = 0;

  for (const row of daily) {
    if (row.total > 0) {
      running += 1;
      longest = Math.max(longest, running);
      continue;
    }

    running = 0;
  }

  let current = 0;

  for (let index = daily.length - 1; index >= 0; index -= 1) {
    const row = daily[index];

    if (!row || row.total <= 0) {
      break;
    }

    current += 1;
  }

  return { longest, current };
}

export function finalizeDailyRows(
  dailyByDate: Map<string, DailyAggregateEntry>,
  start: Date,
  end: Date,
): DailyUsage[] {
  const allDays = buildDateRange(start, end);

  return allDays.map((date) => {
    const entry = dailyByDate.get(date);
    const tokens = entry?.tokens ?? createEmptyTokens();

    return {
      date,
      input: tokens.input,
      output: tokens.output,
      cache: {
        input: tokens.cache.input,
        output: tokens.cache.output,
      },
      total: tokens.total,
      breakdown: entry ? buildBreakdown(entry.models) : [],
    };
  });
}

export function summarizeUsage(
  providerId: ProviderId,
  title: string,
  daily: DailyUsage[],
  modelTotals: Map<string, TokenTotals>,
  recentModelTotals: Map<string, TokenTotals>,
  start: Date,
  end: Date,
  stats: ParserStats,
): UsageSummary {
  const totals = daily.reduce<TokenTotals>((accumulator, row) => {
    addTokens(accumulator, row);
    return accumulator;
  }, createEmptyTokens());
  const recentStart = getRecentWindowStart(end);
  const recentStartKey = formatLocalDate(recentStart);
  const recentTotals = daily.reduce<TokenTotals>((accumulator, row) => {
    if (row.date >= recentStartKey) {
      addTokens(accumulator, row);
    }

    return accumulator;
  }, createEmptyTokens());

  return {
    provider: {
      id: providerId,
      title,
    },
    start: formatLocalDate(start),
    end: formatLocalDate(end),
    daily,
    metrics: {
      last30Days: recentTotals.total,
      input: totals.input,
      output: totals.output,
      total: totals.total,
    },
    insights: {
      streaks: computeStreaks(daily),
      mostUsedModel: topModelUsage(modelTotals),
      recentMostUsedModel: topModelUsage(recentModelTotals),
    },
    stats,
  };
}

function mergeProviderTitle(summaries: UsageSummary[]): string {
  const titles = summaries.map((summary) => summary.provider.title);

  return titles.join(" + ");
}

function mergeStats(summaries: UsageSummary[]): ParserStats {
  const sourceLabel = summaries.map((summary) => summary.stats.sourceLabel).join(" + ");
  const sourcePaths = summaries.flatMap((summary) => summary.stats.sourcePaths);

  return {
    sourceLabel,
    sourcePaths,
    filesScanned: summaries.reduce(
      (total, summary) => total + summary.stats.filesScanned,
      0,
    ),
    filesFailed: summaries.reduce(
      (total, summary) => total + summary.stats.filesFailed,
      0,
    ),
    linesScanned: summaries.reduce(
      (total, summary) => total + summary.stats.linesScanned,
      0,
    ),
    badLines: summaries.reduce((total, summary) => total + summary.stats.badLines, 0),
    eventsConsumed: summaries.reduce(
      (total, summary) => total + summary.stats.eventsConsumed,
      0,
    ),
  };
}

export function mergeUsageSummaries(
  summaries: UsageSummary[],
  start: Date,
  end: Date,
): UsageSummary | null {
  if (summaries.length === 0) {
    return null;
  }

  if (summaries.length === 1) {
    return summaries[0] ?? null;
  }

  const dailyByDate = new Map<string, DailyAggregateEntry>();
  const modelTotals = new Map<string, TokenTotals>();
  const recentModelTotals = new Map<string, TokenTotals>();
  const recentStartKey = formatLocalDate(getRecentWindowStart(end));

  for (const summary of summaries) {
    for (const day of summary.daily) {
      for (const entry of day.breakdown) {
        addDailyUsage(dailyByDate, day.date, entry.name, entry.tokens);
        addModelUsage(modelTotals, entry.name, entry.tokens);

        if (day.date >= recentStartKey) {
          addModelUsage(recentModelTotals, entry.name, entry.tokens);
        }
      }
    }
  }

  return summarizeUsage(
    "all",
    mergeProviderTitle(summaries),
    finalizeDailyRows(dailyByDate, start, end),
    modelTotals,
    recentModelTotals,
    start,
    end,
    mergeStats(summaries),
  );
}
