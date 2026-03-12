import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { estimateUsageSpend, type UsageSpendEstimate } from "./pricing.ts";
import {
  loadRequestedSummaryOrThrow,
  type DateSelection,
} from "./codegraph.ts";
import { renderHeatmapSvg } from "./heatmap.ts";
import type { ProviderId, UsageSummary } from "./types.ts";
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
  host: string;
  port: number;
  provider: ProviderId;
  refreshIntervalMs: number;
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
    .slice(0, 5);
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
    svg: renderHeatmapSvg(summary, { spend }),
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

function renderSourceList(summary: UsageSummary): string {
  const sourcePaths = summary.stats.sourcePaths.slice(0, 4);
  const paths = sourcePaths.length
    ? sourcePaths
        .map(
          (path) => `
            <li class="source-path" title="${escapeXml(path)}">${escapeXml(path)}</li>
          `,
        )
        .join("")
    : `<li class="list-empty">No source directories reported.</li>`;
  const hiddenCount = Math.max(summary.stats.sourcePaths.length - sourcePaths.length, 0);

  return `
    <section class="panel source-panel">
      <div class="panel-heading">
        <h3>Sources</h3>
        <span class="panel-meta">${escapeXml(summary.stats.sourceLabel)}</span>
      </div>
      <ul class="list source-list">${paths}</ul>
      ${
        hiddenCount > 0
          ? `<p class="panel-footnote">+${hiddenCount} more path${hiddenCount === 1 ? "" : "s"}</p>`
          : ""
      }
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
          ${escapeXml(summary.provider.title)} usage from
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
        ${renderSourceList(summary)}
      </section>
    </section>
    <section class="bottom-grid">
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
        --bg: #f7f2e7;
        --bg-deep: #edf5ee;
        --ink: #152019;
        --muted: #5f6d64;
        --panel: rgba(255, 252, 246, 0.78);
        --panel-strong: rgba(244, 250, 246, 0.94);
        --border: rgba(21, 32, 25, 0.12);
        --accent: #0f6b4b;
        --accent-soft: #dbeee3;
        --warm: #b45c2b;
        --shadow: rgba(18, 32, 25, 0.12);
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
          radial-gradient(circle at top left, rgba(15, 107, 75, 0.14), transparent 34%),
          radial-gradient(circle at 84% 10%, rgba(180, 92, 43, 0.14), transparent 18%),
          linear-gradient(180deg, var(--bg) 0%, var(--bg-deep) 100%);
        color: var(--ink);
        font-family: "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif;
      }

      body::before {
        content: "";
        inset: 0;
        pointer-events: none;
        position: fixed;
        background-image:
          linear-gradient(rgba(21, 32, 25, 0.04) 1px, transparent 1px),
          linear-gradient(90deg, rgba(21, 32, 25, 0.04) 1px, transparent 1px);
        background-size: 24px 24px;
        mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.35), transparent 75%);
      }

      .shell {
        margin: 0 auto;
        max-width: 1500px;
        padding: 28px 20px 48px;
        position: relative;
      }

      #dashboard-root {
        display: grid;
        gap: 18px;
      }

      .panel {
        background: var(--panel);
        backdrop-filter: blur(18px);
        border: 1px solid var(--border);
        border-radius: 28px;
        box-shadow: 0 18px 40px var(--shadow);
      }

      .hero {
        align-items: end;
        display: flex;
        gap: 16px;
        justify-content: space-between;
        padding: 24px 26px;
      }

      .hero-copy {
        display: grid;
        gap: 8px;
      }

      .eyebrow {
        color: var(--warm);
        font-size: 0.78rem;
        font-weight: 800;
        letter-spacing: 0.14em;
        margin: 0;
        text-transform: uppercase;
      }

      h1,
      h2,
      h3,
      p {
        margin: 0;
      }

      h1 {
        font-family: "Palatino Linotype", "Book Antiqua", Georgia, serif;
        font-size: clamp(2rem, 4vw, 3.2rem);
        letter-spacing: -0.03em;
        line-height: 0.95;
      }

      h2,
      h3 {
        font-size: 1rem;
        letter-spacing: -0.01em;
      }

      .hero-subtitle {
        color: var(--muted);
        display: flex;
        flex-wrap: wrap;
        gap: 0.35rem;
        line-height: 1.5;
      }

      .hero-subtitle span {
        color: var(--ink);
        font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
      }

      .hero-actions {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        justify-content: flex-end;
      }

      .status-pill,
      .refresh-button {
        border-radius: 999px;
        display: inline-flex;
        font-size: 0.92rem;
        font-weight: 700;
        padding: 0.8rem 1.05rem;
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
        transition: transform 140ms ease, opacity 140ms ease;
      }

      .refresh-button:hover {
        transform: translateY(-1px);
      }

      .refresh-button:active {
        transform: translateY(0);
      }

      .status-banner {
        align-items: center;
        background: rgba(180, 92, 43, 0.12);
        border: 1px solid rgba(180, 92, 43, 0.22);
        border-radius: 18px;
        color: #7b3c1b;
        display: flex;
        flex-wrap: wrap;
        gap: 0.7rem;
        justify-content: space-between;
        padding: 14px 18px;
      }

      .status-strip {
        border: 1px solid var(--border);
        border-radius: 22px;
        display: grid;
        gap: 12px;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        padding: 14px 18px;
      }

      .status-strip > div {
        display: grid;
        gap: 4px;
      }

      .status-label,
      .panel-meta,
      .metric-label,
      .insight-list dt,
      .panel-footnote {
        color: var(--muted);
        font-size: 0.79rem;
      }

      .panel-meta {
        font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
      }

      .dashboard-grid {
        display: grid;
        gap: 18px;
        grid-template-columns: minmax(0, 1.7fr) minmax(320px, 0.95fr);
      }

      .heatmap-panel,
      .insight-panel,
      .source-panel,
      .list-panel {
        padding: 18px;
      }

      .panel-heading {
        align-items: center;
        display: flex;
        gap: 8px;
        justify-content: space-between;
        margin-bottom: 14px;
      }

      .heatmap-frame {
        background: var(--panel-strong);
        border: 1px solid var(--border);
        border-radius: 24px;
        overflow: auto;
        padding: 12px;
      }

      .heatmap-frame svg {
        display: block;
        height: auto;
        max-width: 100%;
      }

      .side-column {
        display: grid;
        gap: 18px;
      }

      .metrics-grid {
        display: grid;
        gap: 12px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .metric-tile {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 22px;
        display: grid;
        gap: 10px;
        min-height: 112px;
        padding: 16px 18px;
      }

      .metric-tile-accent {
        background: linear-gradient(135deg, rgba(15, 107, 75, 0.12), rgba(255, 252, 246, 0.84));
      }

      .metric-value {
        font-family: "Palatino Linotype", "Book Antiqua", Georgia, serif;
        font-size: 1.8rem;
        letter-spacing: -0.04em;
        line-height: 1;
      }

      .insight-list {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        margin: 0;
      }

      .insight-list div {
        display: grid;
        gap: 4px;
      }

      .insight-list dd {
        font-size: 0.98rem;
        font-weight: 700;
        margin: 0;
      }

      .bottom-grid {
        display: grid;
        gap: 18px;
        grid-template-columns: minmax(0, 1fr);
      }

      .list {
        display: grid;
        gap: 10px;
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .list-row {
        align-items: center;
        border-top: 1px solid var(--border);
        display: flex;
        font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
        gap: 12px;
        justify-content: space-between;
        padding-top: 10px;
      }

      .list-row:first-child {
        border-top: none;
        padding-top: 0;
      }

      .list-empty {
        color: var(--muted);
      }

      .source-list {
        gap: 12px;
      }

      .source-path {
        color: var(--ink);
        font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .is-refreshing .refresh-button {
        opacity: 0.72;
        pointer-events: none;
      }

      @media (max-width: 1120px) {
        .dashboard-grid {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 860px) {
        .hero {
          align-items: start;
          flex-direction: column;
        }

        .status-strip,
        .insight-list,
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
          border-radius: 22px;
        }

        .status-strip,
        .insight-list,
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
