import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import readline from "node:readline";
import type {
  ClaudeRecord,
  ClaudeUsage,
  LatestModelInsight,
  LoadClaudeUsageOptions,
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
  sessionId: string | null;
  stats: Pick<
    ParserStats,
    "filesFailed" | "linesScanned" | "badLines" | "eventsConsumed"
  >;
}

interface ClaudeSessionMetaRecord {
  input_tokens?: number;
  model?: string;
  model_name?: string;
  output_tokens?: number;
  session_id?: string;
  start_time?: string;
}

function getClaudeConfigRoots(claudeConfigDir?: string): string[] {
  if (claudeConfigDir?.trim()) {
    return [resolve(claudeConfigDir)];
  }

  if (process.env.CLAUDE_CONFIG_DIR?.trim()) {
    return [resolve(process.env.CLAUDE_CONFIG_DIR)];
  }

  return [
    resolve(".claude"),
    join(homedir(), ".claude"),
    join(homedir(), ".config", "claude"),
  ];
}

function createResult(sessionId: string | null = null): FileProcessResult {
  return {
    dailyByDate: new Map<string, DailyAggregateEntry>(),
    modelTotals: new Map<string, TokenTotals>(),
    recentModelTotals: new Map<string, TokenTotals>(),
    latestModel: null,
    sessionId,
    stats: {
      filesFailed: 0,
      linesScanned: 0,
      badLines: 0,
      eventsConsumed: 0,
    },
  };
}

function extractSessionId(filePath: string, extension: ".json" | ".jsonl"): string {
  return basename(filePath, extension);
}

function normalizeClaudeUsage(
  usage: ClaudeUsage | null | undefined,
): TokenTotals | null {
  if (!usage) {
    return null;
  }

  const input = Number(usage.input_tokens ?? 0);
  const output = Number(usage.output_tokens ?? 0);
  const cacheReadInput = Number(usage.cache_read_input_tokens ?? 0);
  const cacheCreationInput = Number(usage.cache_creation_input_tokens ?? 0);

  if (
    !Number.isFinite(input) ||
    !Number.isFinite(output) ||
    !Number.isFinite(cacheReadInput) ||
    !Number.isFinite(cacheCreationInput)
  ) {
    return null;
  }

  const normalized: TokenTotals = {
    input: input + cacheReadInput,
    output: output + cacheCreationInput,
    cache: {
      input: cacheReadInput,
      output: cacheCreationInput,
    },
    total: input + output + cacheReadInput + cacheCreationInput,
  };

  return normalized.total > 0 ? normalized : null;
}

function normalizeClaudeMetaUsage(
  record: ClaudeSessionMetaRecord | null | undefined,
): TokenTotals | null {
  if (!record) {
    return null;
  }

  const input = Number(record.input_tokens ?? 0);
  const output = Number(record.output_tokens ?? 0);

  if (!Number.isFinite(input) || !Number.isFinite(output)) {
    return null;
  }

  const normalized: TokenTotals = {
    input,
    output,
    cache: {
      input: 0,
      output: 0,
    },
    total: input + output,
  };

  return normalized.total > 0 ? normalized : null;
}

