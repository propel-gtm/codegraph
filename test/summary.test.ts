import test from "node:test";
import assert from "node:assert/strict";
import { mergeUsageSummaries } from "../src/summary.ts";
import type { UsageSummary } from "../src/types.ts";

function buildSummary(
  providerId: UsageSummary["provider"]["id"],
  title: string,
  total: number,
  modelName: string,
  latestModelName: string,
  latestModelAt: string,
  filesScanned: number,
): UsageSummary {
  return {
    provider: { id: providerId, title },
    start: "2026-03-01",
    end: "2026-03-02",
    daily: [
      {
        date: "2026-03-01",
        input: total,
        output: 0,
        cache: { input: 0, output: 0 },
        total,
        breakdown: [
          {
            name: modelName,
            tokens: {
              input: total,
              output: 0,
              cache: { input: 0, output: 0 },
              total,
            },
          },
        ],
      },
      {
        date: "2026-03-02",
        input: 0,
        output: 0,
        cache: { input: 0, output: 0 },
        total: 0,
        breakdown: [],
      },
    ],
    metrics: {
      last30Days: total,
      input: total,
      output: 0,
      total,
    },
    insights: {
      mostUsedModel: {
        name: modelName,
        tokens: {
          input: total,
          output: 0,
          cache: { input: 0, output: 0 },
          total,
        },
      },
      recentMostUsedModel: {
        name: latestModelName,
        tokens: {
          input: total,
          output: 0,
          cache: { input: 0, output: 0 },
          total,
        },
      },
      latestModel: {
        name: latestModelName,
        lastUsedAt: latestModelAt,
      },
      streaks: {
        longest: 1,
        current: 0,
      },
    },
    stats: {
      sourceLabel: `${title} sessions`,
      sourcePaths: [`/tmp/${providerId}`],
      filesScanned,
      filesFailed: 0,
      linesScanned: 1,
      badLines: 0,
      eventsConsumed: 1,
    },
  };
}

test("mergeUsageSummaries combines providers into one unified summary", () => {
  const codex = buildSummary(
    "codex",
    "Codex",
    120,
    "gpt-5-codex",
    "gpt-5.4",
    "2026-03-01T10:00:00.000Z",
    2,
  );
  const claude = buildSummary(
    "claude",
    "Claude Code",
    80,
    "claude-sonnet-4-5",
    "claude-sonnet-4-5",
    "2026-03-02T12:00:00.000Z",
    3,
  );
  const merged = mergeUsageSummaries(
    [codex, claude],
    new Date("2026-03-01T00:00:00.000Z"),
    new Date("2026-03-02T23:59:59.999Z"),
  );

  assert.ok(merged);
  assert.equal(merged.provider.id, "all");
  assert.equal(merged.provider.title, "Codex + Claude Code");
  assert.equal(merged.metrics.total, 200);
  assert.equal(merged.metrics.input, 200);
  assert.equal(merged.stats.filesScanned, 5);
  assert.equal(merged.stats.sourcePaths.length, 2);
  assert.equal(merged.insights.mostUsedModel?.name, "gpt-5-codex");
  assert.equal(merged.insights.recentMostUsedModel?.name, "claude-sonnet-4-5");
  assert.equal(merged.insights.latestModel?.name, "claude-sonnet-4-5");
  assert.equal(merged.daily[0]?.breakdown.length, 2);
});
