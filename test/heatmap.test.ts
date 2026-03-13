import test from "node:test";
import assert from "node:assert/strict";
import type { UsageSummary } from "../src/types.ts";
import { renderHeatmapPng, renderHeatmapSvg } from "../src/heatmap.ts";

const sampleSummary: UsageSummary = {
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
          name: "gpt-5-codex",
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
      input: 0,
      output: 0,
      cache: { input: 0, output: 0 },
      total: 0,
      breakdown: [],
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
      input: 0,
      output: 0,
      cache: { input: 0, output: 0 },
      total: 0,
      breakdown: [],
    },
  ],
  breakdown: {
    models: [
      {
        name: "gpt-5-codex",
        tokens: {
          input: 100,
          output: 40,
          cache: { input: 10, output: 0 },
          total: 140,
        },
      },
    ],
    providers: [
      {
        provider: { id: "codex", title: "Codex" },
        tokens: {
          input: 100,
          output: 40,
          cache: { input: 10, output: 0 },
          total: 140,
        },
        models: [
          {
            name: "gpt-5-codex",
            tokens: {
              input: 100,
              output: 40,
              cache: { input: 10, output: 0 },
              total: 140,
            },
          },
        ],
      },
    ],
  },
  metrics: {
    last30Days: 140,
    input: 100,
    output: 40,
    total: 140,
  },
  insights: {
    mostUsedModel: {
      name: "gpt-5-codex",
      tokens: {
        input: 100,
        output: 40,
        cache: { input: 10, output: 0 },
        total: 140,
      },
    },
    recentMostUsedModel: {
      name: "gpt-5.4",
      tokens: {
        input: 20,
        output: 10,
        cache: { input: 0, output: 0 },
        total: 30,
      },
    },
    latestModel: {
      name: "gpt-5.4",
      lastUsedAt: "2026-03-07T12:00:00.000Z",
    },
    streaks: {
      longest: 1,
      current: 0,
    },
  },
  stats: {
    sourceLabel: "Codex sessions",
    sourcePaths: ["/tmp/.codex/sessions"],
    filesScanned: 1,
    filesFailed: 0,
    linesScanned: 1,
    badLines: 0,
    eventsConsumed: 1,
  },
};

test("renderHeatmapSvg returns a titled SVG document", () => {
  const svg = renderHeatmapSvg(sampleSummary, {
    spend: {
      totalUsd: 536,
      pricedModels: 1,
      unpricedModels: [],
    },
  });

  assert.match(svg, /^<svg[\s>]/);
  assert.match(svg, /codegraph/);
  assert.match(svg, /2026-03-01 to 2026-03-07/);
  assert.match(svg, /THEORETICAL/);
  assert.match(svg, /TOKEN SPEND/);
  assert.match(svg, /\$536/);
  assert.match(svg, /gpt-5-codex/);
  assert.match(svg, /LATEST MODEL/);
  assert.match(svg, /gpt-5\.4/);
  assert.match(svg, /\(30\)/);
  assert.doesNotMatch(svg, /Mar 7/);
});

test("renderHeatmapSvg dashboard variant omits standalone summary chrome", () => {
  const svg = renderHeatmapSvg(sampleSummary, {
    spend: {
      totalUsd: 536,
      pricedModels: 1,
      unpricedModels: [],
    },
    variant: "dashboard",
  });

  assert.match(svg, /^<svg[\s>]/);
  assert.doesNotMatch(svg, /THEORETICAL/);
  assert.doesNotMatch(svg, /TOKEN SPEND/);
  assert.doesNotMatch(svg, /MOST USED MODEL/);
  assert.doesNotMatch(svg, /LATEST MODEL/);
  assert.doesNotMatch(svg, /2026-03-01 to 2026-03-07/);
  assert.match(svg, /viewBox="0 0 500 304"/);
  assert.match(svg, /<rect x="235" y="32" width="28" height="28" rx="7" fill="/);
  assert.match(svg, /text-anchor="middle" dominant-baseline="middle"/);
});

test("renderHeatmapSvg scales short ranges to use more space", () => {
  const svg = renderHeatmapSvg(sampleSummary);

  assert.match(svg, /viewBox="0 0 940 500"/);
  assert.match(svg, /<rect x="62" y="154" width="24" height="24" rx="6" fill="/);
});

test("renderHeatmapPng returns a PNG image", { timeout: 60000 }, () => {
  const png = renderHeatmapPng(sampleSummary, {
    spend: {
      totalUsd: 536,
      pricedModels: 1,
      unpricedModels: [],
    },
  });

  assert.equal(Buffer.from(png).subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
});
