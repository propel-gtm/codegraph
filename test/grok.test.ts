import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadGrokUsage } from "../src/grok.ts";

test("loadGrokUsage aggregates cumulative token_count events without double counting", async () => {
  const root = await mkdtemp(join(tmpdir(), "codegraph-grok-"));
  const sessionsDirectory = join(root, "sessions", "workspace-a");
  const sessionPath = join(sessionsDirectory, "sample.jsonl");
  const now = new Date("2026-03-11T10:00:00.000Z");
  const later = new Date(now.getTime() + 30_000);

  await mkdir(sessionsDirectory, { recursive: true });
  await writeFile(
    sessionPath,
    [
      "{\"type\":\"turn_context\"",
      JSON.stringify({
        timestamp: now.toISOString(),
        type: "turn_context",
        payload: { model: "grok-code-fast-20260301" },
      }),
      JSON.stringify({
        timestamp: now.toISOString(),
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 120,
              cached_input_tokens: 20,
              output_tokens: 30,
              total_tokens: 150,
            },
            last_token_usage: {
              input_tokens: 120,
              cached_input_tokens: 20,
              output_tokens: 30,
              total_tokens: 150,
            },
          },
        },
      }),
      JSON.stringify({
        timestamp: now.toISOString(),
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 120,
              cached_input_tokens: 20,
              output_tokens: 30,
              total_tokens: 150,
            },
            last_token_usage: {
              input_tokens: 120,
              cached_input_tokens: 20,
              output_tokens: 30,
              total_tokens: 150,
            },
          },
        },
      }),
      JSON.stringify({
        timestamp: later.toISOString(),
        type: "turn_context",
        payload: { model: "grok-code-smart" },
      }),
      JSON.stringify({
        timestamp: later.toISOString(),
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 170,
              cached_input_tokens: 30,
              output_tokens: 50,
              total_tokens: 220,
            },
            last_token_usage: {
              input_tokens: 50,
              cached_input_tokens: 10,
              output_tokens: 20,
              total_tokens: 70,
            },
          },
        },
      }),
    ].join("\n"),
    "utf8",
  );

  try {
    const start = new Date(now);
    const end = new Date(later);

    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    const summary = await loadGrokUsage({
      start,
      end,
      grokHome: root,
    });

    assert.ok(summary);
    assert.equal(summary.provider.id, "grok");
    assert.equal(summary.provider.title, "Grok Code");
    assert.equal(summary.metrics.total, 220);
    assert.equal(summary.metrics.input, 170);
    assert.equal(summary.metrics.output, 50);
    assert.equal(summary.insights.mostUsedModel?.name, "grok-code-fast");
    assert.equal(summary.insights.recentMostUsedModel?.name, "grok-code-smart");
    assert.equal(summary.insights.latestModel?.name, "grok-code-smart");
    assert.equal(summary.stats.filesScanned, 1);
    assert.equal(summary.stats.badLines, 1);
    assert.equal(summary.stats.eventsConsumed, 2);
    assert.deepEqual(summary.stats.sourcePaths, [join(root, "sessions")]);
    assert.equal(summary.daily.filter((row) => row.total > 0).length, 1);
    assert.equal(
      summary.daily.find((row) => row.total > 0)?.breakdown[0]?.tokens.total,
      150,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadGrokUsage returns null when no usage falls within the requested window", async () => {
  const root = await mkdtemp(join(tmpdir(), "codegraph-grok-empty-"));
  const sessionsDirectory = join(root, "sessions", "workspace-b");
  const sessionPath = join(sessionsDirectory, "sample.jsonl");

  await mkdir(sessionsDirectory, { recursive: true });
  await writeFile(
    sessionPath,
    [
      JSON.stringify({
        timestamp: "2026-02-01T10:00:00.000Z",
        type: "turn_context",
        payload: { model: "grok-code-fast" },
      }),
      JSON.stringify({
        timestamp: "2026-02-01T10:00:00.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 100,
              output_tokens: 20,
              total_tokens: 120,
            },
          },
        },
      }),
    ].join("\n"),
    "utf8",
  );

  try {
    const summary = await loadGrokUsage({
      start: new Date("2026-03-01T00:00:00.000Z"),
      end: new Date("2026-03-31T23:59:59.999Z"),
      grokHome: root,
    });

    assert.equal(summary, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
