import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { estimateUsageSpend, type UsageSpendEstimate } from "./pricing.ts";
import {
  loadRequestedSummaryOrThrow,
  type DateSelection,
} from "./codegraph.ts";
import { renderHeatmapSvg } from "./heatmap.ts";
import type { ProviderId, TokenTotals, UsageSummary } from "./types.ts";
import { compactNumber, escapeXml } from "./utils.ts";

interface DailyHighlight {
  date: string;
  total: number;
}

interface DashboardActivitySummary {
  activeDays: number;
  averageActiveDay: number;
  lastActiveDay: DailyHighlight | null;
  topDay: DailyHighlight | null;
  topDays: DailyHighlight[];
}

export interface DashboardSnapshot {
  activity: DashboardActivitySummary;
  generatedAt: string;
  nextRefreshAt: string;
  spend: UsageSpendEstimate | null;
  summary: UsageSummary;
  svg: string;
}

interface DashboardViewState {
  refreshError: string | null;
  refreshIntervalMs: number;
  snapshot: DashboardSnapshot;
}

export interface DashboardServerOptions extends DateSelection {
  claudeConfigDir?: string;
  codexHome?: string;
  grokHome?: string;
  host: string;
  port: number;
  provider: ProviderId;
  refreshIntervalMs: number;
  vibeHome?: string;
}

export interface DashboardServerHandle {
  close: () => Promise<void>;
  refresh: () => Promise<DashboardSnapshot>;
  url: string;
}

interface DashboardRouteResponse {
  body: string;
  headers: Record<string, string>;
  statusCode: number;
}

interface BreakdownRow {
  label: string;
  meta: string;
  pct: number;
  total: string;
}

export interface DashboardRequestContext {
  getRefreshError: () => string | null;
  getSnapshot: () => DashboardSnapshot;
  refresh: () => Promise<DashboardSnapshot>;
  refreshIntervalMs: number;
}

function formatRefreshCadence(refreshIntervalMs: number): string {
  const minutes = refreshIntervalMs / 60_000;

  if (Number.isInteger(minutes)) {
    return `${minutes} min`;
  }

  return `${minutes.toFixed(1).replace(/\.0$/, "")} min`;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "n/a";
  }

  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return "n/a";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function findActiveDays(summary: UsageSummary): DailyHighlight[] {
  return summary.daily
    .filter((day) => day.total > 0)
    .map((day) => ({
      date: day.date,
      total: day.total,
    }));
}

function summarizeActivity(summary: UsageSummary): DashboardActivitySummary {
  const activeDays = findActiveDays(summary);
  const topDays = [...activeDays]
    .sort((left, right) => {
      if (right.total !== left.total) {
        return right.total - left.total;
      }

      return left.date.localeCompare(right.date);
    })
    .slice(0, 10);
  const topDay = topDays[0] ?? null;
  const lastActiveDay = activeDays[activeDays.length - 1] ?? null;

  return {
    activeDays: activeDays.length,
    averageActiveDay:
      activeDays.length > 0
        ? Math.round(summary.metrics.total / activeDays.length)
        : 0,
    lastActiveDay,
    topDay,
    topDays,
  };
}

export function buildDashboardSnapshot(
  summary: UsageSummary,
  spend: UsageSpendEstimate | null,
  refreshIntervalMs: number,
  generatedAt = new Date().toISOString(),
): DashboardSnapshot {
  return {
    activity: summarizeActivity(summary),
    generatedAt,
    nextRefreshAt: new Date(Date.parse(generatedAt) + refreshIntervalMs).toISOString(),
    spend,
    summary,
    svg: renderHeatmapSvg(summary, { variant: "dashboard" }),
  };
}

function renderMetricTile(
  label: string,
  value: string,
  tone: "neutral" | "accent" = "neutral",
): string {
  return `
    <article class="metric-tile ${tone === "accent" ? "metric-tile-accent" : ""}">
      <span class="metric-label">${escapeXml(label)}</span>
      <strong class="metric-value">${escapeXml(value)}</strong>
    </article>
  `;
}

