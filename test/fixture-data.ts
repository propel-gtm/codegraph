import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRequestedSummaryOrThrow } from "../src/codegraph.ts";
import { buildJsonExport } from "../src/json-export.ts";
import type { ProviderId, UsageSummary } from "../src/types.ts";

const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = dirname(TEST_DIRECTORY);

export const FIXTURES_ROOT = join(TEST_DIRECTORY, "fixtures");
export const FIXTURE_EXAMPLE_PATH = join(
  REPOSITORY_ROOT,
  "examples",
  "fixture-export-all.json",
);
export const FIXTURE_START = new Date("2026-03-01T00:00:00");
export const FIXTURE_END = new Date("2026-03-04T23:59:59.999");
export const FIXTURE_GENERATED_AT = "2026-03-05T00:00:00.000Z";

export interface FixtureHomes {
  codexHome: string;
  claudeConfigDir: string;
  vibeHome: string;
  grokHome: string;
}

export function getFixtureHomes(): FixtureHomes {
  return {
    codexHome: join(FIXTURES_ROOT, "codex-home"),
    claudeConfigDir: join(FIXTURES_ROOT, "claude-home"),
    vibeHome: join(FIXTURES_ROOT, "vibe-home"),
    grokHome: join(FIXTURES_ROOT, "grok-home"),
  };
}

export async function loadFixtureSummary(
  provider: ProviderId,
): Promise<UsageSummary> {
  const homes = getFixtureHomes();

  return loadRequestedSummaryOrThrow(
    provider,
    FIXTURE_START,
    FIXTURE_END,
    homes.codexHome,
    homes.claudeConfigDir,
    homes.vibeHome,
    homes.grokHome,
  );
}

export async function buildFixtureJsonExport() {
  const summary = await loadFixtureSummary("all");

  return buildJsonExport(
    {
      ...summary,
      insights: {
        ...summary.insights,
        latestModel: summary.insights.latestModel
          ? {
              ...summary.insights.latestModel,
              lastUsedAt: "2026-03-04T16:10:00",
            }
          : null,
      },
      stats: {
        ...summary.stats,
        sourcePaths: [
          "test/fixtures/codex-home/sessions",
          "test/fixtures/claude-home/projects",
          "test/fixtures/claude-home/usage-data/session-meta",
          "test/fixtures/vibe-home/logs/session",
          "test/fixtures/grok-home/sessions",
        ],
      },
    },
    null,
    FIXTURE_GENERATED_AT,
  );
}
