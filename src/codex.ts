import { createReadStream } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import readline from "node:readline";
import type {
  CodexRawUsage,
  CodexRecord,
  LoadCodexUsageOptions,
  ParserStats,
  TokenTotals,
  UsageSummary,
} from "./types.ts";
import {
  addDailyUsage,
  addModelUsage,
  type DailyAggregateEntry,
  finalizeDailyRows,
  summarizeUsage,
} from "./summary.ts";
import {
  formatLocalDate,
  getRecentWindowStart,
  listFilesRecursive,
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
  stats: ParserStats;
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
  context: ProcessContext,
): Promise<void> {
  let currentModel = "unknown";
  let previousUsage: NormalizedUsage | null = null;

  try {
    const stream = createReadStream(filePath, { encoding: "utf8" });
    const lineReader = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    for await (const line of lineReader) {
      if (!line.trim()) {
        continue;
      }

      context.stats.linesScanned += 1;

      let record: CodexRecord;

      try {
        record = JSON.parse(line) as CodexRecord;
      } catch {
        context.stats.badLines += 1;
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

      addDailyUsage(context.dailyByDate, dateKey, modelName, tokens);
      addModelUsage(context.modelTotals, modelName, tokens);

      if (timestamp >= context.recentStart) {
        addModelUsage(context.recentModelTotals, modelName, tokens);
      }

      context.stats.eventsConsumed += 1;
    }
  } catch {
    context.stats.filesFailed += 1;
  }
}

export async function loadCodexUsage(
  options: LoadCodexUsageOptions,
): Promise<UsageSummary | null> {
  const { start, end, codexHome } = options;
  const resolvedCodexHome = codexHome?.trim()
    ? resolve(codexHome)
    : process.env.CODEX_HOME?.trim()
      ? resolve(process.env.CODEX_HOME)
      : join(homedir(), ".codex");
  const sessionRoot = join(resolvedCodexHome, "sessions");
  const files = await listFilesRecursive(sessionRoot, ".jsonl");
  const recentStart = getRecentWindowStart(end);
  const context: ProcessContext = {
    start,
    end,
    recentStart,
    dailyByDate: new Map<string, DailyAggregateEntry>(),
    modelTotals: new Map<string, TokenTotals>(),
    recentModelTotals: new Map<string, TokenTotals>(),
    stats: {
      sourceLabel: "Codex sessions",
      sourcePaths: [sessionRoot],
      filesScanned: files.length,
      filesFailed: 0,
      linesScanned: 0,
      badLines: 0,
      eventsConsumed: 0,
    },
  };

  for (const filePath of files) {
    await processSessionFile(filePath, context);
  }

  const daily = finalizeDailyRows(context.dailyByDate, start, end);

  if (!daily.some((row) => row.total > 0)) {
    return null;
  }

  return summarizeUsage(
    "codex",
    "Codex",
    daily,
    context.modelTotals,
    context.recentModelTotals,
    start,
    end,
    context.stats,
  );
}