function renderHighlightList(
  title: string,
  items: DailyHighlight[],
): string {
  const rows = items.length
    ? items
        .map(
          (item) => `
            <li class="list-row">
              <span>${escapeXml(item.date)}</span>
              <strong>${escapeXml(compactNumber(item.total))}</strong>
            </li>
          `,
        )
        .join("")
    : `<li class="list-empty">No activity in this window.</li>`;

  return `
    <section class="panel list-panel">
      <div class="panel-heading">
        <h3>${escapeXml(title)}</h3>
      </div>
      <ul class="list">${rows}</ul>
    </section>
  `;
}


function formatTokenSplit(tokens: TokenTotals): string {
  return `${compactNumber(tokens.input)} in / ${compactNumber(tokens.output)} out`;
}

function renderBreakdownRows(items: BreakdownRow[], emptyText: string): string {
  if (items.length === 0) {
    return `<li class="list-empty">${escapeXml(emptyText)}</li>`;
  }

  return items
    .map(
      (item) => `
        <li class="breakdown-row">
          <div class="breakdown-copy">
            <div class="breakdown-top">
              <strong class="breakdown-label" title="${escapeXml(item.label)}">${escapeXml(item.label)}</strong>
              <strong class="breakdown-total">${escapeXml(item.total)}</strong>
            </div>
            <div class="breakdown-bar"><div class="breakdown-bar-fill" style="width:${item.pct.toFixed(1)}%"></div></div>
            <span class="breakdown-meta">${escapeXml(item.meta)}</span>
          </div>
        </li>
      `,
    )
    .join("");
}

function renderUsageBreakdown(summary: UsageSummary): string {
  const topProviderCount = Math.min(summary.breakdown.providers.length, 4);
  const topProviders = summary.breakdown.providers.slice(0, topProviderCount);
  const maxProviderTokens = Math.max(...topProviders.map((e) => e.tokens.total), 1);
  const providerRows = topProviders.map((entry) => {
    const topModel = entry.models[0]?.name;

    return {
      label: entry.provider.title,
      meta: topModel
        ? `${formatTokenSplit(entry.tokens)} · ${topModel}`
        : formatTokenSplit(entry.tokens),
      pct: (entry.tokens.total / maxProviderTokens) * 100,
      total: compactNumber(entry.tokens.total),
    };
  });
  const topModelCount = Math.min(summary.breakdown.models.length, 8);
  const topModels = summary.breakdown.models.slice(0, topModelCount);
  const maxModelTokens = Math.max(...topModels.map((e) => e.tokens.total), 1);
  const modelRows = topModels.map((entry) => ({
    label: entry.name,
    meta: formatTokenSplit(entry.tokens),
    pct: (entry.tokens.total / maxModelTokens) * 100,
    total: compactNumber(entry.tokens.total),
  }));

  return `
    <section class="panel breakdown-panel">
      <div class="panel-heading">
        <h3>Token breakdown</h3>
        <span class="panel-meta">${escapeXml(summary.breakdown.providers.length === 1 ? "1 provider" : `${summary.breakdown.providers.length} providers`)}</span>
      </div>
      <div class="breakdown-grid">
        <section class="breakdown-section">
          <div class="breakdown-heading">
            <h4>Providers</h4>
            <span class="panel-meta">${escapeXml(topProviderCount > 0 ? `top ${topProviderCount}` : "totals")}</span>
          </div>
          <ul class="list breakdown-list">
            ${renderBreakdownRows(providerRows, "No provider usage in this window.")}
          </ul>
        </section>
        <section class="breakdown-section">
          <div class="breakdown-heading">
            <h4>Models</h4>
            <span class="panel-meta">${escapeXml(topModelCount > 0 ? `top ${topModelCount}` : "totals")}</span>
          </div>
          <ul class="list breakdown-list">
            ${renderBreakdownRows(modelRows, "No model usage in this window.")}
          </ul>
        </section>
      </div>
    </section>
  `;
}

