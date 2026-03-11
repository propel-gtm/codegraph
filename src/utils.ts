import { mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { OutputFormat, TokenTotals } from "./types.ts";

export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function buildDateRange(start: Date, end: Date): string[] {
  const days: string[] = [];
  const current = new Date(start);
  const last = new Date(end);

  current.setHours(0, 0, 0, 0);
  last.setHours(0, 0, 0, 0);

  while (current <= last) {
    days.push(formatLocalDate(current));
    current.setDate(current.getDate() + 1);
  }

  return days;
}

export function mondayFirstIndex(dateString: string): number {
  const day = new Date(`${dateString}T00:00:00`).getDay();

  return (day + 6) % 7;
}

export function chunkIntoWeeks<T>(values: T[]): T[][] {
  const weeks: T[][] = [];

  for (let index = 0; index < values.length; index += 7) {
    weeks.push(values.slice(index, index + 7));
  }

  return weeks;
}

export function buildMonthLabels(weeks: Array<Array<string | null>>): string[] {
  const labels: string[] = [];
  let previousMonth = "";

  for (const week of weeks) {
    const lastDay = [...week].reverse().find(
      (value): value is string => value !== null,
    );

    if (!lastDay) {
      labels.push("");
      continue;
    }

    const month = new Date(`${lastDay}T00:00:00`).toLocaleString("en-US", {
      month: "short",
    });

    if (month === previousMonth) {
      labels.push("");
      continue;
    }

    labels.push(month);
    previousMonth = month;
  }

  return labels;
}

export function escapeXml(value: string | number): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function compactNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }

  const units = [
    { size: 1_000_000_000_000, suffix: "T" },
    { size: 1_000_000_000, suffix: "B" },
    { size: 1_000_000, suffix: "M" },
    { size: 1_000, suffix: "K" },
  ];

  for (const unit of units) {
    if (value >= unit.size) {
      const scaled = value / unit.size;
      const precision = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;

      return scaled
        .toFixed(precision)
        .replace(/\.0+$/, "")
        .replace(/(\.\d*[1-9])0+$/, "$1")
        .concat(unit.suffix);
    }
  }

  return new Intl.NumberFormat("en-US").format(value);
}

export function normalizeModelName(value: string | null | undefined): string {
  const trimmed = String(value ?? "").trim();

  if (!trimmed) {
    return "unknown";
  }

  return trimmed.replace(/-\d{8}$/, "");
}

export function createEmptyTokens(): TokenTotals {
  return {
    input: 0,
    output: 0,
    cache: { input: 0, output: 0 },
    total: 0,
  };
}

export function cloneTokens(tokens: TokenTotals): TokenTotals {
  return {
    input: tokens.input,
    output: tokens.output,
    cache: {
      input: tokens.cache.input,
      output: tokens.cache.output,
    },
    total: tokens.total,
  };
}

export function addTokens<T extends TokenTotals>(
  target: T,
  source: TokenTotals,
): T {
  target.input += source.input;
  target.output += source.output;
  target.cache.input += source.cache.input;
  target.cache.output += source.cache.output;
  target.total += source.total;

  return target;
}

export function inferFormat(
  formatArg?: string,
  outputArg?: string,
): OutputFormat {
  if (formatArg) {
    if (formatArg !== "svg" && formatArg !== "json") {
      throw new Error(`Unsupported format "${formatArg}". Use svg or json.`);
    }

    return formatArg;
  }

  if (outputArg?.toLowerCase().endsWith(".json")) {
    return "json";
  }

  return "svg";
}

export function getYtdDates(): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date(end);

  end.setHours(23, 59, 59, 999);
  start.setMonth(0, 1);
  start.setHours(0, 0, 0, 0);

  return { start, end };
}

export function getLast365DaysDates(): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date(end);

  end.setHours(23, 59, 59, 999);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 364);

  return { start, end };
}

export function getCalendarYearDates(
  year: number,
): { start: Date; end: Date } {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new Error("--year must be a 4-digit calendar year.");
  }

  const today = new Date();
  const currentYear = today.getFullYear();
  const start = new Date(`${year}-01-01T00:00:00`);
  const end =
    year === currentYear
      ? today
      : new Date(`${year}-12-31T23:59:59.999`);

  end.setHours(23, 59, 59, 999);
  start.setHours(0, 0, 0, 0);

  return { start, end };
}

export function getRecentWindowStart(end: Date, days = 30): Date {
  const start = new Date(end);

  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));

  return start;
}

export async function listFilesRecursive(
  rootDirectory: string,
  extension: string,
): Promise<string[]> {
  const files: string[] = [];
  const stack: string[] = [rootDirectory];

  while (stack.length > 0) {
    const currentDirectory = stack.pop();

    if (!currentDirectory) {
      continue;
    }

    let entries;

    try {
      entries = await readdir(currentDirectory, {
        withFileTypes: true,
      });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && fullPath.endsWith(extension)) {
        files.push(fullPath);
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

export async function ensureParentDirectory(filePath: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
}
