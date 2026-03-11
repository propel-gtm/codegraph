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

const TITLE_FONT_STACK =
  "'Avenir Next', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const UI_FONT_STACK =
  "'IBM Plex Sans', 'Avenir Next', 'Segoe UI', Arial, sans-serif";
const MONO_FONT_STACK =
  "'IBM Plex Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace";

const THEME: Theme = {
  backgroundStart: "#fcfbf7",
  backgroundEnd: "#f0f6f2",
  panel: "#f7fbf8",
  border: "#d8e5de",
  text: "#12201a",
  muted: "#61726b",
  accent: "#1f7a59",
  empty: "#e4ede7",
  palette: ["#cfe4d7", "#a7ceb7", "#69aa87", "#2e775a", "#0f4736"],
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
  return `
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="14" fill="#ffffff" opacity="0.55" />
    <text x="${x + 16}" y="${y + 22}" fill="${theme.muted}" font-family="${UI_FONT_STACK}" font-size="10" font-weight="700" letter-spacing="1.1">${escapeXml(label.toUpperCase())}</text>
    <text x="${x + 16}" y="${y + 50}" fill="${theme.text}" font-family="${TITLE_FONT_STACK}" font-size="24" font-weight="700">
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

export function renderHeatmapSvg(summary: UsageSummary): string {
  const theme = THEME;
  const dayMap = new Map<string, DailyUsage>(
    summary.daily.map((day) => [day.date, day]),
  );
  const { weeks, monthLabels } = buildWeeks(summary.start, summary.end);
  const maxDailyTotal = Math.max(...summary.daily.map((day) => day.total), 0);
  const cellSize = 11;
  const gap = 4;
  const left = 56;
  const top = 106;
  const gridWidth = weeks.length * (cellSize + gap) - gap;
  const gridHeight = 7 * (cellSize + gap) - gap;
  const panelX = left + gridWidth + 40;
  const panelWidth = 428;
  const width = panelX + panelWidth + 32;
  const height = 438;
  const mostUsedModelName = summary.insights.mostUsedModel
    ? truncate(summary.insights.mostUsedModel.name, 18)
    : "n/a";
  const mostUsedModelTotal = summary.insights.mostUsedModel
    ? compactNumber(summary.insights.mostUsedModel.tokens.total)
    : "";
  const recentModelName = summary.insights.recentMostUsedModel
    ? truncate(summary.insights.recentMostUsedModel.name, 18)
    : "n/a";
  const recentModelTotal = summary.insights.recentMostUsedModel
    ? compactNumber(summary.insights.recentMostUsedModel.tokens.total)
    : "";
  const metricCardWidth = 190;
  const metricCardHeight = 68;
  const cardGap = 16;
  const insightColumnGap = 214;

  const monthText = monthLabels
    .map((label, index) => {
      if (!label) {
        return "";
      }

      const x = left + index * (cellSize + gap);

      return `<text x="${x}" y="${top - 18}" fill="${theme.muted}" font-family="${UI_FONT_STACK}" font-size="11" font-weight="600">${escapeXml(label)}</text>`;
    })
    .join("");

  const dayLabels = DAY_LABELS.map((label, index) => {
    if (index % 2 === 1) {
      return "";
    }

      const y = top + index * (cellSize + gap) + cellSize - 1;

    return `<text x="16" y="${y}" fill="${theme.muted}" font-family="${UI_FONT_STACK}" font-size="11" font-weight="600">${escapeXml(label)}</text>`;
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
  <rect x="1" y="1" width="${width - 2}" height="6" rx="22" fill="${theme.accent}" opacity="0.9" />
  <text x="32" y="48" fill="${theme.text}" font-family="${TITLE_FONT_STACK}" font-size="28" font-weight="800">codegraph</text>
  <text x="32" y="72" fill="${theme.muted}" font-family="${MONO_FONT_STACK}" font-size="11">Codex usage from ${escapeXml(summary.start)} to ${escapeXml(summary.end)}</text>
  <rect x="${panelX - 18}" y="76" width="${panelWidth + 12}" height="332" rx="20" fill="${theme.panel}" stroke="${theme.border}" />
  ${monthText}
  ${dayLabels}
  ${cells}
  ${legend(left, top + gridHeight + 30, theme)}
  ${metricBlock("Last 30 days", compactNumber(summary.metrics.last30Days), panelX, 102, theme, metricCardWidth, metricCardHeight)}
  ${metricBlock("Input tokens", compactNumber(summary.metrics.input), panelX + metricCardWidth + cardGap, 102, theme, metricCardWidth, metricCardHeight)}
  ${metricBlock("Output tokens", compactNumber(summary.metrics.output), panelX, 184, theme, metricCardWidth, metricCardHeight)}
  ${metricBlock("Total tokens", compactNumber(summary.metrics.total), panelX + metricCardWidth + cardGap, 184, theme, metricCardWidth, metricCardHeight)}
  <line x1="${panelX}" y1="274" x2="${panelX + panelWidth - 20}" y2="274" stroke="${theme.border}" />
  ${modelInsightBlock("Most used model", mostUsedModelName, mostUsedModelTotal, panelX, 304, theme)}
  ${modelInsightBlock("Recent model", recentModelName, recentModelTotal, panelX + insightColumnGap, 304, theme)}
  <line x1="${panelX}" y1="346" x2="${panelX + panelWidth - 20}" y2="346" stroke="${theme.border}" />
  ${insightBlock("Longest streak", `${summary.insights.streaks.longest}d`, panelX, 374, theme)}
  ${insightBlock("Current streak", `${summary.insights.streaks.current}d`, panelX + insightColumnGap, 374, theme)}
</svg>`.trim();
}
