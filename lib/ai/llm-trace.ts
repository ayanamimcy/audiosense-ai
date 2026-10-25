import { createHash } from 'crypto';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import logger from '../shared/logger.js';
import { insertLlmCallRow, type LlmCallRow } from '../../database/repositories/llm-calls-repository.js';

const log = logger.child('llm-trace');

export type LlmOperation = 'summary' | 'tag_suggestion' | 'task_chat' | 'knowledge_chat';

/** Who/what a call is for. Passed by callers; never contains prompt text. */
export interface LlmTraceContext {
  operation: LlmOperation;
  userId?: string | null;
  taskId?: string | null;
}

export interface ProviderUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

/**
 * Prompt versions are derived, not hand-maintained: the hash of the instructions (system
 * messages plus any template text). Editing a prompt or a user's summary template yields a
 * new version automatically, so before/after comparisons need no bookkeeping. Transcript and
 * user content are excluded so the version does not change per recording.
 */
export function buildPromptVersion(operation: LlmOperation, templateParts: Array<string | null | undefined>) {
  const hash = createHash('sha256')
    .update(templateParts.filter(Boolean).join('\n␞\n'))
    .digest('hex')
    .slice(0, 8);
  return `${operation}@${hash}`;
}

/**
 * Rough token estimate for providers that do not report usage: ~4 characters per token for
 * Latin text, ~1 token per character for CJK. Good enough for trends, not for billing.
 */
export function estimateTokens(text: string) {
  let latin = 0;
  let other = 0;
  for (const char of text) {
    if (char.charCodeAt(0) < 0x2e80) latin += 1; else other += 1;
  }
  return Math.ceil(latin / 4) + other;
}

/** Reads OpenAI-style `usage`; tolerates providers that omit it or use other field names. */
export function readProviderUsage(payload: unknown): ProviderUsage | null {
  const usage = (payload as { usage?: Record<string, unknown> } | null | undefined)?.usage;
  if (!usage || typeof usage !== 'object') return null;
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = Number(usage[key]);
      if (Number.isFinite(value) && value >= 0) return value;
    }
    return null;
  };
  const inputTokens = pick('prompt_tokens', 'input_tokens');
  const outputTokens = pick('completion_tokens', 'output_tokens');
  return inputTokens == null && outputTokens == null ? null : { inputTokens, outputTokens };
}

export function classifyLlmError(error: unknown): { category: string; httpStatus: number | null } {
  if (axios.isAxiosError(error)) {
    const status = Number(error.response?.status || 0) || null;
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') return { category: 'timeout', httpStatus: status };
    if (status === 429) return { category: 'rate_limited', httpStatus: status };
    if (status === 401 || status === 403) return { category: 'auth', httpStatus: status };
    if (status && status >= 500) return { category: 'server', httpStatus: status };
    if (status && status >= 400) return { category: 'client', httpStatus: status };
    return { category: 'network', httpStatus: status };
  }
  if (error instanceof Error && /did not contain message content/i.test(error.message)) {
    return { category: 'empty_response', httpStatus: null };
  }
  return { category: 'other', httpStatus: null };
}

function hostOf(baseUrl: string) {
  try {
    return new URL(baseUrl).host;
  } catch {
    return null;
  }
}

/**
 * Persists one call. Fire-and-forget: tracing must never slow down or break the feature
 * it observes, so failures are logged and swallowed.
 */
export function recordLlmCall(input: {
  trace?: LlmTraceContext;
  model: string;
  baseUrl: string;
  promptVersion: string;
  streamed: boolean;
  startedAt: number;
  firstTokenAt?: number | null;
  inputText: string;
  outputText: string;
  usage: ProviderUsage | null;
  error?: unknown;
  cancelled?: boolean;
}) {
  if (!input.trace) return;

  const failure = input.error && !input.cancelled ? classifyLlmError(input.error) : null;
  const row: LlmCallRow = {
    id: uuidv4(),
    userId: input.trace.userId || null,
    taskId: input.trace.taskId || null,
    operation: input.trace.operation,
    model: input.model,
    providerHost: hostOf(input.baseUrl),
    promptVersion: input.promptVersion,
    streamed: input.streamed,
    status: input.cancelled ? 'cancelled' : failure ? 'error' : 'ok',
    errorCategory: failure?.category || null,
    httpStatus: failure?.httpStatus || null,
    latencyMs: Date.now() - input.startedAt,
    firstTokenMs: input.firstTokenAt ? input.firstTokenAt - input.startedAt : null,
    inputTokens: input.usage?.inputTokens ?? estimateTokens(input.inputText),
    outputTokens: input.usage?.outputTokens ?? (input.outputText ? estimateTokens(input.outputText) : 0),
    usageSource: input.usage ? 'provider' : 'estimated',
    inputChars: input.inputText.length,
    outputChars: input.outputText.length,
    createdAt: Date.now(),
  };

  void insertLlmCallRow(row).catch((error) => {
    log.warn('Failed to record LLM call', { error: error instanceof Error ? error.message : String(error) });
  });
}
