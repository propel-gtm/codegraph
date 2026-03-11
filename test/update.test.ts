import test from "node:test";
import assert from "node:assert/strict";
import { compareVersions } from "../src/update.ts";

test("compareVersions detects when a newer release is available", () => {
  assert.equal(compareVersions("0.1.0", "0.1.1"), 1);
  assert.equal(compareVersions("0.1.0", "0.2.0"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.2.0", "1.1.9"), -1);
});
