import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadVibeUsage } from "../src/vibe.ts";

test("loadVibeUsage aggregates session metadata from Vibe logs", async () => {
  const root = await mkdtemp(join(tmpdir(), "codegraph-vibe-"));
  const sessionDirectory = join(
    root,
    "logs",
    "session",
    "session_20260303_090000_aaaa1111",
  );
  const sessionPath = join(sessionDirectory, "meta.json");
  const recentSessionDirectory = join(
    root,
    "logs",
    "session",
    "session_20260304_120000_bbbb2222",
  );
  const recentSessionPath = join(recentSessionDirectory, "meta.json");

  await mkdir(sessionDirectory, { recursive: true });
  await mkdir(recentSessionDirectory, { recursive: true });
  await writeFile(
    sessionPath,
    JSON.stringify({
      start_time: "2026-03-03T09:00:00.000Z",
      end_time: "2026-03-03T09:30:00.000Z",
      stats: {
        session_prompt_tokens: 120,
        session_completion_tokens: 30,
        session_total_llm_tokens: 150,
      },
      config: {
        active_model: "devstral-2",
      },
    }),
    "utf8",
  );
  await writeFile(
    recentSessionPath,
    JSON.stringify({
      start_time: "2026-03-04T12:00:00.000Z",
      end_time: "2026-03-04T12:20:00.000Z",
      stats: {
        session_prompt_tokens: 40,
        session_completion_tokens: 10,
        session_total_llm_tokens: 50,
      },
      config: {
        active_model: "devstral-small",
      },
    }),
    "utf8",
  );

  try {
    const summary = await loadVibeUsage({
      start: new Date("2026-03-03T00:00:00.000Z"),
      end: new Date("2026-03-04T23:59:59.999Z"),
      vibeHome: root,
    });

    assert.ok(summary);
    assert.equal(summary.provider.id, "vibe");
    assert.equal(summary.provider.title, "Vibe");
    assert.equal(summary.metrics.total, 200);
    assert.equal(summary.metrics.input, 160);
    assert.equal(summary.metrics.output, 40);
    assert.equal(summary.insights.mostUsedModel?.name, "devstral-2");
    assert.equal(summary.insights.recentMostUsedModel?.name, "devstral-small");
    assert.equal(summary.insights.latestModel?.name, "devstral-small");
    assert.equal(summary.stats.filesScanned, 2);
    assert.equal(summary.stats.eventsConsumed, 2);
    assert.deepEqual(summary.stats.sourcePaths, [join(root, "logs", "session")]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
