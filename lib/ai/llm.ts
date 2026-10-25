import axios from 'axios';
import type { AxiosResponse } from 'axios';
import config from '../config.js';
import type { SpeakerSummary } from '../audio-engine/types.js';
import type { UserSettings } from '../settings/user-settings-schema.js';
import { resolveLlmSettings } from '../settings/user-settings-schema.js';
import logger from '../shared/logger.js';
import {
  buildPromptVersion,
  readProviderUsage,
  recordLlmCall,
  type LlmTraceContext,
  type ProviderUsage,
} from './llm-trace.js';

const log = logger.child('llm');

export type { LlmTraceContext } from './llm-trace.js';

/** What a call is for (trace) and which prompt template produced it (promptVersion). */
interface LlmCallMeta {
  trace?: LlmTraceContext;
  promptVersion: string;
}

/** Hosts that rejected `stream_options`; streams to them are sent without it from then on. */
const hostsWithoutStreamUsage = new Set<string>();

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LlmTaskContext {
  title: string;
  transcript: string;
  language?: string | null;
  speakers?: SpeakerSummary[];
}

interface KnowledgeSourceChunk {
  content: string;
  startTime?: number | null;
  endTime?: number | null;
}

interface KnowledgeSource {
  title: string;
  transcript: string;
  language?: string | null;
  notebook?: string | null;
  tags?: string[];
  chunks?: KnowledgeSourceChunk[];
}

interface TagSuggestionContext {
  title: string;
  transcript: string;
  summary?: string | null;
  language?: string | null;
  notebook?: string | null;
  existingTags?: string[];
  historicalTags?: string[];
}

export const FALLBACK_SUMMARY_PROMPT =
  'Please summarize this audio. Include a concise overview, main topics, action items, and notable speaker takeaways.';

function getBaseUrl(settings?: Partial<UserSettings>) {
  return resolveLlmSettings(settings).baseUrl;
}

function getApiKey(settings?: Partial<UserSettings>) {
  return resolveLlmSettings(settings).apiKey;
}

function getModel(settings?: Partial<UserSettings>) {
  return resolveLlmSettings(settings).model;
}

export function isLlmConfigured(settings?: Partial<UserSettings>) {
  return Boolean(getApiKey(settings));
}

export function resolveSummaryPrompt(options?: {
  instructions?: string | null;
  taskPrompt?: string | null;
}) {
  const candidates = [
    options?.instructions,
    options?.taskPrompt,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return FALLBACK_SUMMARY_PROMPT;
}

async function callChatCompletion(
  messages: LlmMessage[],
  temperature = 0.2,
  settings?: Partial<UserSettings>,
  timeoutMs = 120000,
  meta?: LlmCallMeta,
) {
  const apiKey = getApiKey(settings);
  if (!apiKey) {
    throw new Error('LLM API is not configured. Please set LLM_API_KEY or OPENAI_API_KEY.');
  }

  const model = getModel(settings);
  const baseUrl = getBaseUrl(settings);
  const startedAt = Date.now();
  const traceBase = {
    trace: meta?.trace,
    model,
    baseUrl,
    promptVersion: meta?.promptVersion || 'untracked',
    streamed: false,
    startedAt,
    inputText: messages.map((item) => item.content).join('\n'),
  };

  let output: string;
  let usage: ProviderUsage | null = null;
  try {
    const response = await axios.post(
      `${baseUrl}/chat/completions`,
      {
        model,
        temperature,
        messages,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: timeoutMs,
      },
    );

    usage = readProviderUsage(response.data);
    const parsedContent = extractCompletionContent(response.data?.choices?.[0]?.message?.content);
    if (!parsedContent) {
      throw new Error('The LLM response did not contain message content.');
    }
    output = parsedContent.trim();
  } catch (error) {
    recordLlmCall({ ...traceBase, outputText: '', usage, error, cancelled: axios.isCancel(error) });
    throw error;
  }

  recordLlmCall({ ...traceBase, outputText: output, usage });
  return output;
}

function extractCompletionContent(content: unknown) {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('\n')
      .trimEnd();
  }

  return '';
}

function extractStreamDelta(payload: unknown) {
  const obj = payload as Record<string, any> | null | undefined;
  const choices = obj?.choices;
  const choice = Array.isArray(choices) ? choices[0] : undefined;
  const delta = choice?.delta?.content ?? choice?.message?.content ?? choice?.text;

  if (typeof delta === 'string') {
    return delta;
  }

  if (Array.isArray(delta)) {
    return delta
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('');
  }

  return '';
}

