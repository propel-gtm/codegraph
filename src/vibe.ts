import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type {
  LatestModelInsight,
  LoadVibeUsageOptions,
  ParserStats,
  TokenTotals,
  UsageSummary,
} from "./types.ts";
import {
  addDailyUsage,
  addModelUsage,
  type DailyAggregateEntry,
  finalizeDailyRows,
  pickLatestModel,
  summarizeUsage,
} from "./summary.ts";
import {
  formatLocalDate,
  getParserConcurrency,
  getRecentWindowStart,
  listFilesRecursive,
  mapWithConcurrency,
  normalizeModelName,
} from "./utils.ts";

interface VibeSessionStats {
  session_completion_tokens?: number;
  session_prompt_tokens?: number;
  session_total_llm_tokens?: number;
}

interface VibeSessionConfig {
  active_model?: string;
}

interface VibeSessionRecord {
  config?: VibeSessionConfig;
  end_time?: string;
  session_id?: string;
  start_time?: string;
  stats?: VibeSessionStats;
}

interface ProcessContext {
  start: Date;
  end: Date;
  recentStart: Date;
  dailyByDate: Map<string, DailyAggregateEntry>;
  modelTotals: Map<string, TokenTotals>;
  recentModelTotals: Map<string, TokenTotals>;
  latestModel: LatestModelInsight | null;
  stats: ParserStats;
}

interface FileProcessResult {
  dailyByDate: Map<string, DailyAggregateEntry>;
  modelTotals: Map<string, TokenTotals>;
  recentModelTotals: Map<string, TokenTotals>;
  latestModel: LatestModelInsight | null;
  stats: Pick<
    ParserStats,
    "filesFailed" | "linesScanned" | "badLines" | "eventsConsumed"
  >;
}

function getVibeRoots(vibeHome?: string): string[] {
  if (vibeHome?.trim()) {
    return [resolve(vibeHome)];
  }

  if (process.env.VIBE_HOME?.trim()) {
    return [resolve(process.env.VIBE_HOME)];
  }

  return [resolve(".vibe"), join(homedir(), ".vibe")];
}

function createResult(): FileProcessResult {
  return {
    dailyByDate: new Map<string, DailyAggregateEntry>(),
    modelTotals: new Map<string, TokenTotals>(),
    recentModelTotals: new Map<string, TokenTotals>(),
    latestModel: null,
    stats: {
      filesFailed: 0,
      linesScanned: 0,
      badLines: 0,
      eventsConsumed: 0,
    },
  };
}

function normalizeTokens(
  stats: VibeSessionStats | null | undefined,
): TokenTotals | null {
  if (!stats) {
    return null;
  }

  const input = Number(stats.session_prompt_tokens ?? 0);
  const output = Number(stats.session_completion_tokens ?? 0);
  const total = Number(stats.session_total_llm_tokens ?? input + output);

  if (
    !Number.isFinite(input) ||
    !Number.isFinite(output) ||
    !Number.isFinite(total)
  ) {
    return null;
  }

  const normalized: TokenTotals = {
    input,
    output,
    cache: {
      input: 0,
      output: 0,
    },
    total: total > 0 ? total : input + output,
  };

  return normalized.total > 0 ? normalized : null;
}

async function processSessionFile(
  filePath: string,
  context: Pick<ProcessContext, "start" | "end" | "recentStart">,
): Promise<FileProcessResult> {
  const result = createResult();

  try {
    const raw = await readFile(filePath, "utf8");

    result.stats.linesScanned = raw.length === 0 ? 0 : raw.split(/\r?\n/).length;

    const record = JSON.parse(raw) as VibeSessionRecord;
    const timestamp = new Date(record.end_time ?? record.start_time ?? "");

    if (
      Number.isNaN(timestamp.getTime()) ||
      timestamp < context.start ||
      timestamp > context.end
    ) {
      return result;
    }

    const tokens = normalizeTokens(record.stats);

    if (!tokens) {
      return result;
    }

    const modelName = normalizeModelName(record.config?.active_model);
    const dateKey = formatLocalDate(timestamp);

    addDailyUsage(result.dailyByDate, dateKey, modelName, tokens);
    addModelUsage(result.modelTotals, modelName, tokens);
    result.latestModel = pickLatestModel(
      result.latestModel,
      modelName === "unknown"
        ? null
        : {
            name: modelName,
            lastUsedAt: timestamp.toISOString(),
          },
    );

    if (timestamp >= context.recentStart) {
      addModelUsage(result.recentModelTotals, modelName, tokens);
    }

    result.stats.eventsConsumed += 1;
  } catch (error) {
    result.stats.filesFailed += 1;
    result.stats.badLines += error instanceof SyntaxError ? 1 : 0;
  }

  return result;
}

function mergeFileResult(
  context: ProcessContext,
  result: FileProcessResult,
): void {
  for (const [dateKey, entry] of result.dailyByDate) {
    for (const [modelName, tokens] of entry.models) {
      addDailyUsage(context.dailyByDate, dateKey, modelName, tokens);
    }
  }

  for (const [modelName, tokens] of result.modelTotals) {
    addModelUsage(context.modelTotals, modelName, tokens);
  }

  for (const [modelName, tokens] of result.recentModelTotals) {
    addModelUsage(context.recentModelTotals, modelName, tokens);
  }

  context.latestModel = pickLatestModel(context.latestModel, result.latestModel);
  context.stats.filesFailed += result.stats.filesFailed;
  context.stats.linesScanned += result.stats.linesScanned;
  context.stats.badLines += result.stats.badLines;
  context.stats.eventsConsumed += result.stats.eventsConsumed;
}

export async function loadVibeUsage(
  options: LoadVibeUsageOptions,
): Promise<UsageSummary | null> {
  const { start, end, vibeHome } = options;
  const roots = [...new Set(getVibeRoots(vibeHome))];
  const sessionRoots = roots.map((root) => join(root, "logs", "session"));
  const fileGroups = await Promise.all(
    sessionRoots.map((sessionRoot) => listFilesRecursive(sessionRoot, "meta.json")),
  );
  const files = fileGroups.flat();
  const recentStart = getRecentWindowStart(end);
  const context: ProcessContext = {
    start,
    end,
    recentStart,
    dailyByDate: new Map<string, DailyAggregateEntry>(),
    modelTotals: new Map<string, TokenTotals>(),
    recentModelTotals: new Map<string, TokenTotals>(),
    latestModel: null,
    stats: {
      sourceLabel: "Vibe sessions",
      sourcePaths: sessionRoots,
      filesScanned: files.length,
      filesFailed: 0,
      linesScanned: 0,
      badLines: 0,
      eventsConsumed: 0,
    },
  };

  const results = await mapWithConcurrency(
    files,
    getParserConcurrency(files.length),
    (filePath) => processSessionFile(filePath, context),
  );

  for (const result of results) {
    mergeFileResult(context, result);
  }

  const daily = finalizeDailyRows(context.dailyByDate, start, end);

  if (!daily.some((row) => row.total > 0)) {
    return null;
  }

  return summarizeUsage(
    "vibe",
    "Vibe",
    daily,
    context.modelTotals,
    context.recentModelTotals,
    context.latestModel,
    start,
    end,
    context.stats,
  );
}
