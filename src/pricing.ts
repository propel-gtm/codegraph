import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { ModelUsage, TokenTotals, UsageSummary } from "./types.ts";

interface LiteLLMPriceEntry {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
}

type LiteLLMPriceMap = Record<string, LiteLLMPriceEntry>;

interface PricingCache {
  fetchedAt: string;
  pricing: LiteLLMPriceMap;
  sourceUrl: string;
}

export interface UsageSpendEstimate {
  totalUsd: number;
  pricedModels: number;
  unpricedModels: string[];
}

const LITELLM_PRICING_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const PRICING_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PRICING_CACHE_FILENAME = "litellm-pricing.json";

// Bundled fallback snapshot in LiteLLM's pricing schema for common Codex/Claude models.
const BUNDLED_PRICE_MAP: LiteLLMPriceMap = {
  "gpt-5": {
    input_cost_per_token: 1.25 / 1_000_000,
    output_cost_per_token: 10 / 1_000_000,
    cache_read_input_token_cost: 0.125 / 1_000_000,
    cache_creation_input_token_cost: 1.25 / 1_000_000,
  },
  "gpt-5.2": {
    input_cost_per_token: 1.75 / 1_000_000,
    output_cost_per_token: 14 / 1_000_000,
    cache_read_input_token_cost: 0.175 / 1_000_000,
    cache_creation_input_token_cost: 1.75 / 1_000_000,
  },
  "gpt-5.4": {
    input_cost_per_token: 2.5 / 1_000_000,
    output_cost_per_token: 15 / 1_000_000,
    cache_read_input_token_cost: 0.25 / 1_000_000,
    cache_creation_input_token_cost: 2.5 / 1_000_000,
  },
  "claude-sonnet-3.5": {
    input_cost_per_token: 3 / 1_000_000,
    output_cost_per_token: 15 / 1_000_000,
    cache_read_input_token_cost: 0.3 / 1_000_000,
    cache_creation_input_token_cost: 3.75 / 1_000_000,
  },
  "claude-sonnet-3.7": {
    input_cost_per_token: 3 / 1_000_000,
    output_cost_per_token: 15 / 1_000_000,
    cache_read_input_token_cost: 0.3 / 1_000_000,
    cache_creation_input_token_cost: 3.75 / 1_000_000,
  },
  "claude-sonnet-4": {
    input_cost_per_token: 3 / 1_000_000,
    output_cost_per_token: 15 / 1_000_000,
    cache_read_input_token_cost: 0.3 / 1_000_000,
    cache_creation_input_token_cost: 3.75 / 1_000_000,
  },
  "claude-sonnet-4-5": {
    input_cost_per_token: 3 / 1_000_000,
    output_cost_per_token: 15 / 1_000_000,
    cache_read_input_token_cost: 0.3 / 1_000_000,
    cache_creation_input_token_cost: 3.75 / 1_000_000,
  },
  "claude-opus-4": {
    input_cost_per_token: 15 / 1_000_000,
    output_cost_per_token: 75 / 1_000_000,
    cache_read_input_token_cost: 1.5 / 1_000_000,
    cache_creation_input_token_cost: 18.75 / 1_000_000,
  },
  "claude-opus-4-1": {
    input_cost_per_token: 15 / 1_000_000,
    output_cost_per_token: 75 / 1_000_000,
    cache_read_input_token_cost: 1.5 / 1_000_000,
    cache_creation_input_token_cost: 18.75 / 1_000_000,
  },
  "claude-haiku-3": {
    input_cost_per_token: 0.25 / 1_000_000,
    output_cost_per_token: 1.25 / 1_000_000,
    cache_read_input_token_cost: 0.03 / 1_000_000,
    cache_creation_input_token_cost: 0.3 / 1_000_000,
  },
  "claude-haiku-3.5": {
    input_cost_per_token: 0.8 / 1_000_000,
    output_cost_per_token: 4 / 1_000_000,
    cache_read_input_token_cost: 0.08 / 1_000_000,
    cache_creation_input_token_cost: 1 / 1_000_000,
  },
};

function getPricingSourceUrl(): string {
  return process.env.CODEGRAPH_LITELLM_PRICING_URL?.trim() || LITELLM_PRICING_URL;
}

