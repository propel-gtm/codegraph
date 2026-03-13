import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  calculateUsageSpend,
  estimateUsageSpend,
  loadLiteLLMPricing,
} from "../src/pricing.ts";
import type { UsageSummary } from "../src/types.ts";

function buildSummary(modelNames: string[]): UsageSummary {
  const totalInput = modelNames.length * 1_000_000;
  const totalOutput = modelNames.length * 200_000;
  const totalTokens = modelNames.length * 1_200_000;
  const models = modelNames.map((name) => ({
    name,
    tokens: {
      input: 1_000_000,
      output: 200_000,
      cache: { input: 100_000, output: 0 },
      total: 1_200_000,
    },
  }));

  return {
    provider: { id: "all", title: "All providers" },
    start: "2026-03-01",
    end: "2026-03-01",
    daily: [
      {
        date: "2026-03-01",
        input: totalInput,
        output: totalOutput,
        cache: { input: 100_000, output: 0 },
        total: totalTokens,
        breakdown: models,
      },
    ],
    breakdown: {
      models,
      providers: [
        {
          provider: { id: "all", title: "All providers" },
          tokens: {
            input: totalInput,
            output: totalOutput,
            cache: { input: 100_000, output: 0 },
            total: totalTokens,
          },
          models,
        },
      ],
    },
    metrics: {
      last30Days: totalTokens,
      input: totalInput,
      output: totalOutput,
      total: totalTokens,
    },
    insights: {
      mostUsedModel: null,
      recentMostUsedModel: null,
      latestModel: null,
      streaks: {
        longest: 1,
        current: 1,
      },
    },
    stats: {
      sourceLabel: "test",
      sourcePaths: [],
      filesScanned: 0,
      filesFailed: 0,
      linesScanned: 0,
      badLines: 0,
      eventsConsumed: 0,
    },
  };
}

test("calculateUsageSpend uses LiteLLM-style pricing for OpenAI and Claude models", () => {
  const summary = buildSummary(["gpt-5.4", "claude-sonnet-4-5"]);
  summary.daily[0] = {
    date: "2026-03-01",
    input: 2_100_000,
    output: 2_210_000,
    cache: { input: 200_000, output: 10_000 },
    total: 4_310_000,
    breakdown: [
      {
        name: "gpt-5.4",
        tokens: {
          input: 1_000_000,
          output: 2_000_000,
          cache: { input: 100_000, output: 0 },
          total: 3_100_000,
        },
      },
      {
        name: "claude-sonnet-4-5",
        tokens: {
          input: 1_100_000,
          output: 210_000,
          cache: { input: 100_000, output: 10_000 },
          total: 1_310_000,
        },
      },
    ],
  };
  summary.metrics = {
    last30Days: 4_310_000,
    input: 2_100_000,
    output: 2_210_000,
    total: 4_310_000,
  };
  summary.breakdown = {
    models: summary.daily[0]?.breakdown ?? [],
    providers: [
      {
        provider: { id: "all", title: "All providers" },
        tokens: {
          input: 2_100_000,
          output: 2_210_000,
          cache: { input: 200_000, output: 10_000 },
          total: 4_310_000,
        },
        models: summary.daily[0]?.breakdown ?? [],
      },
    ],
  };
  const pricing = {
    "gpt-5.4": {
      input_cost_per_token: 2.5 / 1_000_000,
      output_cost_per_token: 15 / 1_000_000,
      cache_read_input_token_cost: 0.25 / 1_000_000,
      cache_creation_input_token_cost: 2.5 / 1_000_000,
    },
    "claude-sonnet-4-5": {
      input_cost_per_token: 3 / 1_000_000,
      output_cost_per_token: 15 / 1_000_000,
      cache_read_input_token_cost: 0.3 / 1_000_000,
      cache_creation_input_token_cost: 3.75 / 1_000_000,
    },
  };

  const estimate = calculateUsageSpend(summary, pricing);

  assert.equal(estimate.pricedModels, 2);
  assert.deepEqual(estimate.unpricedModels, []);
  assert.ok(Math.abs(estimate.totalUsd - 38.5925) < 0.000001);
});

