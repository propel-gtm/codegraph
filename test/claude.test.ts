import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadClaudeUsage } from "../src/claude.ts";

test("loadClaudeUsage aggregates assistant message usage from Claude Code sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "codegraph-claude-"));
  const projectsDirectory = join(root, "projects", "sample-project");
  const sessionPath = join(projectsDirectory, "session.jsonl");

  await mkdir(projectsDirectory, { recursive: true });
  await writeFile(
    sessionPath,
    [
      JSON.stringify({
        timestamp: "2026-03-01T10:15:00.000Z",
        type: "assistant",
        message: {
          model: "claude-sonnet-4-5-20250929",
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 25,
            cache_creation_input_tokens: 10,
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-02T11:30:00.000Z",
        type: "assistant",
        message: {
          model: "claude-sonnet-4-5-20250929",
          usage: {
            input_tokens: 40,
            output_tokens: 20,
            cache_read_input_tokens: 5,
            cache_creation_input_tokens: 0,
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-03-02T12:00:00.000Z",
        type: "assistant",
        message: {
          model: "claude-opus-4-1",
          usage: {
            input_tokens: 3,
            output_tokens: 2,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      }),
    ].join("\n"),
    "utf8",
  );

  try {
    const summary = await loadClaudeUsage({
      start: new Date("2026-03-01T00:00:00.000Z"),
      end: new Date("2026-03-02T23:59:59.999Z"),
      claudeConfigDir: root,
    });

    assert.ok(summary);
    assert.equal(summary.provider.id, "claude");
    assert.equal(summary.provider.title, "Claude Code");
    assert.equal(summary.metrics.total, 255);
    assert.equal(summary.metrics.input, 173);
    assert.equal(summary.metrics.output, 82);
    assert.equal(summary.insights.mostUsedModel?.name, "claude-sonnet-4-5");
    assert.equal(summary.insights.mostUsedModel?.tokens.total, 250);
    assert.equal(summary.insights.recentMostUsedModel?.name, "claude-opus-4-1");
    assert.equal(summary.insights.latestModel?.name, "claude-opus-4-1");
    assert.equal(summary.stats.filesScanned, 1);
    assert.equal(summary.stats.eventsConsumed, 3);
    assert.deepEqual(summary.stats.sourcePaths, [join(root, "projects")]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
