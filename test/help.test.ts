import assert from "node:assert/strict";
import test from "node:test";
import { HELP_TEXT } from "../src/help.ts";

test("HELP_TEXT lists every supported provider and key CLI flags", () => {
  assert.match(
    HELP_TEXT,
    /Generate a local AI coding usage heatmap from Codex, Claude Code, Vibe, and Grok Code session files\./,
  );
  assert.match(
    HELP_TEXT,
    /\[--provider codex\|claude\|vibe\|grok\|all\]/,
  );
  assert.match(
    HELP_TEXT,
    /Provider selection: codex\|claude\|vibe\|grok\|all/,
  );
  assert.match(HELP_TEXT, /--last-N/);
  assert.match(HELP_TEXT, /--last-365/);
  assert.match(HELP_TEXT, /--dashboard/);
  assert.match(HELP_TEXT, /--claude-config-dir/);
  assert.match(HELP_TEXT, /--grok-home/);
  assert.match(HELP_TEXT, /--refresh-minutes/);
});
