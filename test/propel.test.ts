import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { loadPropelUsage } from "../src/propel.ts";

const execFileAsync = promisify(execFile);

async function createPropelStateDb(
  root: string,
  rows: Array<{ createdAt: string; kind: string; payload: string }>,
): Promise<void> {
  const dbPath = join(root, "state.sqlite3");
  const statements = [
    "CREATE TABLE audit_events (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);",
    ...rows.map((row, index) => {
      const payload = row.payload.replaceAll("'", "''");

      return `INSERT INTO audit_events (id, kind, payload, created_at) VALUES ('event-${index + 1}', '${row.kind}', '${payload}', '${row.createdAt}');`;
    }),
  ].join(" ");

  await execFileAsync("sqlite3", [dbPath, statements]);
}

test("loadPropelUsage aggregates Propel Code audit events with token metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "codegraph-propel-"));

  try {
    await mkdir(root, { recursive: true });
    await createPropelStateDb(root, [
      {
        createdAt: "2026-03-11T10:00:00.000Z",
        kind: "turn.completed",
        payload: JSON.stringify({
          model: "gpt-5-20260301",
          provider: "openai",
          usage: {
            input_tokens: 120,
            cached_input_tokens: 20,
            output_tokens: 30,
            total_tokens: 170,
          },
        }),
      },
      {
        createdAt: "2026-03-11T10:15:00.000Z",
        kind: "turn.completed",
        payload: "{",
      },
      {
        createdAt: "2026-03-11T10:30:00.000Z",
        kind: "review.completed",
        payload: JSON.stringify({
          model: "claude-sonnet-4-5",
          provider: "anthropic",
          usage: {
            input_tokens: 50,
            cache_read_input_tokens: 10,
            output_tokens: 20,
            cache_creation_input_tokens: 5,
            total_tokens: 85,
          },
        }),
      },
    ]);

    const summary = await loadPropelUsage({
      start: new Date("2026-03-11T00:00:00.000Z"),
      end: new Date("2026-03-11T23:59:59.999Z"),
      propelHome: root,
    });

    assert.ok(summary);
    assert.equal(summary.provider.id, "propel");
    assert.equal(summary.provider.title, "Propel Code");
    assert.equal(summary.metrics.input, 180);
    assert.equal(summary.metrics.output, 55);
    assert.equal(summary.metrics.total, 255);
    assert.equal(summary.insights.mostUsedModel?.name, "gpt-5");
    assert.equal(summary.insights.recentMostUsedModel?.name, "claude-sonnet-4-5");
    assert.equal(summary.insights.latestModel?.name, "claude-sonnet-4-5");
    assert.equal(summary.stats.filesScanned, 1);
    assert.equal(summary.stats.badLines, 1);
    assert.equal(summary.stats.eventsConsumed, 2);
    assert.deepEqual(summary.stats.sourcePaths, [join(root, "state.sqlite3")]);
    assert.equal(summary.daily.filter((row) => row.total > 0).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadPropelUsage returns null when Propel audit events do not include token metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "codegraph-propel-empty-"));

  try {
    await mkdir(root, { recursive: true });
    await createPropelStateDb(root, [
      {
        createdAt: "2026-03-11T10:00:00.000Z",
        kind: "turn.completed",
        payload: JSON.stringify({
          model: "gpt-5",
          provider: "openai",
          provider_response_id: "resp_no_usage",
        }),
      },
    ]);

    const summary = await loadPropelUsage({
      start: new Date("2026-03-11T00:00:00.000Z"),
      end: new Date("2026-03-11T23:59:59.999Z"),
      propelHome: root,
    });

    assert.equal(summary, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
