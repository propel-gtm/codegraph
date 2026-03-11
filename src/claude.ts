import { createReadStream } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import readline from "node:readline";
import type {
  ClaudeRecord,
  ClaudeUsage,
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
  summarizeUsage,
} from "./summary.ts";
import {
  formatLocalDate,
  getRecentWindowStart,
  listFilesRecursive,
  normalizeModelName,
} from "./utils.ts";

interface ProcessContext {
  start: Date;
  end: Date;
  recentStart: Date;
  dailyByDate: Map<string, DailyAggregateEntry>;
  modelTotals: Map<string, TokenTotals>;
  recentModelTotals: Map<string, TokenTotals>;
  stats: ParserStats;
}

function getClaudeConfigRoots(claudeConfigDir?: string): string[] {
  if (claudeConfigDir?.trim()) {
    return [resolve(claudeConfigDir)];
  }

  if (process.env.CLAUDE_CONFIG_DIR?.trim()) {
    return [resolve(process.env.CLAUDE_CONFIG_DIR)];
  }

  return [join(homedir(), ".claude"), join(homedir(), ".config", "claude")];
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

async function processSessionFile(
  filePath: string,
  context: ProcessContext,
): Promise<void> {
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

      let record: ClaudeRecord;

      try {
        record = JSON.parse(line) as ClaudeRecord;
      } catch {
        context.stats.badLines += 1;
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

export async function loadClaudeUsage(
  options: LoadClaudeUsageOptions,
): Promise<UsageSummary | null> {
  const { start, end, claudeConfigDir } = options;
  const configRoots = [...new Set(getClaudeConfigRoots(claudeConfigDir))];
  const projectRoots = configRoots.map((root) => join(root, "projects"));
  const fileGroups = await Promise.all(
    projectRoots.map((projectRoot) => listFilesRecursive(projectRoot, ".jsonl")),
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
    stats: {
      sourceLabel: "Claude Code sessions",
      sourcePaths: projectRoots,
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
    "claude",
    "Claude Code",
    daily,
    context.modelTotals,
    context.recentModelTotals,
    start,
    end,
    context.stats,
  );
}
