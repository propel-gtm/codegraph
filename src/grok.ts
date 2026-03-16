import { createReadStream } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import readline from "node:readline";
import type {
  CodexRawUsage,
  CodexRecord,
  LatestModelInsight,
  LoadGrokUsageOptions,
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

interface NormalizedUsage {
  input: number;
  cachedInput: number;
  output: number;
  total: number;
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

function normalizeUsage(
  value: CodexRawUsage | null | undefined,
): NormalizedUsage | null {
  if (!value) {
    return null;
  }

  const input = Number(value.input_tokens ?? 0);
  const cachedInput = Number(
    value.cached_input_tokens ?? value.cache_read_input_tokens ?? 0,
  );
  const output =
    Number(value.output_tokens ?? 0) +
    Number(value.reasoning_output_tokens ?? 0);
  const total = Number(value.total_tokens ?? input + output);

  if (
    !Number.isFinite(input) ||
    !Number.isFinite(cachedInput) ||
    !Number.isFinite(output) ||
    !Number.isFinite(total)
  ) {
    return null;
  }

  return {
    input,
    cachedInput,
    output,
    total,
  };
}

function subtractUsage(
  current: NormalizedUsage,
  previous: NormalizedUsage,
): NormalizedUsage {
  return {
    input: Math.max(current.input - previous.input, 0),
    cachedInput: Math.max(current.cachedInput - previous.cachedInput, 0),
    output: Math.max(current.output - previous.output, 0),
    total: Math.max(current.total - previous.total, 0),
  };
}

function usageToTokens(usage: NormalizedUsage): TokenTotals {
  return {
    input: usage.input,
    output: usage.output,
    cache: {
      input: usage.cachedInput,
      output: 0,
    },
    total: usage.total > 0 ? usage.total : usage.input + usage.output,
  };
}

function extractRecordModel(record: CodexRecord | null | undefined): string {
  const payload = record?.payload;

  return normalizeModelName(
    payload?.model ??
      payload?.model_name ??
      payload?.info?.model ??
      payload?.info?.model_name ??
      payload?.metadata?.model ??
      payload?.info?.metadata?.model,
  );
}

async function processSessionFile(
  filePath: string,
  context: Pick<ProcessContext, "start" | "end" | "recentStart">,
): Promise<FileProcessResult> {
  let currentModel = "unknown";
  let previousUsage: NormalizedUsage | null = null;
  const result: FileProcessResult = {
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

  try {
    const stream = createReadStream(filePath, { encoding: "utf8" });
    const lineReader = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    for await (const line of lineReader) {
      if (line.length === 0) {
        continue;
      }

      result.stats.linesScanned += 1;

      if (
        !line.includes("\"turn_context\"") &&
        !line.includes("\"token_count\"")
      ) {
        continue;
      }

      let record: CodexRecord;

      try {
        record = JSON.parse(line) as CodexRecord;
      } catch {
        result.stats.badLines += 1;
        continue;
      }

      const discoveredModel = extractRecordModel(record);

      if (record.type === "turn_context" && discoveredModel !== "unknown") {
        currentModel = discoveredModel;
      }

      if (
        record.type !== "event_msg" ||
        record.payload?.type !== "token_count" ||
        !record.timestamp
      ) {
        continue;
      }

      if (discoveredModel !== "unknown") {
        currentModel = discoveredModel;
      }

      const timestamp = new Date(record.timestamp);

      if (Number.isNaN(timestamp.getTime())) {
        continue;
      }

      const totalUsage = normalizeUsage(record.payload?.info?.total_token_usage);
      const lastUsage = normalizeUsage(record.payload?.info?.last_token_usage);
      const currentUsage = totalUsage ?? lastUsage;

      if (!currentUsage) {
        continue;
      }

      const deltaUsage = previousUsage
        ? subtractUsage(currentUsage, previousUsage)
        : (lastUsage ?? currentUsage);

      previousUsage = currentUsage;

      if (deltaUsage.total <= 0 || timestamp < context.start || timestamp > context.end) {
        continue;
      }

      const modelName = currentModel || "unknown";
      const tokens = usageToTokens(deltaUsage);
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
    }
  } catch {
    result.stats.filesFailed += 1;
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

export async function loadGrokUsage(
  options: LoadGrokUsageOptions,
): Promise<UsageSummary | null> {
  const { start, end, grokHome } = options;
  const resolvedGrokHome = grokHome?.trim()
    ? resolve(grokHome)
    : process.env.GROK_HOME?.trim()
      ? resolve(process.env.GROK_HOME)
      : join(homedir(), ".grok-code");
  const sessionRoot = join(resolvedGrokHome, "sessions");
  const files = await listFilesRecursive(sessionRoot, ".jsonl");
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
      sourceLabel: "Grok Code",
      sourcePaths: [sessionRoot],
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
    "grok",
    "Grok Code",
    daily,
    context.modelTotals,
    context.recentModelTotals,
    context.latestModel,
    start,
    end,
    context.stats,
  );
}
