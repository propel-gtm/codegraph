import assert from "node:assert/strict";
import test from "node:test";
import {
  getDefaultOutputName,
  parseProvider,
  PROVIDERS,
  resolveDateSelection,
} from "../src/codegraph.ts";
import { formatLocalDate } from "../src/utils.ts";

test("provider contracts remain stable", () => {
  assert.deepEqual(PROVIDERS, ["codex", "claude", "vibe", "grok", "propel", "all"]);
  assert.equal(parseProvider(), "all");
  assert.equal(parseProvider(" GROK "), "grok");
  assert.equal(parseProvider("ClAuDe"), "claude");
  assert.equal(parseProvider("PROPEL"), "propel");
  assert.throws(
    () => parseProvider("cursor"),
    /Unsupported provider "cursor"\. Use codex, claude, vibe, grok, propel, or all\./,
  );
});

test("default output naming remains stable for merged and single-provider output", () => {
  assert.equal(getDefaultOutputName("png", "ytd", "all"), "./codegraph-ytd.png");
  assert.equal(getDefaultOutputName("png", "last-30", "all"), "./codegraph-last-30.png");
  assert.equal(
    getDefaultOutputName("png", "last-30", "all"),
    "./codegraph-last-30.png",
  );
  assert.equal(
    getDefaultOutputName("json", "ytd", "grok"),
    "./codegraph-ytd-grok.json",
  );
  assert.equal(
    getDefaultOutputName("svg", "2025", "claude"),
    "./codegraph-2025-claude.svg",
  );
  assert.equal(
    getDefaultOutputName("json", "ytd", "propel"),
    "./codegraph-ytd-propel.json",
  );
});

test("resolveDateSelection supports rolling day windows", () => {
  const selection = resolveDateSelection({ lastDays: 30 });
  const expectedStart = new Date(selection.end);

  expectedStart.setHours(0, 0, 0, 0);
  expectedStart.setDate(expectedStart.getDate() - 29);

  assert.equal(selection.label, "last-30");
  assert.equal(formatLocalDate(selection.start), formatLocalDate(expectedStart));
});

test("resolveDateSelection uses generic rolling day labels", () => {
  const { label } = resolveDateSelection({ lastDays: 30 });

  assert.equal(label, "last-30");
});

test("resolveDateSelection uses explicit date range labels", () => {
  const { label } = resolveDateSelection({
    startDate: "2026-02-01",
    endDate: "2026-02-28",
  });

  assert.equal(label, "2026-02-01-to-2026-02-28");
});
