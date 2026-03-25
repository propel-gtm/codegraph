import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type {
  LatestModelInsight,
  LoadPropelUsageOptions,
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
  getRecentWindowStart,
  normalizeModelName,
} from "./utils.ts";

const execFileAsync = promisify(execFile);

interface PropelAuditEventRow {
  created_at: string;
  kind: string;
  payload: string;
}

interface ProcessContext {
  end: Date;
  recentStart: Date;
  start: Date;
  dailyByDate: Map<string, DailyAggregateEntry>;
  latestModel: LatestModelInsight | null;
  modelTotals: Map<string, TokenTotals>;
  recentModelTotals: Map<string, TokenTotals>;
  stats: ParserStats;
}

type NodeSqliteModule = typeof import("node:sqlite");

const TOKEN_FIELD_NAMES = [
  "cache_creation_input_tokens",
  "cache_read_input_tokens",
  "cached_input_tokens",
  "completion_tokens",
  "input_cache_creation_tokens",
  "input_cached_tokens",
  "input_tokens",
  "output_reasoning_tokens",
  "output_tokens",
  "prompt_tokens",
  "reasoning_output_tokens",
  "total_tokens",
  "cacheCreationInputTokens",
  "cacheReadInputTokens",
  "cachedInputTokens",
  "completionTokens",
  "inputCacheCreationTokens",
  "inputCachedTokens",
  "inputTokens",
  "outputReasoningTokens",
  "outputTokens",
  "promptTokens",
  "reasoningOutputTokens",
  "totalTokens",
];

let nodeSqliteModulePromise: Promise<NodeSqliteModule | null> | null = null;

export class PropelUsageDependencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PropelUsageDependencyError";
  }
}

