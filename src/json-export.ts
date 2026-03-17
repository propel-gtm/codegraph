import type { UsageSpendEstimate } from "./pricing.ts";
import type { UsageSummary } from "./types.ts";

export const JSON_EXPORT_VERSION = "0.3.0";

export interface UsageJsonExport {
  version: string;
  generatedAt: string;
  summary: UsageSummary;
  spend: UsageSpendEstimate | null;
}

export function buildJsonExport(
  summary: UsageSummary,
  spend: UsageSpendEstimate | null,
  generatedAt = new Date().toISOString(),
): UsageJsonExport {
  return {
    version: JSON_EXPORT_VERSION,
    generatedAt,
    summary,
    spend,
  };
}
