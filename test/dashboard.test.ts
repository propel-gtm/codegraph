import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildDashboardSnapshot,
  generateSnapshot,
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
    breakdown: {
      models: [
        {
          name: "gpt-5.4",
          tokens: {
            input: 390,
            output: 120,
            cache: { input: 30, output: 0 },
            total: 510,
          },
        },
      ],
      providers: [
        {
          provider: { id: "codex", title: "Codex" },
          tokens: {
            input: 390,
            output: 120,
            cache: { input: 30, output: 0 },
            total: 510,
          },
          models: [
            {
              name: "gpt-5.4",
              tokens: {
                input: 390,
                output: 120,
                cache: { input: 30, output: 0 },
                total: 510,
              },
            },
          ],
        },
      ],
    },
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
  assert.match(content, /Most used model/);
  assert.match(content, /Latest model/);
  assert.match(content, /Token breakdown/);
  assert.match(content, /Providers/);
  assert.match(content, /Models/);
  assert.match(content, /390 in \/ 120 out/);
  assert.doesNotMatch(content, /MOST USED MODEL/);
  assert.doesNotMatch(content, /LATEST MODEL/);
  assert.doesNotMatch(content, /THEORETICAL/);
  assert.match(html, /setInterval/);
  assert.match(html, /\/dashboard-content/);
  assert.match(html, /300000/);
  assert.match(html, /\.heatmap-panel\s*\{\s*align-items: start;/);
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

test("generateSnapshot recalculates the dashboard date window", async () => {
  const root = await mkdtemp(join(tmpdir(), "codegraph-dashboard-"));
  const firstDayAtNoon = new Date(2026, 2, 1, 12, 0, 0, 0);
  const secondDayAtNoon = new Date(2026, 2, 2, 12, 0, 0, 0);
  const firstWindow = {
    label: "ytd",
    start: new Date(2026, 2, 1, 0, 0, 0, 0),
    end: new Date(2026, 2, 1, 23, 59, 59, 999),
  };
  const secondWindow = {
    label: "ytd",
    start: new Date(2026, 2, 1, 0, 0, 0, 0),
    end: new Date(2026, 2, 2, 23, 59, 59, 999),
  };
  let selection = firstWindow;

  try {
    await mkdir(join(root, "sessions", "2026", "03", "01"), { recursive: true });
    await mkdir(join(root, "sessions", "2026", "03", "02"), { recursive: true });
    await writeFile(
      join(root, "sessions", "2026", "03", "01", "day-one.jsonl"),
      [
        JSON.stringify({
          timestamp: firstDayAtNoon.toISOString(),
          type: "turn_context",
          payload: { model: "gpt-5.4" },
        }),
        JSON.stringify({
          timestamp: firstDayAtNoon.toISOString(),
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 80,
                output_tokens: 20,
                total_tokens: 100,
              },
              last_token_usage: {
                input_tokens: 80,
                output_tokens: 20,
                total_tokens: 100,
              },
            },
          },
        }),
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(root, "sessions", "2026", "03", "02", "day-two.jsonl"),
      [
        JSON.stringify({
          timestamp: secondDayAtNoon.toISOString(),
          type: "turn_context",
          payload: { model: "gpt-5.4" },
        }),
        JSON.stringify({
          timestamp: secondDayAtNoon.toISOString(),
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 100,
                output_tokens: 50,
                total_tokens: 150,
              },
              last_token_usage: {
                input_tokens: 100,
                output_tokens: 50,
                total_tokens: 150,
              },
            },
          },
        }),
      ].join("\n"),
      "utf8",
    );

    selection = secondWindow;

    const snapshot = await generateSnapshot({
      ...firstWindow,
      codexHome: root,
      host: "127.0.0.1",
      port: 4269,
      provider: "codex",
      refreshIntervalMs: 60_000,
      resolveDateSelection: () => selection,
    });

    assert.equal(snapshot.summary.start, "2026-03-01");
    assert.equal(snapshot.summary.end, "2026-03-02");
    assert.equal(snapshot.summary.metrics.total, 250);
    assert.equal(snapshot.activity.activeDays, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
