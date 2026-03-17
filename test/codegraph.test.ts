import assert from "node:assert/strict";
import test from "node:test";
import {
  getDefaultOutputName,
  parseProvider,
  PROVIDERS,
} from "../src/codegraph.ts";

test("provider contracts remain stable", () => {
  assert.deepEqual(PROVIDERS, ["codex", "claude", "vibe", "grok", "all"]);
  assert.equal(parseProvider(), "all");
  assert.equal(parseProvider(" GROK "), "grok");
  assert.equal(parseProvider("ClAuDe"), "claude");
  assert.throws(
    () => parseProvider("cursor"),
    /Unsupported provider "cursor"\. Use codex, claude, vibe, grok, or all\./,
  );
});

test("default output naming remains stable for merged and single-provider output", () => {
  assert.equal(getDefaultOutputName("png", "ytd", "all"), "./codegraph-ytd.png");
  assert.equal(
    getDefaultOutputName("json", "ytd", "grok"),
    "./codegraph-ytd-grok.json",
  );
  assert.equal(
    getDefaultOutputName("svg", "2025", "claude"),
    "./codegraph-2025-claude.svg",
  );
});
