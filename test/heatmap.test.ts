import test from "node:test";
import assert from "node:assert/strict";
import { renderHeatmapSvg } from "../src/heatmap.ts";

test("renderHeatmapSvg returns a titled SVG document", () => {
  const svg = renderHeatmapSvg(
    {
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
          name: "gpt-5-codex",
          tokens: {
            input: 100,
            output: 40,
            cache: { input: 10, output: 0 },
            total: 140,
          },
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
    },
  );

  assert.match(svg, /^<svg[\s>]/);
  assert.match(svg, /codegraph/);
  assert.match(svg, /Codex usage from 2026-03-01 to 2026-03-07/);
  assert.match(svg, /gpt-5-codex/);
});
