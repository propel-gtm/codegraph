import assert from "node:assert/strict";
import test from "node:test";
import {
  buildJsonExport,
  JSON_EXPORT_VERSION,
} from "../src/json-export.ts";
import type { UsageSummary } from "../src/types.ts";

function buildSummary(): UsageSummary {
  return {
    provider: { id: "codex", title: "Codex" },
    start: "2026-03-01",
    end: "2026-03-07",
    daily: [
      {
        date: "2026-03-01",
        input: 100,
        output: 20,
        cache: { input: 10, output: 0 },
        total: 120,
        breakdown: [
          {
            name: "gpt-5.4",
            tokens: {
              input: 100,
              output: 20,
              cache: { input: 10, output: 0 },
              total: 120,
            },
          },
        ],
      },
    ],
    breakdown: {
      models: [
        {
          name: "gpt-5.4",
          tokens: {
            input: 100,
            output: 20,
            cache: { input: 10, output: 0 },
            total: 120,
          },
        },
      ],
      providers: [
        {
          provider: { id: "codex", title: "Codex" },
          tokens: {
            input: 100,
            output: 20,
            cache: { input: 10, output: 0 },
            total: 120,
          },
          models: [
            {
              name: "gpt-5.4",
              tokens: {
                input: 100,
                output: 20,
                cache: { input: 10, output: 0 },
                total: 120,
              },
            },
          ],
        },
      ],
    },
    metrics: {
      last30Days: 120,
      input: 100,
      output: 20,
      total: 120,
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
      sourceLabel: "Codex sessions",
      sourcePaths: ["/tmp/.codex/sessions"],
      filesScanned: 1,
      filesFailed: 0,
      linesScanned: 3,
      badLines: 0,
      eventsConsumed: 1,
    },
  };
}

test("buildJsonExport includes structured spend metadata", () => {
  const summary = buildSummary();
  const spend = {
    totalUsd: 12.34,
    pricedModels: 1,
    unpricedModels: ["mystery-model"],
  };
  const generatedAt = "2026-03-07T18:00:00.000Z";

  const exported = buildJsonExport(summary, spend, generatedAt);

  assert.equal(exported.version, JSON_EXPORT_VERSION);
  assert.equal(exported.generatedAt, generatedAt);
  assert.equal(exported.summary, summary);
  assert.deepEqual(exported.spend, spend);
});