async function parseJsonCompletionStream(
  response: AxiosResponse<NodeJS.ReadableStream>,
  onDelta?: (text: string) => Promise<void> | void,
  usageSink?: { usage: ProviderUsage | null },
) {
  let raw = '';
  for await (const chunk of response.data) {
    raw += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
  }

  const payload = JSON.parse(raw);
  if (usageSink) usageSink.usage = readProviderUsage(payload);
  const content = extractCompletionContent(payload?.choices?.[0]?.message?.content);
  if (content && onDelta) {
    await onDelta(content);
  }
  return content.trim();
}

async function parseSseCompletionStream(
  response: AxiosResponse<NodeJS.ReadableStream>,
  onDelta?: (text: string) => Promise<void> | void,
  usageSink?: { usage: ProviderUsage | null },
) {
  let buffer = '';
  let output = '';

  const flushEvent = async (rawEvent: string) => {
    for (const line of rawEvent.split(/\r?\n/)) {
      if (!line.startsWith('data:')) {
        continue;
      }

      const data = line.slice(5).trim();
      if (!data) {
        continue;
      }
      if (data === '[DONE]') {
        return true;
      }

      try {
        const payload = JSON.parse(data);
        // With stream_options.include_usage the final frame carries usage and no delta.
        const frameUsage = usageSink ? readProviderUsage(payload) : null;
        if (frameUsage && usageSink) usageSink.usage = frameUsage;
        const delta = extractStreamDelta(payload);
        if (!delta) {
          continue;
        }

        output += delta;
        if (onDelta) {
          await onDelta(delta);
        }
      } catch (err) {
        if (config.debug.enabled) {
          log.debug('Skipping malformed SSE frame', { error: err instanceof Error ? err.message : String(err) });
        }
      }
    }

    return false;
  };

  for await (const chunk of response.data) {
    buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);

    let separatorIndex = buffer.indexOf('\n\n');
    while (separatorIndex !== -1) {
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

      const done = await flushEvent(rawEvent);
      if (done) {
        return output.trim();
      }

      separatorIndex = buffer.indexOf('\n\n');
    }
  }

  if (buffer.trim()) {
    await flushEvent(buffer);
  }

  return output.trim();
}

async function streamChatCompletion(
  messages: LlmMessage[],
  onDelta?: (text: string) => Promise<void> | void,
  temperature = 0.2,
  settings?: Partial<UserSettings>,
  signal?: AbortSignal,
  meta?: LlmCallMeta,
) {
  const apiKey = getApiKey(settings);
  if (!apiKey) {
    throw new Error('LLM API is not configured. Please set LLM_API_KEY or OPENAI_API_KEY.');
  }

  const model = getModel(settings);
  const baseUrl = getBaseUrl(settings);
  const startedAt = Date.now();
  let firstTokenAt: number | null = null;
  const usageSink: { usage: ProviderUsage | null } = { usage: null };
  const traceBase = {
    trace: meta?.trace,
    model,
    baseUrl,
    promptVersion: meta?.promptVersion || 'untracked',
    streamed: true,
    startedAt,
    inputText: messages.map((item) => item.content).join('\n'),
  };
  const timedDelta = async (text: string) => {
    if (firstTokenAt === null) firstTokenAt = Date.now();
    await onDelta?.(text);
  };

  const send = (includeUsage: boolean) => axios.post<NodeJS.ReadableStream>(
    `${baseUrl}/chat/completions`,
    {
      model,
      temperature,
      messages,
      stream: true,
      ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      responseType: 'stream',
      timeout: 300000,
      signal,
    },
  );

  let output = '';
  try {
    const host = new URL(baseUrl).host;
    let response: AxiosResponse<NodeJS.ReadableStream>;
    if (hostsWithoutStreamUsage.has(host)) {
      response = await send(false);
    } else {
      try {
        response = await send(true);
      } catch (error) {
        // Some OpenAI-compatible servers reject unknown fields; retry once without usage.
        const status = axios.isAxiosError(error) ? Number(error.response?.status || 0) : 0;
        if (status !== 400 && status !== 422) throw error;
        response = await send(false);
        // Only now is it clear the field was the problem (a genuine 400 fails again above).
        hostsWithoutStreamUsage.add(host);
        log.info('Provider rejected stream_options; streaming without usage', { host });
      }
    }

    const contentType = String(response.headers['content-type'] || '').toLowerCase();
    output = contentType.includes('application/json')
      ? await parseJsonCompletionStream(response, timedDelta, usageSink)
      : await parseSseCompletionStream(response, timedDelta, usageSink);
  } catch (error) {
    recordLlmCall({
      ...traceBase,
      firstTokenAt,
      outputText: output,
      usage: usageSink.usage,
      error,
      cancelled: Boolean(signal?.aborted) || axios.isCancel(error),
    });
    throw error;
  }

  recordLlmCall({ ...traceBase, firstTokenAt, outputText: output, usage: usageSink.usage });
  return output;
}

