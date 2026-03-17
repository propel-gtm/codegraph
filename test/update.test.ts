import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  const root = await mkdtemp(join(tmpdir(), "codegraph-update-cache-"));
  const blockedPath = join(root, "blocked");

  await writeFile(blockedPath, "not-a-directory\n", "utf8");

  try {
    await writeUpdateCache({
      checkedAt: "2026-03-18T00:00:00.000Z",
      latestVersion: "999.0.0",
      packageName: "@propel-code/codegraph",
    }, join(blockedPath, "update-check.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