function getPricingCachePath(): string {
  const baseDir =
    process.env.CODEGRAPH_CACHE_DIR?.trim() || join(homedir(), ".codegraph");

  return join(baseDir, PRICING_CACHE_FILENAME);
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizePriceEntry(value: unknown): LiteLLMPriceEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const inputCost = toFiniteNumber(record.input_cost_per_token);
  const outputCost = toFiniteNumber(record.output_cost_per_token);
  const cacheReadCost = toFiniteNumber(record.cache_read_input_token_cost);
  const cacheCreationCost = toFiniteNumber(
    record.cache_creation_input_token_cost,
  );

  if (
    inputCost === undefined &&
    outputCost === undefined &&
    cacheReadCost === undefined &&
    cacheCreationCost === undefined
  ) {
    return null;
  }

  return {
    ...(inputCost === undefined
      ? {}
      : { input_cost_per_token: inputCost }),
    ...(outputCost === undefined
      ? {}
      : { output_cost_per_token: outputCost }),
    ...(cacheReadCost === undefined
      ? {}
      : { cache_read_input_token_cost: cacheReadCost }),
    ...(cacheCreationCost === undefined
      ? {}
      : { cache_creation_input_token_cost: cacheCreationCost }),
  };
}

function parsePriceMap(value: unknown): LiteLLMPriceMap | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const normalized = Object.entries(value).reduce<LiteLLMPriceMap>(
    (result, [key, entry]) => {
      const normalizedEntry = normalizePriceEntry(entry);

      if (normalizedEntry) {
        result[key] = normalizedEntry;
      }

      return result;
    },
    {},
  );

  return Object.keys(normalized).length > 0 ? normalized : null;
}

async function readPricingCache(): Promise<PricingCache | null> {
  try {
    const raw = await readFile(getPricingCachePath(), "utf8");
    const parsed = JSON.parse(raw) as PricingCache;

    if (
      typeof parsed?.fetchedAt !== "string" ||
      typeof parsed?.sourceUrl !== "string"
    ) {
      return null;
    }

    const pricing = parsePriceMap(parsed.pricing);

    if (!pricing) {
      return null;
    }

    return {
      fetchedAt: parsed.fetchedAt,
      sourceUrl: parsed.sourceUrl,
      pricing,
    };
  } catch {
    return null;
  }
}

async function writePricingCache(value: PricingCache): Promise<void> {
  try {
    const cachePath = getPricingCachePath();

    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  } catch {
    // Cache writes are best-effort and should not block rendering.
  }
}