export function renderDashboardContent(state: DashboardViewState): string {
  const { snapshot, refreshError, refreshIntervalMs } = state;
  const { summary, activity, spend } = snapshot;
  const spendValue =
    spend && spend.pricedModels > 0
      ? new Intl.NumberFormat("en-US", {
          currency: "USD",
          maximumFractionDigits: spend.totalUsd >= 100 ? 0 : 2,
          style: "currency",
        }).format(spend.totalUsd)
      : "n/a";
  const mostUsedModel = summary.insights.mostUsedModel?.name ?? "n/a";
  const recentModel =
    summary.insights.recentMostUsedModel?.name ??
    summary.insights.latestModel?.name ??
    "n/a";
  const errorBanner = refreshError
    ? `
      <div class="status-banner" role="status">
        <span>Showing the last successful snapshot.</span>
        <strong>${escapeXml(refreshError)}</strong>
      </div>
    `
    : "";

  return `
    <section class="hero panel">
      <div class="hero-copy">
        <p class="eyebrow">Persistent dashboard</p>
        <h1>codegraph live dashboard</h1>
        <p class="hero-subtitle">
          Usage from
          <span>${escapeXml(summary.start)}</span>
          to
          <span>${escapeXml(summary.end)}</span>
        </p>
      </div>
      <div class="hero-actions">
        <span class="status-pill">Refreshes every ${escapeXml(formatRefreshCadence(refreshIntervalMs))}</span>
        <button type="button" class="refresh-button" data-codegraph-refresh>
          Refresh now
        </button>
      </div>
    </section>
    ${errorBanner}
    <section class="status-strip">
      <div>
        <span class="status-label">Last updated</span>
        <strong>${escapeXml(formatTimestamp(snapshot.generatedAt))}</strong>
      </div>
      <div>
        <span class="status-label">Next refresh</span>
        <strong>${escapeXml(formatTimestamp(snapshot.nextRefreshAt))}</strong>
      </div>
      <div>
        <span class="status-label">Files scanned</span>
        <strong>${escapeXml(new Intl.NumberFormat("en-US").format(summary.stats.filesScanned))}</strong>
      </div>
      <div>
        <span class="status-label">Events consumed</span>
        <strong>${escapeXml(new Intl.NumberFormat("en-US").format(summary.stats.eventsConsumed))}</strong>
      </div>
    </section>
    <section class="dashboard-grid">
      <section class="panel heatmap-panel">
        <div class="panel-heading">
          <h2>Heatmap</h2>
          <span class="panel-meta">${escapeXml(summary.provider.id)}</span>
        </div>
        <div class="heatmap-frame">${snapshot.svg}</div>
      </section>
      <section class="side-column">
        <div class="metrics-grid">
          ${renderMetricTile("Total tokens", compactNumber(summary.metrics.total), "accent")}
          ${renderMetricTile("Last 30 days", compactNumber(summary.metrics.last30Days))}
          ${renderMetricTile("Input tokens", compactNumber(summary.metrics.input))}
          ${renderMetricTile("Output tokens", compactNumber(summary.metrics.output))}
          ${renderMetricTile("Theoretical spend", spendValue)}
          ${renderMetricTile("Active days", new Intl.NumberFormat("en-US").format(activity.activeDays))}
        </div>
        <section class="panel insight-panel">
          <div class="panel-heading">
            <h3>Signals</h3>
            <span class="panel-meta">${escapeXml(compactNumber(activity.averageActiveDay))} avg active day</span>
          </div>
          <dl class="insight-list">
            <div>
              <dt>Most used model</dt>
              <dd>${escapeXml(mostUsedModel)}</dd>
            </div>
            <div>
              <dt>Latest model</dt>
              <dd>${escapeXml(recentModel)}</dd>
            </div>
            <div>
              <dt>Current streak</dt>
              <dd>${escapeXml(`${summary.insights.streaks.current}d`)}</dd>
            </div>
            <div>
              <dt>Longest streak</dt>
              <dd>${escapeXml(`${summary.insights.streaks.longest}d`)}</dd>
            </div>
            <div>
              <dt>Top day</dt>
              <dd>${escapeXml(
                activity.topDay
                  ? `${activity.topDay.date} (${compactNumber(activity.topDay.total)})`
                  : "n/a",
              )}</dd>
            </div>
            <div>
              <dt>Last active day</dt>
              <dd>${escapeXml(
                activity.lastActiveDay
                  ? `${activity.lastActiveDay.date} (${compactNumber(activity.lastActiveDay.total)})`
                  : "n/a",
              )}</dd>
            </div>
          </dl>
        </section>
      </section>
    </section>
    <section class="bottom-grid">
      ${renderUsageBreakdown(summary)}
      ${renderHighlightList("Top days", activity.topDays)}
    </section>
  `;
}

