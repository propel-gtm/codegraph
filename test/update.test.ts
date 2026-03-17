import test from "node:test";
import assert from "node:assert/strict";
import { compareVersions, writeUpdateCache } from "../src/update.ts";

test("compareVersions detects when a newer release is available", () => {
  assert.equal(compareVersions("0.1.0", "0.1.1"), 1);
  assert.equal(compareVersions("0.1.0", "0.2.0"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.2.0", "1.1.9"), -1);
});

test("writeUpdateCache ignores cache write failures", { concurrency: false }, async () => {
  const previousCacheDir = process.env.CODEGRAPH_CACHE_DIR;

  process.env.CODEGRAPH_CACHE_DIR = "/dev/null";

  try {
    await writeUpdateCache({
      checkedAt: "2026-03-18T00:00:00.000Z",
      latestVersion: "999.0.0",
      packageName: "@propel-code/codegraph",
    });
  } finally {
    if (previousCacheDir === undefined) {
      delete process.env.CODEGRAPH_CACHE_DIR;
    } else {
      process.env.CODEGRAPH_CACHE_DIR = previousCacheDir;
    }
  }
});
