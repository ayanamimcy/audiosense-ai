import { Fragment, useEffect, useState } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import { apiJson } from '@/shared/api/base';
import { cn } from '@/shared/lib/cn';

interface UsageGroup {
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
  estimatedUsageShare: number;
  estimatedCostUsd: number | null;
  promptVersions: { version: string; calls: number; latencyP50Ms: number | null; errorRate: number }[];
}

interface UsageSummary {
  since: number;
  totals: { calls: number; errors: number; inputTokens: number; outputTokens: number; estimatedCostUsd: number | null };
  errorsByCategory: Record<string, number>;
  groups: UsageGroup[];
}

const OPERATION_LABELS: Record<string, string> = {
  summary: 'Summaries',
  tag_suggestion: 'Tag suggestions',
  task_chat: 'Recording chat',
  knowledge_chat: 'Ask AI',
};

const WINDOWS = [7, 30];

function formatMs(value: number | null) {
  if (value == null) return '—';
  return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1)} s`;
}

function formatTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function formatCost(value: number | null) {
  if (value == null) return '—';
  return value < 0.01 ? '< $0.01' : `$${value.toFixed(2)}`;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function LlmUsagePanel() {
  const [days, setDays] = useState(7);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    setError('');
    apiJson<UsageSummary>(`/api/llm/usage?days=${days}`)
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Failed to load usage.');
      });
    return () => {
      cancelled = true;
    };
  }, [days]);

  const hasEstimates = summary?.groups.some((group) => group.estimatedUsageShare > 0);
  const errorCategories = Object.entries(summary?.errorsByCategory || {});

  return (
    <section>
      <div className="mt-8 mb-2 flex items-center gap-3">
        <h3 className="flex-1 text-sm font-semibold text-stone-900">AI usage</h3>
        <div role="group" aria-label="Time window" className="flex gap-1 rounded-lg bg-stone-100 p-0.5">
          {WINDOWS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={days === value}
              onClick={() => setDays(value)}
              className={cn(
                'h-7 rounded-md px-2.5 text-xs font-medium',
                days === value ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600',
              )}
            >
              {value} days
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</p>
      ) : !summary ? (
        <div className="flex items-center gap-2 py-6 text-sm text-stone-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading usage…
        </div>
      ) : summary.totals.calls === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 px-4 py-6 text-center text-sm text-stone-600">
          No AI calls in the last {days} days.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-stone-200 bg-stone-200 sm:grid-cols-4">
            {[
              ['Calls', String(summary.totals.calls)],
              ['Failed', summary.totals.errors ? `${summary.totals.errors} (${formatPercent(summary.totals.errors / summary.totals.calls)})` : '0'],
              ['Tokens in / out', `${formatTokens(summary.totals.inputTokens)} / ${formatTokens(summary.totals.outputTokens)}`],
              ['Est. cost', formatCost(summary.totals.estimatedCostUsd)],
            ].map(([label, value]) => (
              <div key={label} className="bg-white px-4 py-3">
                <dt className="text-xs text-stone-500">{label}</dt>
                <dd className="mt-0.5 text-[15px] font-semibold text-stone-900 tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-3 overflow-x-auto rounded-xl border border-stone-200">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-stone-50 text-xs text-stone-600">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Operation</th>
                  <th scope="col" className="px-3 py-2 font-medium">Calls</th>
                  <th scope="col" className="px-3 py-2 font-medium">Failed</th>
                  <th scope="col" className="px-3 py-2 font-medium">Latency p50 / p95</th>
                  <th scope="col" className="px-3 py-2 font-medium">First token</th>
                  <th scope="col" className="px-3 py-2 font-medium">Tokens in / out</th>
                  <th scope="col" className="px-3 py-2 font-medium">Est. cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200 tabular-nums">
                {summary.groups.map((group) => {
                  const key = `${group.operation}:${group.model}`;
                  const isOpen = expanded === key;
                  return (
                    <Fragment key={key}>
                      <tr>
                        <td className="px-3 py-2.5">
                          <button
                            type="button"
                            onClick={() => setExpanded(isOpen ? null : key)}
                            aria-expanded={isOpen}
                            className="flex items-center gap-1.5 text-left"
                          >
                            <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-stone-500 transition-transform', isOpen && 'rotate-90')} />
                            <span>
                              <span className="block font-medium text-stone-900">{OPERATION_LABELS[group.operation] || group.operation}</span>
                              <span className="block text-xs text-stone-500">{group.model}</span>
                            </span>
                          </button>
                        </td>
                        <td className="px-3 py-2.5">{group.calls}</td>
                        <td className={cn('px-3 py-2.5', group.errors > 0 && 'text-red-800')}>
                          {group.errors ? formatPercent(group.errorRate) : '0'}
                        </td>
                        <td className="px-3 py-2.5">{formatMs(group.latencyP50Ms)} / {formatMs(group.latencyP95Ms)}</td>
                        <td className="px-3 py-2.5">{formatMs(group.firstTokenP50Ms)}</td>
                        <td className="px-3 py-2.5">
                          {formatTokens(group.inputTokens)} / {formatTokens(group.outputTokens)}
                          {group.estimatedUsageShare > 0 ? <span className="text-stone-500"> *</span> : null}
                        </td>
                        <td className="px-3 py-2.5">{formatCost(group.estimatedCostUsd)}</td>
                      </tr>
                      {isOpen ? (
                        <tr className="bg-stone-50">
                          <td colSpan={7} className="px-3 py-2.5">
                            <p className="mb-1.5 text-xs font-medium text-stone-600">By prompt version</p>
                            <ul className="flex flex-col gap-1 text-xs text-stone-700">
                              {group.promptVersions.map((version) => (
                                <li key={version.version} className="flex flex-wrap gap-x-4">
                                  <code className="font-mono text-stone-900">{version.version}</code>
                                  <span>{version.calls} calls</span>
                                  <span>p50 {formatMs(version.latencyP50Ms)}</span>
                                  <span>{formatPercent(version.errorRate)} failed</span>
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-2 flex flex-col gap-1 text-xs text-stone-500">
            {errorCategories.length ? (
              <p>Failures: {errorCategories.map(([category, count]) => `${category.replace('_', ' ')} ${count}`).join(' · ')}</p>
            ) : null}
            {hasEstimates ? <p>* Some providers do not report token usage; those counts are estimated from text length.</p> : null}
            <p>Costs are estimates from LLM_PRICING_JSON, not a bill. Prompts and answers are not stored.</p>
          </div>
        </>
      )}
    </section>
  );
}