async function fetchPricingMap(): Promise<LiteLLMPriceMap | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(getPricingSourceUrl(), {
      headers: {
        accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    return parsePriceMap(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function mergePricingMaps(...maps: Array<LiteLLMPriceMap | null | undefined>): LiteLLMPriceMap {
  return maps.reduce<LiteLLMPriceMap>((result, current) => {
    if (current) {
      Object.assign(result, current);
    }

    return result;
  }, {});
}

function createEmptyTokens(): TokenTotals {
  return {
    input: 0,
    output: 0,
    cache: {
      input: 0,
      output: 0,
    },
    total: 0,
  };
}

function aggregateSummaryModels(summary: UsageSummary): ModelUsage[] {
  const totalsByModel = new Map<string, TokenTotals>();

  for (const day of summary.daily) {
    for (const model of day.breakdown) {
      const existing = totalsByModel.get(model.name) ?? createEmptyTokens();

      existing.input += model.tokens.input;
      existing.output += model.tokens.output;
      existing.cache.input += model.tokens.cache.input;
      existing.cache.output += model.tokens.cache.output;
      existing.total += model.tokens.total;
      totalsByModel.set(model.name, existing);
    }
  }

  return [...totalsByModel.entries()].map(([name, tokens]) => ({
    name,
    tokens,
  }));
}

export async function loadLiteLLMPricing(): Promise<LiteLLMPriceMap> {
  const sourceUrl = getPricingSourceUrl();
  const cached = await readPricingCache();
  const now = Date.now();
  const cachedAt = cached ? Date.parse(cached.fetchedAt) : Number.NaN;
  const cacheIsFresh =
    cached?.sourceUrl === sourceUrl &&
    Number.isFinite(cachedAt) &&
    now - cachedAt < PRICING_CACHE_TTL_MS;

  if (cacheIsFresh) {
    return mergePricingMaps(BUNDLED_PRICE_MAP, cached?.pricing);
  }

  if (process.env.CODEGRAPH_DISABLE_LITELLM_FETCH === "1") {
    return mergePricingMaps(BUNDLED_PRICE_MAP, cached?.pricing);
  }

  const pricing = await fetchPricingMap();

  if (pricing) {
    await writePricingCache({
      fetchedAt: new Date(now).toISOString(),
      pricing,
      sourceUrl,
    });

    return mergePricingMaps(BUNDLED_PRICE_MAP, pricing);
  }

  return mergePricingMaps(BUNDLED_PRICE_MAP, cached?.pricing);
}

function buildCandidateModelKeys(modelName: string): string[] {
  const normalized = modelName.trim().toLowerCase();

  if (!normalized) {
    return [];
  }

  const candidates = new Set<string>();
  const baseName = normalized.includes("/")
    ? normalized.split("/", 2)[1] ?? normalized
    : normalized;

  candidates.add(normalized);
  candidates.add(baseName);
  candidates.add(`openai/${baseName}`);
  candidates.add(`anthropic/${baseName}`);

  if (baseName.startsWith("gpt-5.4")) {
    candidates.add("gpt-5.4");
    candidates.add("openai/gpt-5.4");
  } else if (baseName.startsWith("gpt-5.2")) {
    candidates.add("gpt-5.2");
    candidates.add("openai/gpt-5.2");
  } else if (baseName.startsWith("gpt-5")) {
    candidates.add("gpt-5");
    candidates.add("openai/gpt-5");
  }

  if (baseName.startsWith("claude-sonnet-4-5")) {
    candidates.add("claude-sonnet-4-5");
    candidates.add("anthropic/claude-sonnet-4-5");
    candidates.add("claude-sonnet-4");
    candidates.add("anthropic/claude-sonnet-4");
  } else if (baseName.startsWith("claude-sonnet-4")) {
    candidates.add("claude-sonnet-4");
    candidates.add("anthropic/claude-sonnet-4");
  } else if (baseName.startsWith("claude-sonnet-3.7")) {
    candidates.add("claude-sonnet-3.7");
    candidates.add("anthropic/claude-sonnet-3.7");
  } else if (baseName.startsWith("claude-sonnet-3.5")) {
    candidates.add("claude-sonnet-3.5");
    candidates.add("anthropic/claude-sonnet-3.5");
  } else if (baseName.startsWith("claude-opus-4-1")) {
    candidates.add("claude-opus-4-1");
    candidates.add("anthropic/claude-opus-4-1");
    candidates.add("claude-opus-4");
    candidates.add("anthropic/claude-opus-4");
  } else if (baseName.startsWith("claude-opus-4")) {
    candidates.add("claude-opus-4");
    candidates.add("anthropic/claude-opus-4");
  } else if (baseName.startsWith("claude-haiku-3.5")) {
    candidates.add("claude-haiku-3.5");
    candidates.add("anthropic/claude-haiku-3.5");
  } else if (baseName.startsWith("claude-haiku-3")) {
    candidates.add("claude-haiku-3");
    candidates.add("anthropic/claude-haiku-3");
  }

  return [...candidates];
}

function findPriceEntry(
  modelName: string,
  pricing: LiteLLMPriceMap,
): LiteLLMPriceEntry | null {
  for (const candidate of buildCandidateModelKeys(modelName)) {
    const entry = pricing[candidate];

    if (entry) {
      return entry;
    }
  }

  return null;
}

function findUnpricedModelNames(
  modelNames: string[],
  pricing: LiteLLMPriceMap,
): string[] {
  return modelNames.filter((modelName) => findPriceEntry(modelName, pricing) === null);
}

function resolvePricingEntries(
  modelNames: string[],
  pricing: LiteLLMPriceMap,
): Map<string, LiteLLMPriceEntry | null> {
  const entries = new Map<string, LiteLLMPriceEntry | null>();

  for (const modelName of modelNames) {
    entries.set(modelName, findPriceEntry(modelName, pricing));
  }

  return entries;
}

function inputIncludesCachedReads(modelName: string): boolean {
  const normalized = modelName.trim().toLowerCase();

  return (
    normalized.startsWith("claude") ||
    normalized.startsWith("anthropic/claude")
  );
}

function outputIncludesCacheWrites(modelName: string): boolean {
  return inputIncludesCachedReads(modelName);
}

export function estimateModelSpend(
  model: ModelUsage,
  pricing: LiteLLMPriceMap,
): number | null {
  const entry = findPriceEntry(model.name, pricing);

  if (!entry) {
    return null;
  }

  return estimateModelSpendFromEntry(model, entry);
}

function estimateModelSpendFromEntry(
  model: ModelUsage,
  entry: LiteLLMPriceEntry,
): number {
  const modelName = model.name;

  const cacheReadTokens = Math.max(model.tokens.cache.input, 0);
  const cacheWriteTokens = Math.max(model.tokens.cache.output, 0);
  const inputBaseTokens =
    entry.cache_read_input_token_cost !== undefined &&
    inputIncludesCachedReads(modelName)
      ? Math.max(model.tokens.input - cacheReadTokens, 0)
      : Math.max(model.tokens.input, 0);
  const outputBaseTokens =
    entry.cache_creation_input_token_cost !== undefined &&
    outputIncludesCacheWrites(modelName)
      ? Math.max(model.tokens.output - cacheWriteTokens, 0)
      : Math.max(model.tokens.output, 0);
  const inputCost =
    inputBaseTokens * (entry.input_cost_per_token ?? 0);
  const outputCost =
    outputBaseTokens * (entry.output_cost_per_token ?? 0);
  const cacheReadCost =
    cacheReadTokens *
    (entry.cache_read_input_token_cost ??
      (inputIncludesCachedReads(modelName)
        ? 0
        : entry.input_cost_per_token ?? 0));
  const cacheWriteCost =
    cacheWriteTokens *
    (entry.cache_creation_input_token_cost ??
      (outputIncludesCacheWrites(modelName)
        ? 0
        : entry.input_cost_per_token ?? 0));

  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}

function calculateUsageSpendForModels(
  models: ModelUsage[],
  pricing: LiteLLMPriceMap,
): UsageSpendEstimate {
  const pricingEntries = resolvePricingEntries(
    models.map((model) => model.name),
    pricing,
  );
  let totalUsd = 0;
  let pricedModels = 0;
  const unpricedModels = new Set<string>();

  for (const model of models) {
    const entry = pricingEntries.get(model.name) ?? null;

    if (!entry) {
      unpricedModels.add(model.name);
      continue;
    }

    totalUsd += estimateModelSpendFromEntry(model, entry);
    pricedModels += 1;
  }

  return {
    totalUsd,
    pricedModels,
    unpricedModels: [...unpricedModels].sort(),
  };
}

export function calculateUsageSpend(
  summary: UsageSummary,
  pricing: LiteLLMPriceMap,
): UsageSpendEstimate {
  return calculateUsageSpendForModels(aggregateSummaryModels(summary), pricing);
}

export async function estimateUsageSpend(
  summary: UsageSummary,
): Promise<UsageSpendEstimate> {
  const aggregatedModels = aggregateSummaryModels(summary);
  const sourceUrl = getPricingSourceUrl();
  const cached = await readPricingCache();
  const cachedPricing =
    cached?.sourceUrl === sourceUrl ? cached.pricing : null;
  const localPricing = mergePricingMaps(BUNDLED_PRICE_MAP, cachedPricing);
  const localEstimate = calculateUsageSpendForModels(aggregatedModels, localPricing);

  if (localEstimate.unpricedModels.length === 0) {
    return localEstimate;
  }

  if (process.env.CODEGRAPH_DISABLE_LITELLM_FETCH === "1") {
    return localEstimate;
  }

  const modelNames = aggregatedModels.map((model) => model.name);
  const missingModelNames = findUnpricedModelNames(modelNames, localPricing);

  if (missingModelNames.length === 0) {
    return localEstimate;
  }

  const pricing = await fetchPricingMap();

  if (!pricing) {
    return localEstimate;
  }

  const now = Date.now();

  await writePricingCache({
    fetchedAt: new Date(now).toISOString(),
    pricing,
    sourceUrl,
  });

  return calculateUsageSpendForModels(
    aggregatedModels,
    mergePricingMaps(localPricing, pricing),
  );
}
