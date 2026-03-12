import { Resvg } from "@resvg/resvg-js";
import type { UsageSpendEstimate } from "./pricing.ts";
import type {
  DailyUsage,
  ModelUsage,
  UsageSummary,
} from "./types.ts";
import {
  buildDateRange,
  buildMonthLabels,
  chunkIntoWeeks,
  compactNumber,
  escapeXml,
  mondayFirstIndex,
} from "./utils.ts";

interface Theme {
  backgroundStart: string;
  backgroundEnd: string;
  panel: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  empty: string;
  palette: string[];
}

interface CellDay {
  date?: string | null;
  input?: number;
  output?: number;
  total: number;
  breakdown: ModelUsage[];
}

interface HeatmapRenderOptions {
  spend?: UsageSpendEstimate | null;
}

const TITLE_FONT_STACK =
  "'Avenir Next', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const UI_FONT_STACK =
  "'IBM Plex Sans', 'Avenir Next', 'Segoe UI', Arial, sans-serif";
const MONO_FONT_STACK =
  "'IBM Plex Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace";

const THEME: Theme = {
  backgroundStart: "#fbfcf7",
  backgroundEnd: "#eff5ee",
  panel: "#f7faf8",
  border: "#d7e2dc",
  text: "#122019",
  muted: "#5f6f67",
  accent: "#2a8c62",
  empty: "#dde8e1",
  palette: ["#c9ddd2", "#9fcab5", "#69af8b", "#33815f", "#0f5c43"],
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function truncate(value: string, length: number): string {
  if (value.length <= length) {
    return value;
  }

  return `${value.slice(0, Math.max(length - 3, 1))}...`;
}

function colorForValue(value: number, maxValue: number, theme: Theme): string {
  if (value <= 0 || maxValue <= 0) {
    return theme.empty;
  }

  const normalized = Math.pow(value / maxValue, 0.72);
  const index = Math.min(
    theme.palette.length - 1,
    Math.max(0, Math.ceil(normalized * theme.palette.length) - 1),
  );

  return theme.palette[index] ?? theme.empty;
}

function buildWeeks(
  start: string,
  end: string,
): { weeks: Array<Array<string | null>>; monthLabels: string[] } {
  const allDays = buildDateRange(
    new Date(`${start}T00:00:00`),
    new Date(`${end}T00:00:00`),
  );
  const padding = new Array<string | null>(mondayFirstIndex(allDays[0] ?? start)).fill(
    null,
  );
  const weeks = chunkIntoWeeks<string | null>([...padding, ...allDays]);

  return {
    weeks,
    monthLabels: buildMonthLabels(weeks),
  };
}

function buildCellTitle(day: CellDay | null | undefined): string {
  if (!day?.date) {
    return "";
  }

  if (day.total <= 0) {
    return `${day.date}\nNo usage`;
  }

  const breakdown = day.breakdown
    .slice(0, 3)
    .map((entry) => `${entry.name}: ${compactNumber(entry.tokens.total)}`)
    .join("\n");

  return [
    day.date,
    `Total: ${compactNumber(day.total)} tokens`,
    `Input: ${compactNumber(day.input ?? 0)}`,
    `Output: ${compactNumber(day.output ?? 0)}`,
    breakdown ? `Top models:\n${breakdown}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function metricBlock(
  label: string,
  value: string,
  x: number,
  y: number,
  theme: Theme,
  width: number,
  height: number,
): string {
  const labelLines = label
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const isMultilineLabel = labelLines.length > 1;
  const labelMarkup = labelLines
    .map((line, index) => {
      const lineY = y + 24 + index * 12;

      return `<text x="${x + 16}" y="${lineY}" fill="${theme.muted}" font-family="${UI_FONT_STACK}" font-size="${isMultilineLabel ? 9 : 10}" font-weight="700" letter-spacing="${isMultilineLabel ? 1 : 1.2}">${escapeXml(line.toUpperCase())}</text>`;
    })
    .join("");

  return `
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="14" fill="${theme.panel}" stroke="${theme.border}" />
    ${labelMarkup}
    <text x="${x + 16}" y="${y + (isMultilineLabel ? 59 : 55)}" fill="${theme.text}" font-family="${TITLE_FONT_STACK}" font-size="${isMultilineLabel ? 23 : 25}" font-weight="700">
      ${escapeXml(value)}
    </text>
  `;
}

function insightBlock(
  label: string,
  value: string,
  x: number,
  y: number,
  theme: Theme,
): string {
  return `
    <text x="${x}" y="${y}" fill="${theme.muted}" font-family="${UI_FONT_STACK}" font-size="10" font-weight="700" letter-spacing="1.1">${escapeXml(label.toUpperCase())}</text>
    <text x="${x}" y="${y + 24}" fill="${theme.text}" font-family="${TITLE_FONT_STACK}" font-size="17" font-weight="700">${escapeXml(value)}</text>
  `;
}

function modelInsightBlock(
  label: string,
  modelName: string,
  total: string,
  x: number,
  y: number,
  theme: Theme,
): string {
  const suffix = total ? ` (${total})` : "";

  return `
    <text x="${x}" y="${y}" fill="${theme.muted}" font-family="${UI_FONT_STACK}" font-size="10" font-weight="700" letter-spacing="1.1">${escapeXml(label.toUpperCase())}</text>
    <text x="${x}" y="${y + 26}" fill="${theme.text}" font-family="${TITLE_FONT_STACK}" font-size="15" font-weight="700">
      ${escapeXml(modelName)}
      <tspan fill="${theme.muted}" font-family="${MONO_FONT_STACK}" font-size="12" font-weight="700">${escapeXml(suffix)}</tspan>
    </text>
  `;
}

function legend(x: number, y: number, theme: Theme): string {
  const cells = [theme.empty, ...theme.palette]
    .map((fill, index) => {
      const cellX = x + index * 16;

      return `<rect x="${cellX}" y="${y}" width="10" height="10" rx="2" fill="${fill}" />`;
    })
    .join("");

  return `
    <text x="${x}" y="${y - 8}" fill="${theme.muted}" font-family="${UI_FONT_STACK}" font-size="10" font-weight="700">LESS</text>
    ${cells}
    <text x="${x + 92}" y="${y - 8}" fill="${theme.muted}" font-family="${UI_FONT_STACK}" font-size="10" font-weight="700">MORE</text>
  `;
}

function formatUsd(value: number): string {
  if (!Number.isFinite(value)) {
    return "n/a";
  }

  if (value >= 100) {
    return new Intl.NumberFormat("en-US", {
      currency: "USD",
      maximumFractionDigits: 0,
      style: "currency",
    }).format(value);
  }

  if (value >= 10) {
    return new Intl.NumberFormat("en-US", {
      currency: "USD",
      maximumFractionDigits: 1,
      style: "currency",
    }).format(value);
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

export function renderHeatmapSvg(
  summary: UsageSummary,
  options: HeatmapRenderOptions = {},
): string {
  const theme = THEME;
  const dayMap = new Map<string, DailyUsage>(
    summary.daily.map((day) => [day.date, day]),
  );
  const { weeks, monthLabels } = buildWeeks(summary.start, summary.end);
  const maxDailyTotal = Math.max(...summary.daily.map((day) => day.total), 0);
  const cellSize = 11;
  const gap = 4;
  const left = 62;
  const top = 154;
  const gridWidth = weeks.length * (cellSize + gap) - gap;
  const gridHeight = 7 * (cellSize + gap) - gap;
  const width = Math.max(940, left + gridWidth + 32);
  const height = 438;
  const padding = 32;
  const mostUsedModelName = summary.insights.mostUsedModel
    ? truncate(summary.insights.mostUsedModel.name, 18)
    : "n/a";
  const mostUsedModelTotal = summary.insights.mostUsedModel
    ? compactNumber(summary.insights.mostUsedModel.tokens.total)
    : "";
  const latestModelName = summary.insights.recentMostUsedModel
    ? truncate(summary.insights.recentMostUsedModel.name, 18)
    : summary.insights.latestModel
      ? truncate(summary.insights.latestModel.name, 18)
    : "n/a";
  const latestModelTotal = summary.insights.recentMostUsedModel
    ? compactNumber(summary.insights.recentMostUsedModel.tokens.total)
    : "";
  const spendValue =
    options.spend && options.spend.pricedModels > 0
      ? formatUsd(options.spend.totalUsd)
      : "n/a";
  const metricCardWidth = 152;
  const metricCardHeight = 74;
  const metricGap = 14;
  const metricCardCount = 4;
  const metricRowX =
    width - padding - (metricCardWidth * metricCardCount + metricGap * (metricCardCount - 1));
  const metricRowY = 36;
  const legendY = top + gridHeight + 34;
  const dividerY = legendY + 38;
  const insightY = dividerY + 28;
  const insightColumnWidth = (width - padding * 2) / 4;

  const monthText = monthLabels
    .map((label, index) => {
      if (!label) {
        return "";
      }

      const x = left + index * (cellSize + gap) + 1;
      const monthMonogram = label.slice(0, 1).toUpperCase();

      return `<text x="${x}" y="${top - 18}" fill="${theme.muted}" font-family="${UI_FONT_STACK}" font-size="13" font-weight="600">${escapeXml(monthMonogram)}</text>`;
    })
    .join("");

  const dayLabels = DAY_LABELS.map((label, index) => {
    if (![0, 2, 4].includes(index)) {
      return "";
    }

    const y = top + index * (cellSize + gap) + cellSize - 1;

    return `<text x="24" y="${y}" fill="${theme.muted}" font-family="${UI_FONT_STACK}" font-size="13" font-weight="600">${escapeXml(label.slice(0, 1).toUpperCase())}</text>`;
  }).join("");

  const cells = weeks
    .map((week, weekIndex) =>
      week
        .map((date, dayIndex) => {
          const x = left + weekIndex * (cellSize + gap);
          const y = top + dayIndex * (cellSize + gap);
          const day = date ? dayMap.get(date) : null;
          const fill = day
            ? colorForValue(day.total, maxDailyTotal, theme)
            : theme.empty;
          const title = buildCellTitle(
            day ?? { date, total: 0, breakdown: [] },
          );

          return `
            <rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="3" fill="${fill}">
              ${title ? `<title>${escapeXml(title)}</title>` : ""}
            </rect>
          `;
        })
        .join(""),
    )
    .join("");

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
  <title id="title">Codegraph usage heatmap</title>
  <desc id="description">A rolling usage heatmap for Codex sessions with token totals and model insights.</desc>
  <defs>
    <linearGradient id="codegraph-bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${theme.backgroundStart}" />
      <stop offset="100%" stop-color="${theme.backgroundEnd}" />
    </linearGradient>
  </defs>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="22" fill="url(#codegraph-bg)" stroke="${theme.border}" />
  <text x="${padding}" y="48" fill="${theme.text}" font-family="${TITLE_FONT_STACK}" font-size="30" font-weight="800">codegraph</text>
  <text x="${padding}" y="72" fill="${theme.muted}" font-family="${MONO_FONT_STACK}" font-size="12">${escapeXml(summary.start)} to ${escapeXml(summary.end)}</text>
  ${metricBlock("Theoretical\nToken Spend", spendValue, metricRowX, metricRowY, theme, metricCardWidth, metricCardHeight)}
  ${metricBlock("Last 30 days", compactNumber(summary.metrics.last30Days), metricRowX + (metricCardWidth + metricGap), metricRowY, theme, metricCardWidth, metricCardHeight)}
  ${metricBlock("Input tokens", compactNumber(summary.metrics.input), metricRowX + (metricCardWidth + metricGap) * 2, metricRowY, theme, metricCardWidth, metricCardHeight)}
  ${metricBlock("Output tokens", compactNumber(summary.metrics.output), metricRowX + (metricCardWidth + metricGap) * 3, metricRowY, theme, metricCardWidth, metricCardHeight)}
  ${monthText}
  ${dayLabels}
  ${cells}
  ${legend(left, legendY, theme)}
  <line x1="${padding}" y1="${dividerY}" x2="${width - padding}" y2="${dividerY}" stroke="${theme.border}" />
  ${modelInsightBlock("Most used model", mostUsedModelName, mostUsedModelTotal, padding, insightY, theme)}
  ${modelInsightBlock("Latest model", latestModelName, latestModelTotal, padding + insightColumnWidth, insightY, theme)}
  ${insightBlock("Longest streak", `${summary.insights.streaks.longest}d`, padding + insightColumnWidth * 2, insightY, theme)}
  ${insightBlock("Current streak", `${summary.insights.streaks.current}d`, padding + insightColumnWidth * 3, insightY, theme)}
</svg>`.trim();
}

export function renderHeatmapPng(
  summary: UsageSummary,
  options: HeatmapRenderOptions = {},
): Uint8Array {
  const svg = renderHeatmapSvg(summary, options);
  const renderer = new Resvg(svg);

  return renderer.render().asPng();
}