function buildContextBlock(context: LlmTaskContext) {
  const speakerLine =
    context.speakers && context.speakers.length > 0
      ? context.speakers.map((speaker) => speaker.label).join(', ')
      : 'Unknown';

  return [
    `Title: ${context.title}`,
    `Language: ${context.language || 'unknown'}`,
    `Speakers: ${speakerLine}`,
    '',
    'Transcript:',
    context.transcript || '(empty)',
  ].join('\n');
}

function formatTimestamp(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function buildSourceBlockWithTimestamps(sources: KnowledgeSource[]) {
  return sources
    .map((source, index) => {
      const header = [
        `Source ${index + 1}: ${source.title}`,
        `Language: ${source.language || 'unknown'}`,
        `Notebook: ${source.notebook || 'unassigned'}`,
        `Tags: ${(source.tags || []).join(', ') || 'none'}`,
      ].join('\n');

      if (source.chunks && source.chunks.length > 0) {
        const chunkTexts = source.chunks.map((chunk) => {
          const start = formatTimestamp(chunk.startTime);
          const end = formatTimestamp(chunk.endTime);
          const timeRange = start && end ? ` [${start}-${end}]` : start ? ` [${start}]` : '';
          return `${chunk.content}${timeRange}`;
        });
        return `${header}\n${chunkTexts.join('\n\n')}`;
      }

      return `${header}\n${source.transcript || '(empty transcript)'}`;
    })
    .join('\n\n---\n\n');
}

const CITATION_SYSTEM_PROMPT =
  'You answer questions across multiple audio transcripts. Synthesize only from the provided sources. ' +
  'When referencing specific information, cite inline using the format [Source N @ MM:SS] where N is the source number and MM:SS is the timestamp. ' +
  'If no timestamp is available, use [Source N]. Cite uncertainty clearly. ' +
  'End with a short "Sources" section listing the titles you relied on.';

function clipText(value: string | null | undefined, maxLength: number) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength).trimEnd()}...`;
}

function parseStringArrayCompletion(content: string) {
  const trimmed = content.trim();
  const candidates = [
    trimmed,
    trimmed.match(/\[[\s\S]*\]/)?.[0] || '',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item || '').trim()).filter(Boolean);
      }
      if (
        parsed
        && typeof parsed === 'object'
        && Array.isArray((parsed as { tags?: unknown[] }).tags)
      ) {
        return (parsed as { tags: unknown[] }).tags
          .map((item) => String(item || '').trim())
          .filter(Boolean);
      }
    } catch {
      // Fall through to text parsing below.
    }
  }

  return trimmed
    .split(/\r?\n|,/)
    .map((item) => item.replace(/^[-*•\s]+/, '').trim())
    .filter(Boolean);
}

const SUMMARY_SYSTEM_PROMPT =
  'You summarize audio transcripts for a knowledge management app. Use clear Markdown headings and stay grounded in the transcript.';

export async function generateTaskSummary(
  context: LlmTaskContext,
  instructions?: string,
  settings?: Partial<UserSettings>,
  taskPrompt?: string | null,
  trace?: Omit<LlmTraceContext, 'operation'>,
) {
  const prompt = resolveSummaryPrompt({
    instructions,
    taskPrompt,
  });

  return callChatCompletion(
    [
      {
        role: 'system',
        content: SUMMARY_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: `${prompt}\n\n${buildContextBlock(context)}`,
      },
    ],
    0.3,
    settings,
    1800000,
    {
      trace: trace && { ...trace, operation: 'summary' },
      // The template (user's summary prompt or the fallback) is part of the version.
      promptVersion: buildPromptVersion('summary', [SUMMARY_SYSTEM_PROMPT, prompt]),
    },
  );
}

const TAG_SUGGESTION_SYSTEM_PROMPT = [
  'You generate short, high-precision tags for audio tasks in a knowledge management app.',
  'Return JSON only.',
  'Return a JSON array of strings with 0 to 5 tags.',
  'Prefer reusing the provided historical tag vocabulary when it fits.',
  'Only introduce genuinely new tags when necessary, and keep new tags to at most 2.',
  'Each tag must be concise, specific, and useful for filtering.',
  'Do not return sentences, explanations, generic labels, timestamps, or filenames.',
].join(' ');

export async function generateTaskTagSuggestions(
  context: TagSuggestionContext,
  settings?: Partial<UserSettings>,
  trace?: Omit<LlmTraceContext, 'operation'>,
) {
  const completion = await callChatCompletion(
    [
      {
        role: 'system',
        content: TAG_SUGGESTION_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: [
          `Title: ${context.title}`,
          `Language: ${context.language || 'unknown'}`,
          `Notebook: ${context.notebook || 'unassigned'}`,
          `Existing tags: ${(context.existingTags || []).join(', ') || '(none)'}`,
          `Historical tag candidates: ${(context.historicalTags || []).join(', ') || '(none)'}`,
          '',
          'Summary:',
          clipText(context.summary, 2000) || '(none)',
          '',
          'Transcript excerpt:',
          clipText(context.transcript, 5000) || '(empty)',
          '',
          'Return JSON only. Example: ["customer feedback", "pricing", "follow-up"]',
        ].join('\n'),
      },
    ],
    0.1,
    settings,
    120000,
    {
      trace: trace && { ...trace, operation: 'tag_suggestion' },
      promptVersion: buildPromptVersion('tag_suggestion', [TAG_SUGGESTION_SYSTEM_PROMPT]),
    },
  );

  return parseStringArrayCompletion(completion);
}

const TASK_CHAT_SYSTEM_PROMPT =
  'You are an assistant for an audio workspace. Answer based on the provided transcript, cite uncertainty when the transcript is incomplete, and keep answers concise unless the user asks for more detail.';

export async function chatWithTranscript(
  context: LlmTaskContext,
  history: LlmMessage[],
  message: string,
  settings?: Partial<UserSettings>,
  trace?: Omit<LlmTraceContext, 'operation'>,
) {
  return callChatCompletion(
    [
      {
        role: 'system',
        content: TASK_CHAT_SYSTEM_PROMPT,
      },
      {
        role: 'system',
        content: buildContextBlock(context),
      },
      ...history,
      {
        role: 'user',
        content: message,
      },
    ],
    0.2,
    settings,
    undefined,
    {
      trace: trace && { ...trace, operation: 'task_chat' },
      promptVersion: buildPromptVersion('task_chat', [TASK_CHAT_SYSTEM_PROMPT]),
    },
  );
}

export async function streamChatWithTranscript(
  context: LlmTaskContext,
  history: LlmMessage[],
  message: string,
  settings?: Partial<UserSettings>,
  onDelta?: (text: string) => Promise<void> | void,
  signal?: AbortSignal,
  trace?: Omit<LlmTraceContext, 'operation'>,
) {
  return streamChatCompletion(
    [
      {
        role: 'system',
        content: TASK_CHAT_SYSTEM_PROMPT,
      },
      {
        role: 'system',
        content: buildContextBlock(context),
      },
      ...history,
      {
        role: 'user',
        content: message,
      },
    ],
    onDelta,
    0.2,
    settings,
    signal,
    {
      trace: trace && { ...trace, operation: 'task_chat' },
      promptVersion: buildPromptVersion('task_chat', [TASK_CHAT_SYSTEM_PROMPT]),
    },
  );
}

export async function answerAcrossKnowledgeBase(
  query: string,
  sources: KnowledgeSource[],
  settings?: Partial<UserSettings>,
  trace?: Omit<LlmTraceContext, 'operation'>,
) {
  if (sources.length === 0) {
    throw new Error('No source transcripts available for knowledge-base answering.');
  }

  const sourceBlock = buildSourceBlockWithTimestamps(sources);

  return callChatCompletion(
    [
      {
        role: 'system',
        content: CITATION_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: `Question: ${query}\n\nKnowledge sources:\n\n${sourceBlock}`,
      },
    ],
    0.2,
    settings,
    undefined,
    {
      trace: trace && { ...trace, operation: 'knowledge_chat' },
      promptVersion: buildPromptVersion('knowledge_chat', [CITATION_SYSTEM_PROMPT]),
    },
  );
}

export async function streamAnswerAcrossKnowledgeBase(
  query: string,
  sources: KnowledgeSource[],
  history: LlmMessage[],
  settings?: Partial<UserSettings>,
  onDelta?: (text: string) => Promise<void> | void,
  signal?: AbortSignal,
  trace?: Omit<LlmTraceContext, 'operation'>,
) {
  if (sources.length === 0 && history.length === 0) {
    throw new Error('No source transcripts or conversation history available.');
  }

  const sourceBlock = buildSourceBlockWithTimestamps(sources);

  const messages: LlmMessage[] = [
    {
      role: 'system',
      content: CITATION_SYSTEM_PROMPT,
    },
  ];

  if (sourceBlock) {
    messages.push({
      role: 'system',
      content: `Knowledge sources:\n\n${sourceBlock}`,
    });
  }

  messages.push(...history);
  messages.push({
    role: 'user',
    content: query,
  });

  return streamChatCompletion(messages, onDelta, 0.2, settings, signal, {
    trace: trace && { ...trace, operation: 'knowledge_chat' },
    promptVersion: buildPromptVersion('knowledge_chat', [CITATION_SYSTEM_PROMPT]),
  });
}

export function getLlmInfo(settings?: Partial<UserSettings>) {
  return {
    configured: isLlmConfigured(settings),
    model: getModel(settings),
    baseUrl: getBaseUrl(settings),
  };
}