test("estimateUsageSpend uses bundled pricing without fetching", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("fetch should not be called for bundled models");
  };

  try {
    const estimate = await estimateUsageSpend(buildSummary(["gpt-5.4"]));

    assert.equal(calls, 0);
    assert.deepEqual(estimate.unpricedModels, []);
    assert.ok(estimate.totalUsd > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("estimateUsageSpend uses bundled pricing for Vibe models without fetching", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("fetch should not be called for bundled models");
  };

  try {
    const estimate = await estimateUsageSpend(buildSummary(["devstral-2"]));

    assert.equal(calls, 0);
    assert.deepEqual(estimate.unpricedModels, []);
    assert.ok(estimate.totalUsd > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("estimateUsageSpend fetches once for unknown models and then uses cache", { concurrency: false }, async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "codegraph-pricing-"));
  const originalFetch = globalThis.fetch;
  const previousCacheDir = process.env.CODEGRAPH_CACHE_DIR;
  const previousSourceUrl = process.env.CODEGRAPH_LITELLM_PRICING_URL;
  const previousDisableFetch = process.env.CODEGRAPH_DISABLE_LITELLM_FETCH;
  let calls = 0;

  process.env.CODEGRAPH_CACHE_DIR = cacheDir;
  process.env.CODEGRAPH_LITELLM_PRICING_URL = "https://example.com/litellm.json";
  delete process.env.CODEGRAPH_DISABLE_LITELLM_FETCH;

  globalThis.fetch = async () => {
    calls += 1;

    return new Response(
      JSON.stringify({
        "mystery-model": {
          input_cost_per_token: 1 / 1_000_000,
          output_cost_per_token: 4 / 1_000_000,
          cache_read_input_token_cost: 0.1 / 1_000_000,
        },
      }),
      {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      },
    );
  };

  try {
    const first = await estimateUsageSpend(buildSummary(["mystery-model"]));
    const second = await estimateUsageSpend(buildSummary(["mystery-model"]));
    const cache = JSON.parse(
      await readFile(join(cacheDir, "litellm-pricing.json"), "utf8"),
    ) as {
      pricing: Record<string, { input_cost_per_token?: number }>;
    };

    assert.equal(calls, 1);
    assert.deepEqual(first.unpricedModels, []);
    assert.deepEqual(second.unpricedModels, []);
    assert.ok(first.totalUsd > 0);
    assert.ok(second.totalUsd > 0);
    assert.equal(
      cache.pricing["mystery-model"]?.input_cost_per_token,
      1 / 1_000_000,
    );
  } finally {
    globalThis.fetch = originalFetch;

    if (previousCacheDir === undefined) {
      delete process.env.CODEGRAPH_CACHE_DIR;
    } else {
      process.env.CODEGRAPH_CACHE_DIR = previousCacheDir;
    }

    if (previousSourceUrl === undefined) {
      delete process.env.CODEGRAPH_LITELLM_PRICING_URL;
    } else {
      process.env.CODEGRAPH_LITELLM_PRICING_URL = previousSourceUrl;
    }

    if (previousDisableFetch === undefined) {
      delete process.env.CODEGRAPH_DISABLE_LITELLM_FETCH;
    } else {
      process.env.CODEGRAPH_DISABLE_LITELLM_FETCH = previousDisableFetch;
    }

    await rm(cacheDir, { force: true, recursive: true });
  }
});

test("loadLiteLLMPricing caches fetched pricing data", { concurrency: false }, async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "codegraph-pricing-"));
  const originalFetch = globalThis.fetch;
  const previousCacheDir = process.env.CODEGRAPH_CACHE_DIR;
  const previousSourceUrl = process.env.CODEGRAPH_LITELLM_PRICING_URL;
  const previousDisableFetch = process.env.CODEGRAPH_DISABLE_LITELLM_FETCH;
  let calls = 0;

  process.env.CODEGRAPH_CACHE_DIR = cacheDir;
  process.env.CODEGRAPH_LITELLM_PRICING_URL = "https://example.com/litellm.json";
  delete process.env.CODEGRAPH_DISABLE_LITELLM_FETCH;

  globalThis.fetch = async () => {
    calls += 1;

    return new Response(
      JSON.stringify({
        "gpt-5.4": {
          input_cost_per_token: 2.5 / 1_000_000,
          output_cost_per_token: 15 / 1_000_000,
          cache_read_input_token_cost: 0.25 / 1_000_000,
        },
      }),
      {
        headers: {
          "content-type": "application/json",
        },
        status: 200,
      },
    );
  };

  try {
    const first = await loadLiteLLMPricing();
    const second = await loadLiteLLMPricing();
    const cache = JSON.parse(
      await readFile(join(cacheDir, "litellm-pricing.json"), "utf8"),
    ) as {
      pricing: Record<string, { input_cost_per_token?: number }>;
      sourceUrl: string;
    };

    assert.equal(calls, 1);
    assert.equal(first["gpt-5.4"]?.input_cost_per_token, 2.5 / 1_000_000);
    assert.equal(second["gpt-5.4"]?.input_cost_per_token, 2.5 / 1_000_000);
    assert.equal(
      cache.pricing["gpt-5.4"]?.input_cost_per_token,
      2.5 / 1_000_000,
    );
    assert.equal(cache.sourceUrl, "https://example.com/litellm.json");
  } finally {
    globalThis.fetch = originalFetch;

    if (previousCacheDir === undefined) {
      delete process.env.CODEGRAPH_CACHE_DIR;
    } else {
      process.env.CODEGRAPH_CACHE_DIR = previousCacheDir;
    }

    if (previousSourceUrl === undefined) {
      delete process.env.CODEGRAPH_LITELLM_PRICING_URL;
    } else {
      process.env.CODEGRAPH_LITELLM_PRICING_URL = previousSourceUrl;
    }

    if (previousDisableFetch === undefined) {
      delete process.env.CODEGRAPH_DISABLE_LITELLM_FETCH;
    } else {
      process.env.CODEGRAPH_DISABLE_LITELLM_FETCH = previousDisableFetch;
    }

    await rm(cacheDir, { force: true, recursive: true });
  }
});
