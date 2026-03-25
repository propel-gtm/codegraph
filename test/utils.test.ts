import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDateRange,
  extractRollingWindowArgs,
  getCustomDateRangeDates,
  getLastNDaysDates,
  inferFormat,
} from "../src/utils.ts";

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

test("getLastNDaysDates returns an inclusive rolling window", () => {
  const { start, end } = getLastNDaysDates(30);

  assert.equal(buildDateRange(start, end).length, 30);
});

test("getLastNDaysDates rejects invalid day counts", () => {
  assert.throws(
    () => getLastNDaysDates(0),
    /Rolling window days must be a positive integer\./,
  );
  assert.throws(
    () => getLastNDaysDates(1.5),
    /Rolling window days must be a positive integer\./,
  );
});

test("getCustomDateRangeDates returns inclusive local day boundaries", () => {
  const { start, end } = getCustomDateRangeDates("2026-02-18", "2026-03-20");

  assert.equal(buildDateRange(start, end).length, 31);
  assert.equal(start.getHours(), 0);
  assert.equal(start.getMinutes(), 0);
  assert.equal(end.getHours(), 23);
  assert.equal(end.getMinutes(), 59);
  assert.equal(end >= start, true);
});

test("getCustomDateRangeDates rejects invalid or reversed dates", () => {
  assert.throws(
    () => getCustomDateRangeDates("2026-02-30", "2026-03-20"),
    /--start-date must be a valid date in YYYY-MM-DD format\./,
  );
  assert.throws(
    () => getCustomDateRangeDates("2026-03-20", "2026-02-18"),
    /--end-date must be on or after --start-date\./,
  );
});

test("extractRollingWindowArgs supports generic --last-N flags", () => {
  assert.deepEqual(
    extractRollingWindowArgs(["--provider", "all", "--last-30"]),
    {
      normalizedArgs: ["--provider", "all"],
      lastDays: 30,
    },
  );
  assert.deepEqual(
    extractRollingWindowArgs(["--last-365"]),
    {
      normalizedArgs: [],
      lastDays: 365,
    },
  );
});

test("extractRollingWindowArgs preserves string option values that look like rolling flags", () => {
  assert.deepEqual(
    extractRollingWindowArgs(["--output", "--last-30", "--last-365"]),
    {
      normalizedArgs: ["--output", "--last-30"],
      lastDays: 365,
    },
  );
  assert.deepEqual(
    extractRollingWindowArgs(["-o", "--last-30"]),
    {
      normalizedArgs: ["-o", "--last-30"],
    },
  );
  assert.deepEqual(
    extractRollingWindowArgs(["--start-date", "--last-30", "--last-365"]),
    {
      normalizedArgs: ["--start-date", "--last-30"],
      lastDays: 365,
    },
  );
  assert.deepEqual(
    extractRollingWindowArgs(["--propel-home", "--last-30", "--last-365"]),
    {
      normalizedArgs: ["--propel-home", "--last-30"],
      lastDays: 365,
    },
  );
});

test("extractRollingWindowArgs rejects multiple rolling window flags", () => {
  assert.throws(
    () => extractRollingWindowArgs(["--last-30", "--last-365"]),
    /Use only one rolling window option in the form --last-N\./,
  );
});
