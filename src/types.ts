export type OutputFormat = "svg" | "png" | "json";
export type ProviderId = "codex" | "claude" | "vibe" | "grok" | "all";

export interface TokenTotals {
  input: number;
  output: number;
  cache: {
    input: number;
    output: number;
  };
  total: number;
}

export interface ModelUsage {
  name: string;
  tokens: TokenTotals;
}

export interface ProviderUsage {
  provider: {
    id: ProviderId;
    title: string;
  };
  tokens: TokenTotals;
  models: ModelUsage[];
}

export interface LatestModelInsight {
  name: string;
  lastUsedAt: string;
}

export interface DailyUsage extends TokenTotals {
  date: string;
  breakdown: ModelUsage[];
}

export interface UsageMetrics {
  last30Days: number;
  input: number;
  output: number;
  total: number;
}

export interface UsageInsights {
  streaks: {
    longest: number;
    current: number;
  };
  mostUsedModel: ModelUsage | null;
  recentMostUsedModel: ModelUsage | null;
  latestModel: LatestModelInsight | null;
}

export interface ParserStats {
  sourceLabel: string;
  sourcePaths: string[];
  filesScanned: number;
  filesFailed: number;
  linesScanned: number;
  badLines: number;
  eventsConsumed: number;
}

export interface UsageSummary {
  provider: {
    id: ProviderId;
    title: string;
  };
  start: string;
  end: string;
  daily: DailyUsage[];
  breakdown: {
    models: ModelUsage[];
    providers: ProviderUsage[];
  };
  metrics: UsageMetrics;
  insights: UsageInsights;
  stats: ParserStats;
}

export interface LoadCodexUsageOptions {
  start: Date;
  end: Date;
  codexHome?: string;
}

export interface LoadClaudeUsageOptions {
  start: Date;
  end: Date;
  claudeConfigDir?: string;
}

export interface LoadVibeUsageOptions {
  start: Date;
  end: Date;
  vibeHome?: string;
}

export interface LoadGrokUsageOptions {
  start: Date;
  end: Date;
  grokHome?: string;
}

export interface CodexRawUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

export interface CodexPayloadInfo {
  model?: string;
  model_name?: string;
  metadata?: {
    model?: string;
  };
  total_token_usage?: CodexRawUsage;
  last_token_usage?: CodexRawUsage;
}

export interface CodexRecordPayload {
  type?: string;
  model?: string;
  model_name?: string;
  metadata?: {
    model?: string;
  };
  info?: CodexPayloadInfo;
}

export interface CodexRecord {
  timestamp?: string;
  type?: string;
  payload?: CodexRecordPayload;
}

export interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface ClaudeMessage {
  model?: string;
  usage?: ClaudeUsage;
}

export interface ClaudeRecord {
  type?: string;
  timestamp?: string;
  message?: ClaudeMessage;
}
