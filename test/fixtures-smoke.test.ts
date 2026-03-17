import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getDefaultOutputName } from "../src/codegraph.ts";
import {
  buildFixtureJsonExport,
  FIXTURE_EXAMPLE_PATH,
  loadFixtureSummary,
} from "./fixture-data.ts";

test("fixture bundle loads each provider through the public summary loaders", async () => {
  const [codex, claude, vibe, grok] = await Promise.all([
    loadFixtureSummary("codex"),
    loadFixtureSummary("claude"),
    loadFixtureSummary("vibe"),
    loadFixtureSummary("grok"),
  ]);

  assert.equal(codex.provider.id, "codex");
  assert.equal(codex.metrics.total, 210);
  assert.equal(codex.metrics.input, 160);
  assert.equal(codex.metrics.output, 50);
  assert.equal(codex.insights.mostUsedModel?.name, "gpt-5.4");
  assert.equal(codex.insights.latestModel?.name, "gpt-5-codex");

  assert.equal(claude.provider.id, "claude");
  assert.equal(claude.metrics.total, 165);
  assert.equal(claude.metrics.input, 120);
  assert.equal(claude.metrics.output, 45);
  assert.equal(claude.insights.mostUsedModel?.name, "claude-sonnet-4-5");
  assert.equal(claude.insights.latestModel?.name, "claude-opus-4-1");
  assert.equal(claude.stats.filesScanned, 2);

  assert.equal(vibe.provider.id, "vibe");
  assert.equal(vibe.metrics.total, 80);
  assert.equal(vibe.metrics.input, 60);
  assert.equal(vibe.metrics.output, 20);
  assert.equal(vibe.insights.latestModel?.name, "devstral-2");

  assert.equal(grok.provider.id, "grok");
  assert.equal(grok.metrics.total, 90);
  assert.equal(grok.metrics.input, 70);
  assert.equal(grok.metrics.output, 20);
  assert.equal(grok.insights.mostUsedModel?.name, "grok-code-fast");
  assert.equal(grok.insights.latestModel?.name, "grok-code-smart");
});

test("fixture bundle produces a stable merged export example", async () => {
  const summary = await loadFixtureSummary("all");

  assert.equal(summary.provider.id, "all");
  assert.equal(summary.provider.title, "Codex + Claude Code + Vibe + Grok Code");
  assert.equal(summary.metrics.input, 410);
  assert.equal(summary.metrics.output, 135);
  assert.equal(summary.metrics.total, 545);
  assert.equal(summary.stats.filesScanned, 5);
  assert.equal(summary.breakdown.providers.length, 4);
  assert.deepEqual(
    summary.breakdown.providers.map((providerUsage) => providerUsage.provider.id),
    ["codex", "claude", "grok", "vibe"],
  );
  assert.deepEqual(
    summary.daily.map((row) => ({ date: row.date, total: row.total })),
    [
      { date: "2026-03-01", total: 150 },
      { date: "2026-03-02", total: 135 },
      { date: "2026-03-03", total: 140 },
      { date: "2026-03-04", total: 120 },
    ],
  );
  assert.equal(summary.insights.mostUsedModel?.name, "gpt-5.4");
  assert.equal(summary.insights.latestModel?.name, "grok-code-smart");
  assert.equal(summary.insights.recentMostUsedModel?.name, "grok-code-smart");
  assert.equal(summary.insights.streaks.current, 4);
  assert.equal(getDefaultOutputName("json", "2026", "all"), "./codegraph-2026.json");

  const expectedExport = await readFile(FIXTURE_EXAMPLE_PATH, "utf8");
  const actualExport = `${JSON.stringify(await buildFixtureJsonExport(), null, 2)}\n`;

  assert.equal(actualExport, expectedExport);
});