function getPropelHome(propelHome?: string): string {
  if (propelHome?.trim()) {
    return resolve(propelHome);
  }

  if (process.env.PROPEL_HOME?.trim()) {
    return resolve(process.env.PROPEL_HOME);
  }

  return join(homedir(), ".propel");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getNumber(
  record: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return undefined;
}

function hasTokenFields(record: Record<string, unknown>): boolean {
  return TOKEN_FIELD_NAMES.some((key) => key in record);
}

function looksLikeClaudeModel(
  modelName: string,
  providerName: string | null | undefined,
): boolean {
  const normalizedModel = modelName.trim().toLowerCase();
  const normalizedProvider = String(providerName ?? "").trim().toLowerCase();

  return (
    normalizedModel.startsWith("claude") ||
    normalizedModel.startsWith("anthropic/claude") ||
    normalizedProvider === "anthropic"
  );
}

function normalizeUsage(
  usage: Record<string, unknown>,
  modelName: string,
  providerName: string | null | undefined,
): TokenTotals | null {
  if (!hasTokenFields(usage)) {
    return null;
  }

  const input = getNumber(usage, ["input_tokens", "inputTokens", "prompt_tokens", "promptTokens"]) ?? 0;
  const cachedInput = getNumber(usage, [
    "cached_input_tokens",
    "cache_read_input_tokens",
    "input_cached_tokens",
    "cachedInputTokens",
    "cacheReadInputTokens",
    "inputCachedTokens",
  ]) ?? 0;
  const cacheWrite = getNumber(usage, [
    "cache_creation_input_tokens",
    "input_cache_creation_tokens",
    "cacheCreationInputTokens",
    "inputCacheCreationTokens",
  ]) ?? 0;
  const outputBase = getNumber(usage, [
    "output_tokens",
    "completion_tokens",
    "outputTokens",
    "completionTokens",
  ]) ?? 0;
  const reasoningOutput = getNumber(usage, [
    "reasoning_output_tokens",
    "output_reasoning_tokens",
    "reasoningOutputTokens",
    "outputReasoningTokens",
  ]) ?? 0;
  const total = getNumber(usage, ["total_tokens", "totalTokens"]);

  if (
    !Number.isFinite(input) ||
    !Number.isFinite(cachedInput) ||
    !Number.isFinite(cacheWrite) ||
    !Number.isFinite(outputBase) ||
    !Number.isFinite(reasoningOutput)
  ) {
    return null;
  }

  const output = outputBase + reasoningOutput;
  const isClaude = looksLikeClaudeModel(modelName, providerName);
  const normalized: TokenTotals = {
    input: isClaude ? input + cachedInput : input,
    output: isClaude ? output + cacheWrite : output,
    cache: {
      input: cachedInput,
      output: cacheWrite,
    },
    total:
      total && total > 0
        ? total
        : input + cachedInput + cacheWrite + output,
  };

  return normalized.total > 0 ? normalized : null;
}

function extractModel(payload: Record<string, unknown>): string {
  const metadata = isRecord(payload.metadata) ? payload.metadata : null;
  const response = isRecord(payload.response) ? payload.response : null;
  const result = isRecord(payload.result) ? payload.result : null;

  return normalizeModelName(
    typeof payload.model === "string"
      ? payload.model
      : typeof payload.model_name === "string"
        ? payload.model_name
        : typeof response?.model === "string"
          ? response.model
          : typeof result?.model === "string"
            ? result.model
            : typeof metadata?.model === "string"
              ? metadata.model
              : undefined,
  );
}

function getUsageCandidates(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  const response = isRecord(payload.response) ? payload.response : null;
  const result = isRecord(payload.result) ? payload.result : null;
  const metadata = isRecord(payload.metadata) ? payload.metadata : null;
  const metrics = isRecord(payload.metrics) ? payload.metrics : null;

  return [
    payload.last_token_usage,
    payload.total_token_usage,
    payload.usage,
    payload.token_usage,
    payload.llm_usage,
    response?.usage,
    response?.token_usage,
    result?.usage,
    result?.token_usage,
    metrics?.usage,
    metrics,
    metadata?.usage,
    payload,
  ].filter(isRecord);
}

function extractTokens(payload: Record<string, unknown>, modelName: string): TokenTotals | null {
  const providerName =
    typeof payload.provider === "string"
      ? payload.provider
      : isRecord(payload.metadata) && typeof payload.metadata.provider === "string"
        ? payload.metadata.provider
        : undefined;

  for (const candidate of getUsageCandidates(payload)) {
    const tokens = normalizeUsage(candidate, modelName, providerName);

    if (tokens) {
      return tokens;
    }
  }

  return null;
}

async function importNodeSqlite(): Promise<NodeSqliteModule | null> {
  if (!nodeSqliteModulePromise) {
    nodeSqliteModulePromise = (async () => {
      const originalEmitWarning = process.emitWarning;

      try {
        process.emitWarning = (() => {}) as typeof process.emitWarning;
        return await import("node:sqlite");
      } catch {
        return null;
      } finally {
        process.emitWarning = originalEmitWarning;
      }
    })();
  }

  return nodeSqliteModulePromise;
}

async function queryAuditEventsWithNodeSqlite(
  dbPath: string,
  start: Date,
  end: Date,
): Promise<PropelAuditEventRow[] | null> {
  const sqlite = await importNodeSqlite();

  if (!sqlite) {
    return null;
  }

  const database = new sqlite.DatabaseSync(dbPath);

  try {
    const statement = database.prepare(`
      SELECT created_at, kind, payload
      FROM audit_events
      WHERE created_at >= ? AND created_at <= ?
      ORDER BY created_at ASC
    `);

    return (statement.all(start.toISOString(), end.toISOString()) as Array<Record<string, unknown>>)
      .flatMap((row) => {
        return typeof row.created_at === "string" &&
            typeof row.kind === "string" &&
            typeof row.payload === "string"
          ? [{
              created_at: row.created_at,
              kind: row.kind,
              payload: row.payload,
            }]
          : [];
      });
  } finally {
    database.close();
  }
}

function isMissingSqliteCliError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function buildCliQuery(start: Date, end: Date): string {
  return [
    "SELECT created_at, kind, payload",
    "FROM audit_events",
    `WHERE created_at >= '${start.toISOString()}' AND created_at <= '${end.toISOString()}'`,
    "ORDER BY created_at ASC;",
  ].join(" ");
}

async function queryAuditEventsWithSqliteCli(
  dbPath: string,
  start: Date,
  end: Date,
): Promise<PropelAuditEventRow[]> {
  try {
    const { stdout } = await execFileAsync(
      "sqlite3",
      ["-json", dbPath, buildCliQuery(start, end)],
      { maxBuffer: 10 * 1024 * 1024 },
    );

    if (!stdout.trim()) {
      return [];
    }

    const parsed = JSON.parse(stdout) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((row) => {
      if (!isRecord(row)) {
        return [];
      }

      return typeof row.created_at === "string" &&
          typeof row.kind === "string" &&
          typeof row.payload === "string"
        ? [{
            created_at: row.created_at,
            kind: row.kind,
            payload: row.payload,
          }]
        : [];
    });
  } catch (error) {
    if (isMissingSqliteCliError(error)) {
      throw new PropelUsageDependencyError(
        "Propel Code support requires Node's `node:sqlite` module or the `sqlite3` command to read ~/.propel/state.sqlite3.",
      );
    }

    throw error;
  }
}

async function queryAuditEvents(
  dbPath: string,
  start: Date,
  end: Date,
): Promise<PropelAuditEventRow[]> {
  const rows = await queryAuditEventsWithNodeSqlite(dbPath, start, end);

  if (rows) {
    return rows;
  }

  return queryAuditEventsWithSqliteCli(dbPath, start, end);
}

export function isPropelUsageDependencyError(error: unknown): boolean {
  return error instanceof PropelUsageDependencyError;
}

export async function loadPropelUsage(
  options: LoadPropelUsageOptions,
): Promise<UsageSummary | null> {
  const { start, end, propelHome } = options;
  const resolvedPropelHome = getPropelHome(propelHome);
  const dbPath = join(resolvedPropelHome, "state.sqlite3");

  if (!await pathExists(dbPath)) {
    return null;
  }

  const recentStart = getRecentWindowStart(end);
  const context: ProcessContext = {
    start,
    end,
    recentStart,
    dailyByDate: new Map<string, DailyAggregateEntry>(),
    latestModel: null,
    modelTotals: new Map<string, TokenTotals>(),
    recentModelTotals: new Map<string, TokenTotals>(),
    stats: {
      sourceLabel: "Propel Code",
      sourcePaths: [dbPath],
      filesScanned: 1,
      filesFailed: 0,
      linesScanned: 0,
      badLines: 0,
      eventsConsumed: 0,
    },
  };

  let rows: PropelAuditEventRow[];

  try {
    rows = await queryAuditEvents(dbPath, start, end);
  } catch (error) {
    context.stats.filesFailed = 1;

    if (isPropelUsageDependencyError(error)) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`Failed to read Propel Code usage from ${dbPath}: ${message}`);
  }

  context.stats.linesScanned = rows.length;

  for (const row of rows) {
    const timestamp = new Date(row.created_at);

    if (Number.isNaN(timestamp.getTime()) || timestamp < context.start || timestamp > context.end) {
      continue;
    }

    let payload: unknown;

    try {
      payload = JSON.parse(row.payload);
    } catch {
      context.stats.badLines += 1;
      continue;
    }

    if (!isRecord(payload)) {
      continue;
    }

    const modelName = extractModel(payload);
    const tokens = extractTokens(payload, modelName);

    if (!tokens || tokens.total <= 0) {
      continue;
    }

    const dateKey = formatLocalDate(timestamp);

    addDailyUsage(context.dailyByDate, dateKey, modelName, tokens);
    addModelUsage(context.modelTotals, modelName, tokens);
    context.latestModel = pickLatestModel(
      context.latestModel,
      modelName === "unknown"
        ? null
        : {
            name: modelName,
            lastUsedAt: timestamp.toISOString(),
          },
    );

    if (timestamp >= context.recentStart) {
      addModelUsage(context.recentModelTotals, modelName, tokens);
    }

    context.stats.eventsConsumed += 1;
  }

  const daily = finalizeDailyRows(context.dailyByDate, start, end);

  if (!daily.some((row) => row.total > 0)) {
    return null;
  }

  return summarizeUsage(
    "propel",
    "Propel Code",
    daily,
    context.modelTotals,
    context.recentModelTotals,
    context.latestModel,
    start,
    end,
    context.stats,
  );
}
