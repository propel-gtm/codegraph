import test from "node:test";
import assert from "node:assert/strict";
import { inferFormat } from "../src/utils.ts";

test("inferFormat defaults to png when no format or output extension is provided", () => {
  assert.equal(inferFormat(), "png");
  assert.equal(inferFormat(undefined, "/tmp/codegraph"), "png");
});

test("inferFormat still respects explicit format args and output extensions", () => {
  assert.equal(inferFormat("svg"), "svg");
  assert.equal(inferFormat("png"), "png");
  assert.equal(inferFormat("json"), "json");
  assert.equal(inferFormat(undefined, "/tmp/codegraph.svg"), "svg");
  assert.equal(inferFormat(undefined, "/tmp/codegraph.png"), "png");
  assert.equal(inferFormat(undefined, "/tmp/codegraph.json"), "json");
});
