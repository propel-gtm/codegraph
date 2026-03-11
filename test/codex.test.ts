import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadCodexUsage } from "../src/codex.ts";

test("loadCodexUsage aggregates cumulative token_count events without double counting", async () => {
  const root = await mkdtemp(join(tmpdir(), "codegraph-"));
  const sessionsDirectory = join(root, "sessions", "2026", "03", "11");
  const sessionPath = join(sessionsDirectory, "sample.jsonl");
  const now = new Date();
  const later = new Date(now.getTime() + 30_000);

  await mkdir(sessionsDirectory, { recursive: true });
  await writeFile(
    sessionPath,
    [
      JSON.stringify({
        timestamp: now.toISOString(),
        type: "turn_context",
        payload: { model: "gpt-5-codex-20251101" },
      }),
      JSON.stringify({
        timestamp: now.toISOString(),
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 80,
              cached_input_tokens: 20,
              output_tokens: 20,
              total_tokens: 100,
            },
            last_token_usage: {
              input_tokens: 80,
              cached_input_tokens: 20,
              output_tokens: 20,
              total_tokens: 100,
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
              input_tokens: 80,
              cached_input_tokens: 20,
              output_tokens: 20,
              total_tokens: 100,
            },
            last_token_usage: {
              input_tokens: 80,
              cached_input_tokens: 20,
              output_tokens: 20,
              total_tokens: 100,
            },
          },
        },
      }),
      JSON.stringify({
        timestamp: later.toISOString(),
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 190,
              cached_input_tokens: 40,
              output_tokens: 60,
              total_tokens: 250,
            },
            last_token_usage: {
              input_tokens: 110,
              cached_input_tokens: 20,
              output_tokens: 40,
              total_tokens: 150,
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

    const summary = await loadCodexUsage({
      start,
      end,
      codexHome: root,
    });

    assert.ok(summary);
    assert.equal(summary.metrics.total, 250);
    assert.equal(summary.metrics.input, 190);
    assert.equal(summary.metrics.output, 60);
    assert.equal(summary.insights.mostUsedModel?.name, "gpt-5-codex");
    assert.equal(summary.stats.eventsConsumed, 2);
    assert.equal(summary.daily.filter((row) => row.total > 0).length, 1);
    assert.equal(
      summary.daily.find((row) => row.total > 0)?.breakdown[0]?.tokens.total,
      250,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
