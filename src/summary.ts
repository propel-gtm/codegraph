import type {
  DailyUsage,
  LatestModelInsight,
  ModelUsage,
  ParserStats,
  ProviderUsage,
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

function cloneModelUsage(model: ModelUsage): ModelUsage {
  return {
    name: model.name,
    tokens: cloneTokens(model.tokens),
  };
}

function cloneProviderUsage(providerUsage: ProviderUsage): ProviderUsage {
  return {
    provider: {
      id: providerUsage.provider.id,
      title: providerUsage.provider.title,
    },
    tokens: cloneTokens(providerUsage.tokens),
    models: providerUsage.models.map(cloneModelUsage),
  };
}

function compareProviderUsage(left: ProviderUsage, right: ProviderUsage): number {
  if (right.tokens.total !== left.tokens.total) {
    return right.tokens.total - left.tokens.total;
  }

  return left.provider.title.localeCompare(right.provider.title);
}

function buildProviderUsage(
  providerId: ProviderId,
  title: string,
  tokens: TokenTotals,
  modelTotals: Map<string, TokenTotals>,
): ProviderUsage {
  return {
    provider: {
      id: providerId,
      title,
    },
    tokens: cloneTokens(tokens),
    models: buildBreakdown(modelTotals),
  };
}

function summarizeDailyTotals(daily: DailyUsage[]): TokenTotals {
  return daily.reduce<TokenTotals>((accumulator, row) => {
    addTokens(accumulator, row);
    return accumulator;
  }, createEmptyTokens());
}

export function buildProviderUsageFromSummary(summary: UsageSummary): ProviderUsage {
  return {
    provider: {
      id: summary.provider.id,
      title: summary.provider.title,
    },
    tokens: summarizeDailyTotals(summary.daily),
    models: summary.breakdown.models.map(cloneModelUsage),
  };
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

function modelUsageForName(
  modelTotals: Map<string, TokenTotals>,
  modelName: string,
): ModelUsage | null {
  const tokens = modelTotals.get(modelName);

  if (!tokens) {
    return null;
  }

  return {
    name: modelName,
    tokens: cloneTokens(tokens),
  };
}

function latestModelTimestamp(value: LatestModelInsight | null | undefined): number {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }

  const timestamp = Date.parse(value.lastUsedAt);

  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

export function pickLatestModel(
  ...values: Array<LatestModelInsight | null | undefined>
): LatestModelInsight | null {
  let latest: LatestModelInsight | null = null;
  let latestTimestamp = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    const timestamp = latestModelTimestamp(value);

    if (timestamp < latestTimestamp) {
      continue;
    }

    latest = value ?? null;
    latestTimestamp = timestamp;
  }

  return latest;
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
  latestModel: LatestModelInsight | null,
  start: Date,
  end: Date,
  stats: ParserStats,
  providerBreakdown?: ProviderUsage[],
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
  const models = buildBreakdown(modelTotals);
  const providers =
    providerBreakdown && providerBreakdown.length > 0
      ? providerBreakdown
          .map(cloneProviderUsage)
          .sort(compareProviderUsage)
      : [buildProviderUsage(providerId, title, totals, modelTotals)];

  return {
    provider: {
      id: providerId,
      title,
    },
    start: formatLocalDate(start),
    end: formatLocalDate(end),
    daily,
    breakdown: {
      models,
      providers,
    },
    metrics: {
      last30Days: recentTotals.total,
      input: totals.input,
      output: totals.output,
      total: totals.total,
    },
    insights: {
      streaks: computeStreaks(daily),
      mostUsedModel: topModelUsage(modelTotals),
      recentMostUsedModel: latestModel
        ? modelUsageForName(modelTotals, latestModel.name)
        : topModelUsage(recentModelTotals),
      latestModel,
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

  const latestModel = pickLatestModel(
    ...summaries.map((summary) => summary.insights.latestModel),
  );
  const providerBreakdown = summaries
    .map(buildProviderUsageFromSummary)
    .sort(compareProviderUsage);

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
    latestModel,
    start,
    end,
    mergeStats(summaries),
    providerBreakdown,
  );
}
