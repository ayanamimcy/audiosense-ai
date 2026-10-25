import type { ModelPrice } from '../config.js';
import type { LlmCallRow } from '../../database/repositories/llm-calls-repository.js';

export interface LlmUsageGroup {
  operation: string;
  model: string;
  calls: number;
  errors: number;
  cancelled: number;
  errorRate: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  firstTokenP50Ms: number | null;
  inputTokens: number;
  outputTokens: number;
  /** Share of calls whose token counts were estimated because the provider sent no usage. */
  estimatedUsageShare: number;
  /** Null when no price is configured for the model. Always an estimate, never a bill. */
  estimatedCostUsd: number | null;
  promptVersions: { version: string; calls: number; latencyP50Ms: number | null; errorRate: number }[];
}

export interface LlmUsageSummary {
  since: number;
  totals: { calls: number; errors: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number | null };
  errorsByCategory: Record<string, number>;
  groups: LlmUsageGroup[];
}

export function percentile(values: number[], p: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
}

function rate(part: number, whole: number) {
  return whole ? part / whole : 0;
}

function summarizeRows(rows: LlmCallRow[]) {
  const ok = rows.filter((row) => row.status === 'ok');
  const errors = rows.filter((row) => row.status === 'error').length;
  return {
    errors,
    cancelled: rows.filter((row) => row.status === 'cancelled').length,
    // Latency only for successful calls: a timeout's latency is the timeout, not the model.
    latencyP50Ms: percentile(ok.map((row) => row.latencyMs), 50),
    latencyP95Ms: percentile(ok.map((row) => row.latencyMs), 95),
    firstTokenP50Ms: percentile(ok.filter((row) => row.firstTokenMs != null).map((row) => Number(row.firstTokenMs)), 50),
    errorRate: rate(errors, rows.length),
  };
}

/**
 * Aggregates raw call rows in memory. Fine for a personal/team workspace (thousands of rows);
 * a larger deployment would push this into SQL or an analytics store.
 */
export function summarizeLlmUsage(rows: LlmCallRow[], pricing: Record<string, ModelPrice>, since: number): LlmUsageSummary {
  const byGroup = new Map<string, LlmCallRow[]>();
  const errorsByCategory: Record<string, number> = {};

  for (const row of rows) {
    const key = `${row.operation}\u0000${row.model}`;
    byGroup.set(key, [...(byGroup.get(key) || []), row]);
    if (row.status === 'error') {
      const category = row.errorCategory || 'other';
      errorsByCategory[category] = (errorsByCategory[category] || 0) + 1;
    }
  }

  const groups: LlmUsageGroup[] = [...byGroup.values()].map((groupRows) => {
    const { operation, model } = groupRows[0];
    const inputTokens = groupRows.reduce((sum, row) => sum + Number(row.inputTokens || 0), 0);
    const outputTokens = groupRows.reduce((sum, row) => sum + Number(row.outputTokens || 0), 0);
    const price = pricing[model];

    const byVersion = new Map<string, LlmCallRow[]>();
    for (const row of groupRows) {
      byVersion.set(row.promptVersion, [...(byVersion.get(row.promptVersion) || []), row]);
    }

    return {
      operation,
      model,
      calls: groupRows.length,
      ...summarizeRows(groupRows),
      inputTokens,
      outputTokens,
      estimatedUsageShare: rate(groupRows.filter((row) => row.usageSource === 'estimated').length, groupRows.length),
      estimatedCostUsd: price
        ? (inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) / 1_000_000
        : null,
      promptVersions: [...byVersion.entries()]
        .map(([version, versionRows]) => {
          const stats = summarizeRows(versionRows);
          return { version, calls: versionRows.length, latencyP50Ms: stats.latencyP50Ms, errorRate: stats.errorRate };
        })
        .sort((a, b) => b.calls - a.calls),
    };
  }).sort((a, b) => b.calls - a.calls);

  const priced = groups.filter((group) => group.estimatedCostUsd != null);
  return {
    since,
    totals: {
      calls: rows.length,
      errors: rows.filter((row) => row.status === 'error').length,
      inputTokens: groups.reduce((sum, group) => sum + group.inputTokens, 0),
      outputTokens: groups.reduce((sum, group) => sum + group.outputTokens, 0),
      estimatedCostUsd: priced.length ? priced.reduce((sum, group) => sum + Number(group.estimatedCostUsd), 0) : null,
    },
    errorsByCategory,
    groups,
  };
}