export function renderDashboardHtml(state: DashboardViewState): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>codegraph live dashboard</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #ecf3ef;
        --bg-deep: #e2ece7;
        --ink: #0d1e16;
        --muted: #546860;
        --panel: rgba(245, 252, 248, 0.86);
        --panel-strong: rgba(238, 249, 244, 0.97);
        --border: rgba(13, 30, 22, 0.09);
        --border-mid: rgba(13, 30, 22, 0.15);
        --accent: #0b5c40;
        --accent-light: #148258;
        --accent-soft: #c8e8d8;
        --accent-subtle: rgba(11, 92, 64, 0.07);
        --warm: #9a4e22;
        --warm-soft: rgba(154, 78, 34, 0.09);
        --shadow-xs: 0 1px 2px rgba(13, 30, 22, 0.05);
        --shadow-sm: 0 2px 8px rgba(13, 30, 22, 0.08), 0 1px 2px rgba(13, 30, 22, 0.04);
        --shadow-md: 0 4px 20px rgba(13, 30, 22, 0.11), 0 1px 4px rgba(13, 30, 22, 0.05);
        --shadow-inset: inset 0 1px 0 rgba(255, 255, 255, 0.7);
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        margin: 0;
        min-height: 100%;
      }

      body {
        background:
          radial-gradient(ellipse at 0% 0%, rgba(11, 92, 64, 0.22) 0%, transparent 42%),
          radial-gradient(ellipse at 92% 8%, rgba(154, 78, 34, 0.16) 0%, transparent 28%),
          radial-gradient(ellipse at 50% 100%, rgba(11, 92, 64, 0.10) 0%, transparent 50%),
          linear-gradient(175deg, var(--bg) 0%, var(--bg-deep) 100%);
        color: var(--ink);
        font-family: "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif;
        font-size: 15px;
        line-height: 1.5;
      }

      body::before {
        content: "";
        inset: 0;
        pointer-events: none;
        position: fixed;
        background-image:
          linear-gradient(rgba(13, 30, 22, 0.035) 1px, transparent 1px),
          linear-gradient(90deg, rgba(13, 30, 22, 0.035) 1px, transparent 1px);
        background-size: 28px 28px;
        mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.45) 0%, transparent 60%);
        z-index: 0;
      }

      .shell {
        margin: 0 auto;
        max-width: 1540px;
        padding: 24px 22px 56px;
        position: relative;
        z-index: 1;
      }

      #dashboard-root {
        display: grid;
        gap: 16px;
      }

      /* ── Panels ── */

      .panel {
        background: var(--panel);
        backdrop-filter: blur(20px) saturate(1.4);
        border: 1px solid var(--border);
        border-radius: 26px;
        box-shadow: var(--shadow-md), var(--shadow-inset);
      }

      /* ── Hero ── */

      .hero {
        align-items: flex-end;
        display: flex;
        gap: 20px;
        justify-content: space-between;
        padding: 30px 34px 28px;
      }

      .hero-copy {
        display: grid;
        gap: 10px;
      }

      .eyebrow {
        color: var(--warm);
        font-size: 0.73rem;
        font-weight: 800;
        letter-spacing: 0.16em;
        margin: 0;
        text-transform: uppercase;
      }

      h1,
      h2,
      h3,
      h4,
      p {
        margin: 0;
      }

      h1 {
        font-family: "Palatino Linotype", "Book Antiqua", Georgia, serif;
        font-size: clamp(2.2rem, 4.5vw, 3.6rem);
        letter-spacing: -0.04em;
        line-height: 0.92;
      }

      h2 {
        font-size: 0.95rem;
        font-weight: 700;
        letter-spacing: -0.01em;
      }

      h3 {
        font-size: 0.88rem;
        font-weight: 700;
        letter-spacing: 0em;
      }

      h4 {
        font-size: 0.72rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .hero-subtitle {
        color: var(--muted);
        display: flex;
        flex-wrap: wrap;
        font-size: 0.9rem;
        gap: 0.3rem;
        line-height: 1.5;
      }

      .hero-subtitle span {
        color: var(--ink);
        font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
      }

      .hero-actions {
        align-items: center;
        display: flex;
        flex-shrink: 0;
        flex-wrap: wrap;
        gap: 10px;
        justify-content: flex-end;
      }

      .status-pill,
      .refresh-button {
        border-radius: 999px;
        display: inline-flex;
        font-size: 0.85rem;
        font-weight: 700;
        padding: 0.65rem 1.1rem;
      }

      .status-pill {
        background: var(--accent-soft);
        color: var(--accent);
      }

      .refresh-button {
        background: var(--ink);
        border: none;
        color: white;
        cursor: pointer;
        transition: background 130ms ease, transform 130ms ease, box-shadow 130ms ease;
      }

      .refresh-button:hover {
        box-shadow: 0 4px 14px rgba(13, 30, 22, 0.2);
        transform: translateY(-1px);
      }

      .refresh-button:active {
        transform: translateY(0);
      }

      /* ── Status banner (error) ── */

      .status-banner {
        align-items: center;
        background: var(--warm-soft);
        border: 1px solid rgba(154, 78, 34, 0.2);
        border-radius: 18px;
        color: #6d3415;
        display: flex;
        flex-wrap: wrap;
        gap: 0.7rem;
        justify-content: space-between;
        padding: 13px 18px;
      }

      /* ── Status strip ── */

      .status-strip {
        background: var(--panel);
        backdrop-filter: blur(20px);
        border: 1px solid var(--border);
        border-radius: 20px;
        box-shadow: var(--shadow-sm), var(--shadow-inset);
        display: grid;
        gap: 0;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        overflow: hidden;
      }

      .status-strip > div {
        border-right: 1px solid var(--border);
        display: grid;
        gap: 3px;
        padding: 14px 20px;
      }

      .status-strip > div:last-child {
        border-right: none;
      }

      .status-label,
      .panel-meta,
      .metric-label,
      .panel-footnote {
        color: var(--muted);
        font-size: 0.75rem;
        font-weight: 500;
        letter-spacing: 0.01em;
      }

      .panel-meta {
        font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
        font-weight: 400;
      }

      .status-strip strong {
        font-size: 0.95rem;
        font-weight: 700;
        letter-spacing: -0.02em;
      }

      /* ── Layout grids ── */

      .dashboard-grid {
        display: grid;
        gap: 16px;
        grid-template-columns: minmax(0, 1.75fr) minmax(300px, 0.95fr);
      }

      .bottom-grid {
        display: grid;
        gap: 16px;
        grid-template-columns: minmax(0, 1.25fr) minmax(260px, 0.75fr);
      }

      .side-column {
        display: grid;
        gap: 16px;
      }

      /* ── Panel inner layout ── */

      .heatmap-panel,
      .insight-panel,
      .list-panel,
      .breakdown-panel {
        padding: 20px;
      }

      .heatmap-panel {
        align-items: start;
      }

      .panel-heading {
        align-items: center;
        display: flex;
        gap: 8px;
        justify-content: space-between;
        margin-bottom: 16px;
      }

      /* ── Heatmap ── */

      .heatmap-frame {
        display: flex;
        justify-content: center;
        overflow: auto;
      }

      .heatmap-frame svg {
        display: block;
        height: auto;
        max-width: 680px;
        width: 100%;
      }

      /* ── Metric tiles ── */

      .metrics-grid {
        display: grid;
        gap: 10px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .metric-tile {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 20px;
        box-shadow: var(--shadow-xs), var(--shadow-inset);
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-height: 104px;
        padding: 16px 18px 17px;
      }

      .metric-tile-accent {
        background: linear-gradient(148deg, rgba(11, 92, 64, 0.16) 0%, rgba(196, 232, 214, 0.55) 55%, rgba(245, 252, 248, 0.4) 100%);
        border-color: rgba(11, 92, 64, 0.2);
      }

      .metric-label {
        order: -1;
      }

      .metric-value {
        font-family: "Palatino Linotype", "Book Antiqua", Georgia, serif;
        font-size: 2.4rem;
        letter-spacing: -0.05em;
        line-height: 1;
        margin-top: auto;
      }

      /* ── Insight list ── */

      .insight-list {
        display: grid;
        gap: 0;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        margin: 0;
      }

      .insight-list div {
        border-top: 1px solid var(--border);
        display: grid;
        gap: 3px;
        padding: 12px 0;
      }

      .insight-list div:nth-child(-n+2) {
        border-top: none;
        padding-top: 0;
      }

      .insight-list div:nth-child(odd) {
        padding-right: 16px;
      }

      .insight-list div:nth-child(even) {
        border-left: 1px solid var(--border);
        padding-left: 16px;
      }

      .insight-list dt {
        color: var(--muted);
        font-size: 0.74rem;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .insight-list dd {
        font-size: 0.97rem;
        font-weight: 700;
        letter-spacing: -0.02em;
        margin: 0;
      }

      /* ── Lists ── */

      .list {
        display: grid;
        gap: 0;
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .list-row {
        align-items: center;
        border-top: 1px solid var(--border);
        display: flex;
        font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
        font-size: 0.85rem;
        gap: 12px;
        justify-content: space-between;
        margin: 0 -6px;
        padding: 10px 6px;
        border-radius: 8px;
        transition: background 110ms ease;
      }

      .list-row:first-child {
        border-top: none;
      }

      .list-row:hover {
        background: var(--accent-subtle);
      }

      .list-empty {
        color: var(--muted);
        font-size: 0.88rem;
        padding: 4px 0;
      }

      /* ── Breakdown ── */

      .breakdown-grid {
        align-items: start;
        display: grid;
        gap: 24px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .breakdown-section {
        display: grid;
        gap: 14px;
      }

      .breakdown-heading {
        align-items: center;
        display: flex;
        gap: 8px;
        justify-content: space-between;
      }

      .breakdown-list {
        display: grid;
        gap: 0;
      }

      .breakdown-row {
        border-top: 1px solid var(--border);
        margin: 0 -6px;
        padding: 10px 6px;
        border-radius: 8px;
        transition: background 110ms ease;
      }

      .breakdown-row:first-child {
        border-top: none;
      }

      .breakdown-row:hover {
        background: var(--accent-subtle);
      }

      .breakdown-copy {
        display: grid;
        gap: 5px;
        min-width: 0;
      }

      .breakdown-top {
        align-items: baseline;
        display: flex;
        gap: 8px;
        justify-content: space-between;
        min-width: 0;
      }

      .breakdown-label {
        font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
        font-size: 0.83rem;
        font-weight: 700;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .breakdown-total {
        flex-shrink: 0;
        font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
        font-size: 0.83rem;
        font-weight: 700;
      }

      .breakdown-bar {
        background: var(--border);
        border-radius: 999px;
        height: 3px;
        overflow: hidden;
      }

      .breakdown-bar-fill {
        background: var(--accent-light);
        border-radius: 999px;
        height: 100%;
        min-width: 3px;
        transition: width 400ms cubic-bezier(0.4, 0, 0.2, 1);
      }

      .breakdown-meta {
        color: var(--muted);
        font-size: 0.76rem;
      }


      /* ── Refresh state ── */

      .is-refreshing .refresh-button {
        opacity: 0.65;
        pointer-events: none;
      }

      /* ── Responsive ── */

      @media (max-width: 1160px) {
        .dashboard-grid {
          grid-template-columns: 1fr;
        }

        .bottom-grid {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 860px) {
        .hero {
          align-items: flex-start;
          flex-direction: column;
        }

        .status-strip {
          grid-template-columns: 1fr 1fr;
        }

        .status-strip > div:nth-child(2) {
          border-right: none;
        }

        .status-strip > div:nth-child(3) {
          border-top: 1px solid var(--border);
        }

        .status-strip > div:nth-child(4) {
          border-top: 1px solid var(--border);
        }

        .insight-list,
        .breakdown-grid,
        .metrics-grid {
          grid-template-columns: 1fr 1fr;
        }
      }

      @media (max-width: 640px) {
        .shell {
          padding-inline: 14px;
        }

        .panel,
        .status-strip {
          border-radius: 20px;
        }

        .status-strip {
          grid-template-columns: 1fr;
        }

        .status-strip > div {
          border-right: none;
          border-top: 1px solid var(--border);
        }

        .status-strip > div:first-child {
          border-top: none;
        }

        .insight-list,
        .breakdown-grid,
        .metrics-grid {
          grid-template-columns: 1fr;
        }

        .hero-actions {
          width: 100%;
        }

        .refresh-button,
        .status-pill {
          justify-content: center;
          width: 100%;
        }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <div id="dashboard-root">
        ${renderDashboardContent(state)}
      </div>
    </div>
    <script>
      const refreshIntervalMs = ${String(state.refreshIntervalMs)};
      const root = document.getElementById("dashboard-root");
      let pendingRefresh = null;

      async function refreshDashboard(force) {
        if (!root || pendingRefresh) {
          return pendingRefresh;
        }

        document.body.classList.add("is-refreshing");
        pendingRefresh = (async () => {
          const suffix = force ? "?refresh=1" : "";
          const response = await fetch("/dashboard-content" + suffix, {
            cache: "no-store",
            headers: {
              "cache-control": "no-store",
            },
          });

          if (!response.ok) {
            throw new Error("dashboard refresh failed");
          }

          root.innerHTML = await response.text();
        })()
          .catch((error) => {
            console.error(error);
          })
          .finally(() => {
            document.body.classList.remove("is-refreshing");
            pendingRefresh = null;
          });

        return pendingRefresh;
      }

      window.setInterval(() => {
        void refreshDashboard(false);
      }, refreshIntervalMs);

      document.addEventListener("click", (event) => {
        const target = event.target.closest("[data-codegraph-refresh]");

        if (!target) {
          return;
        }

        event.preventDefault();
        void refreshDashboard(true);
      });
    </script>
  </body>
</html>`;
}

async function generateSnapshot(
  options: DashboardServerOptions,
): Promise<DashboardSnapshot> {
  const summary = await loadRequestedSummaryOrThrow(
    options.provider,
    options.start,
    options.end,
    options.codexHome,
    options.claudeConfigDir,
    options.vibeHome,
    options.grokHome,
  );
  const spend = await estimateUsageSpend(summary);

  return buildDashboardSnapshot(summary, spend, options.refreshIntervalMs);
}

function writeHtml(response: ServerResponse, html: string): void {
  const payload = htmlResponse(html);

  response.writeHead(payload.statusCode, payload.headers);
  response.end(payload.body);
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  const result = jsonResponse(statusCode, payload);

  response.writeHead(result.statusCode, result.headers);
  response.end(result.body);
}

function htmlResponse(html: string, statusCode = 200): DashboardRouteResponse {
  return {
    body: html,
    headers: {
      "cache-control": "no-store, max-age=0",
      "content-type": "text/html; charset=utf-8",
    },
    statusCode,
  };
}

function jsonResponse(
  statusCode: number,
  payload: unknown,
): DashboardRouteResponse {
  return {
    body: `${JSON.stringify(payload, null, 2)}\n`,
    headers: {
      "cache-control": "no-store, max-age=0",
      "content-type": "application/json; charset=utf-8",
    },
    statusCode,
  };
}

function emptyResponse(statusCode: number): DashboardRouteResponse {
  return {
    body: "",
    headers: {
      "cache-control": "no-store, max-age=0",
    },
    statusCode,
  };
}

export async function handleDashboardRequest(
  method: string | undefined,
  requestPath: string | undefined,
  context: DashboardRequestContext,
): Promise<DashboardRouteResponse> {
  const url = new URL(requestPath ?? "/", "http://127.0.0.1");

  if (url.pathname === "/favicon.ico") {
    return emptyResponse(204);
  }

  if (method !== "GET") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const forceRefresh = url.searchParams.get("refresh") === "1";
  const snapshot = forceRefresh ? await context.refresh() : context.getSnapshot();
  const state: DashboardViewState = {
    refreshError: context.getRefreshError(),
    refreshIntervalMs: context.refreshIntervalMs,
    snapshot,
  };

  if (url.pathname === "/") {
    return htmlResponse(renderDashboardHtml(state));
  }

  if (url.pathname === "/dashboard-content") {
    return htmlResponse(renderDashboardContent(state));
  }

  if (url.pathname === "/api/dashboard") {
    return jsonResponse(200, state);
  }

  return jsonResponse(404, { error: "Not found" });
}

export async function startDashboardServer(
  options: DashboardServerOptions,
): Promise<DashboardServerHandle> {
  let snapshot = await generateSnapshot(options);
  let refreshError: string | null = null;
  let refreshInFlight: Promise<DashboardSnapshot> | null = null;

  const refresh = async (): Promise<DashboardSnapshot> => {
    if (refreshInFlight) {
      return refreshInFlight;
    }

    refreshInFlight = (async () => {
      try {
        const nextSnapshot = await generateSnapshot(options);

        snapshot = nextSnapshot;
        refreshError = null;

        return nextSnapshot;
      } catch (error) {
        refreshError = error instanceof Error ? error.message : String(error);
        process.stderr.write(`codegraph dashboard refresh failed: ${refreshError}\n`);

        return snapshot;
      } finally {
        refreshInFlight = null;
      }
    })();

    return refreshInFlight;
  };

  const server = createServer(async (request, response) => {
    try {
      const result = await handleDashboardRequest(request.method, request.url, {
        getRefreshError: () => refreshError,
        getSnapshot: () => snapshot,
        refresh,
        refreshIntervalMs: options.refreshIntervalMs,
      });

      response.writeHead(result.statusCode, result.headers);
      response.end(result.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      writeJson(response, 500, { error: message });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const interval = setInterval(() => {
    void refresh();
  }, options.refreshIntervalMs);

  interval.unref();

  const address = server.address();

  if (!address || typeof address === "string") {
    clearInterval(interval);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    throw new Error("Unable to resolve dashboard server address.");
  }

  const { address: host, port } = address as AddressInfo;
  const normalizedHost = host.includes(":") ? `[${host}]` : host;
  const url = `http://${normalizedHost}:${String(port)}`;

  return {
    close: async () => {
      clearInterval(interval);
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
    refresh,
    url,
  };
}
