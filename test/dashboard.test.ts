import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDashboardSnapshot,
  handleDashboardRequest,
  renderDashboardContent,
  renderDashboardHtml,
} from "../src/dashboard.ts";
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
        output: 40,
        cache: { input: 10, output: 0 },
        total: 140,
        breakdown: [
          {
            name: "gpt-5.4",
            tokens: {
              input: 100,
              output: 40,
              cache: { input: 10, output: 0 },
              total: 140,
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
      {
        date: "2026-03-03",
        input: 240,
        output: 60,
        cache: { input: 20, output: 0 },
        total: 300,
        breakdown: [
          {
            name: "gpt-5.4",
            tokens: {
              input: 240,
              output: 60,
              cache: { input: 20, output: 0 },
              total: 300,
            },
          },
        ],
      },
      {
        date: "2026-03-04",
        input: 0,
        output: 0,
        cache: { input: 0, output: 0 },
        total: 0,
        breakdown: [],
      },
      {
        date: "2026-03-05",
        input: 0,
        output: 0,
        cache: { input: 0, output: 0 },
        total: 0,
        breakdown: [],
      },
      {
        date: "2026-03-06",
        input: 0,
        output: 0,
        cache: { input: 0, output: 0 },
        total: 0,
        breakdown: [],
      },
      {
        date: "2026-03-07",
        input: 50,
        output: 20,
        cache: { input: 0, output: 0 },
        total: 70,
        breakdown: [
          {
            name: "gpt-5.4",
            tokens: {
              input: 50,
              output: 20,
              cache: { input: 0, output: 0 },
              total: 70,
            },
          },
        ],
      },
    ],
    metrics: {
      last30Days: 510,
      input: 390,
      output: 120,
      total: 510,
    },
    insights: {
      mostUsedModel: {
        name: "gpt-5.4",
        tokens: {
          input: 390,
          output: 120,
          cache: { input: 30, output: 0 },
          total: 510,
        },
      },
      recentMostUsedModel: {
        name: "gpt-5.4",
        tokens: {
          input: 390,
          output: 120,
          cache: { input: 30, output: 0 },
          total: 510,
        },
      },
      latestModel: {
        name: "gpt-5.4",
        lastUsedAt: "2026-03-07T12:00:00.000Z",
      },
      streaks: {
        longest: 1,
        current: 1,
      },
    },
    stats: {
      sourceLabel: "Codex sessions",
      sourcePaths: ["/tmp/.codex/sessions"],
      filesScanned: 3,
      filesFailed: 0,
      linesScanned: 9,
      badLines: 0,
      eventsConsumed: 3,
    },
  };
}

test("buildDashboardSnapshot derives active-day highlights", () => {
  const snapshot = buildDashboardSnapshot(
    buildSummary(),
    {
      totalUsd: 1.23,
      pricedModels: 1,
      unpricedModels: [],
    },
    300_000,
    "2026-03-07T18:00:00.000Z",
  );

  assert.equal(snapshot.activity.activeDays, 3);
  assert.equal(snapshot.activity.averageActiveDay, 170);
  assert.deepEqual(snapshot.activity.topDay, {
    date: "2026-03-03",
    total: 300,
  });
  assert.equal(snapshot.activity.topDays.length, 3);
  assert.equal(snapshot.nextRefreshAt, "2026-03-07T18:05:00.000Z");
});

test("dashboard renderers include live refresh affordances", () => {
  const state = {
    refreshError: null,
    refreshIntervalMs: 300_000,
    snapshot: buildDashboardSnapshot(
      buildSummary(),
      {
        totalUsd: 1.23,
        pricedModels: 1,
        unpricedModels: [],
      },
      300_000,
      "2026-03-07T18:00:00.000Z",
    ),
  };

  const content = renderDashboardContent(state);
  const html = renderDashboardHtml(state);

  assert.match(content, /Refresh now/);
  assert.match(content, /Refreshes every 5 min/);
  assert.match(content, /Top days/);
  assert.match(content, /2026-03-03/);
  assert.match(html, /setInterval/);
  assert.match(html, /\/dashboard-content/);
  assert.match(html, /300000/);
});

test("handleDashboardRequest serves dashboard routes from in-memory state", async () => {
  const baseSnapshot = buildDashboardSnapshot(
    buildSummary(),
    {
      totalUsd: 1.23,
      pricedModels: 1,
      unpricedModels: [],
    },
    300_000,
    "2026-03-07T18:00:00.000Z",
  );
  let refreshCalls = 0;
  let snapshot = baseSnapshot;

  const rootResponse = await handleDashboardRequest("GET", "/", {
    getRefreshError: () => null,
    getSnapshot: () => snapshot,
    refresh: async () => snapshot,
    refreshIntervalMs: 300_000,
  });
  const fragmentResponse = await handleDashboardRequest(
    "GET",
    "/dashboard-content?refresh=1",
    {
      getRefreshError: () => null,
      getSnapshot: () => snapshot,
      refresh: async () => {
        refreshCalls += 1;
        snapshot = buildDashboardSnapshot(
          buildSummary(),
          {
            totalUsd: 2.34,
            pricedModels: 1,
            unpricedModels: [],
          },
          300_000,
          "2026-03-07T18:05:00.000Z",
        );
        return snapshot;
      },
      refreshIntervalMs: 300_000,
    },
  );
  const apiResponse = await handleDashboardRequest("GET", "/api/dashboard", {
    getRefreshError: () => null,
    getSnapshot: () => snapshot,
    refresh: async () => snapshot,
    refreshIntervalMs: 300_000,
  });

  assert.equal(rootResponse.statusCode, 200);
  assert.equal(fragmentResponse.statusCode, 200);
  assert.equal(apiResponse.statusCode, 200);
  assert.equal(refreshCalls, 1);
  assert.match(rootResponse.body, /codegraph live dashboard/);
  assert.match(fragmentResponse.body, /Refresh now/);
  assert.match(fragmentResponse.body, /\$2\.34/);

  const payload = JSON.parse(apiResponse.body) as {
    snapshot: {
      summary: {
        provider: { id: string };
      };
    };
  };

  assert.equal(payload.snapshot.summary.provider.id, "codex");
});