async function processProjectSessionFile(
  filePath: string,
  context: Pick<ProcessContext, "start" | "end" | "recentStart">,
): Promise<FileProcessResult> {
  const result = createResult(extractSessionId(filePath, ".jsonl"));

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

      if (!line.includes("\"usage\"")) {
        continue;
      }

      let record: ClaudeRecord;

      try {
        record = JSON.parse(line) as ClaudeRecord;
      } catch {
        result.stats.badLines += 1;
        continue;
      }

      if (!record.timestamp) {
        continue;
      }

      const timestamp = new Date(record.timestamp);

      if (
        Number.isNaN(timestamp.getTime()) ||
        timestamp < context.start ||
        timestamp > context.end
      ) {
        continue;
      }

      const tokens = normalizeClaudeUsage(record.message?.usage);

      if (!tokens) {
        continue;
      }

      const modelName = normalizeModelName(record.message?.model);
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

async function processSessionMetaFile(
  filePath: string,
  context: Pick<ProcessContext, "start" | "end" | "recentStart">,
): Promise<FileProcessResult> {
  const result = createResult(extractSessionId(filePath, ".json"));

  try {
    const raw = await readFile(filePath, "utf8");

    result.stats.linesScanned = raw.length === 0 ? 0 : raw.split(/\r?\n/).length;

    const record = JSON.parse(raw) as ClaudeSessionMetaRecord;
    const timestamp = new Date(record.start_time ?? "");

    result.sessionId = record.session_id?.trim() || result.sessionId;

    if (
      Number.isNaN(timestamp.getTime()) ||
      timestamp < context.start ||
      timestamp > context.end
    ) {
      return result;
    }

    const tokens = normalizeClaudeMetaUsage(record);

    if (!tokens) {
      return result;
    }

    const modelName = normalizeModelName(record.model ?? record.model_name);
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

export async function loadClaudeUsage(
  options: LoadClaudeUsageOptions,
): Promise<UsageSummary | null> {
  const { start, end, claudeConfigDir } = options;
  const configRoots = [...new Set(getClaudeConfigRoots(claudeConfigDir))];
  const projectRoots = configRoots.map((root) => join(root, "projects"));
  const sessionMetaRoots = configRoots.map((root) =>
    join(root, "usage-data", "session-meta"),
  );
  const projectFileGroups = await Promise.all(
    projectRoots.map((projectRoot) => listFilesRecursive(projectRoot, ".jsonl")),
  );
  const sessionMetaFileGroups = await Promise.all(
    sessionMetaRoots.map((sessionMetaRoot) =>
      listFilesRecursive(sessionMetaRoot, ".json"),
    ),
  );
  const projectFiles = projectFileGroups.flat();
  const sessionMetaFiles = sessionMetaFileGroups.flat();
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
      sourceLabel: "Claude Code",
      sourcePaths: [...projectRoots, ...sessionMetaRoots],
      filesScanned: projectFiles.length + sessionMetaFiles.length,
      filesFailed: 0,
      linesScanned: 0,
      badLines: 0,
      eventsConsumed: 0,
    },
  };

  const projectResults = await mapWithConcurrency(
    projectFiles,
    getParserConcurrency(projectFiles.length),
    (filePath) => processProjectSessionFile(filePath, context),
  );

  for (const result of projectResults) {
    mergeFileResult(context, result);
  }

  const projectSessionIdsWithUsage = new Set(
    projectResults.flatMap((result) =>
      result.sessionId && result.stats.eventsConsumed > 0 ? [result.sessionId] : [],
    ),
  );
  const fallbackSessionMetaFilesById = new Map<string, string>();

  for (const filePath of sessionMetaFiles) {
    const sessionId = extractSessionId(filePath, ".json");

    if (
      projectSessionIdsWithUsage.has(sessionId) ||
      fallbackSessionMetaFilesById.has(sessionId)
    ) {
      continue;
    }

    fallbackSessionMetaFilesById.set(sessionId, filePath);
  }

  const sessionMetaResults = await mapWithConcurrency(
    [...fallbackSessionMetaFilesById.values()],
    getParserConcurrency(fallbackSessionMetaFilesById.size),
    (filePath) => processSessionMetaFile(filePath, context),
  );

  for (const result of sessionMetaResults) {
    mergeFileResult(context, result);
  }

  const daily = finalizeDailyRows(context.dailyByDate, start, end);

  if (!daily.some((row) => row.total > 0)) {
    return null;
  }

  return summarizeUsage(
    "claude",
    "Claude Code",
    daily,
    context.modelTotals,
    context.recentModelTotals,
    context.latestModel,
    start,
    end,
    context.stats,
  );
}
