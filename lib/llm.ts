import axios from 'axios';
import type { AxiosResponse } from 'axios';
import type { SpeakerSummary } from './transcription.js';
import type { UserSettings } from './user-settings-schema.js';
import { resolveLlmSettings } from './user-settings-schema.js';

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

interface KnowledgeSource {
  title: string;
  transcript: string;
  language?: string | null;
  notebook?: string | null;
  tags?: string[];
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
) {
  const apiKey = getApiKey(settings);
  if (!apiKey) {
    throw new Error('LLM API is not configured. Please set LLM_API_KEY or OPENAI_API_KEY.');
  }

  const response = await axios.post(
    `${getBaseUrl(settings)}/chat/completions`,
    {
      model: getModel(settings),
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

  const content = response.data?.choices?.[0]?.message?.content;
  const parsedContent = extractCompletionContent(content);
  if (parsedContent) {
    return parsedContent.trim();
  }

  throw new Error('The LLM response did not contain message content.');
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
) {
  let raw = '';
  for await (const chunk of response.data) {
    raw += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
  }

  const payload = JSON.parse(raw);
  const content = extractCompletionContent(payload?.choices?.[0]?.message?.content);
  if (content && onDelta) {
    await onDelta(content);
  }
  return content.trim();
}

async function parseSseCompletionStream(
  response: AxiosResponse<NodeJS.ReadableStream>,
  onDelta?: (text: string) => Promise<void> | void,
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
        const delta = extractStreamDelta(payload);
        if (!delta) {
          continue;
        }

        output += delta;
        if (onDelta) {
          await onDelta(delta);
        }
      } catch (err) {
        if (process.env.DEBUG) {
          console.debug('[llm] skipping malformed SSE frame:', err);
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
) {
  const apiKey = getApiKey(settings);
  if (!apiKey) {
    throw new Error('LLM API is not configured. Please set LLM_API_KEY or OPENAI_API_KEY.');
  }

  const response = await axios.post<NodeJS.ReadableStream>(
    `${getBaseUrl(settings)}/chat/completions`,
    {
      model: getModel(settings),
      temperature,
      messages,
      stream: true,
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

  const contentType = String(response.headers['content-type'] || '').toLowerCase();
  if (contentType.includes('application/json')) {
    return parseJsonCompletionStream(response, onDelta);
  }

  return parseSseCompletionStream(response, onDelta);
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

export async function generateTaskSummary(
  context: LlmTaskContext,
  instructions?: string,
  settings?: Partial<UserSettings>,
  taskPrompt?: string | null,
) {
  const prompt = resolveSummaryPrompt({
    instructions,
    taskPrompt,
  });

  return callChatCompletion(
    [
      {
        role: 'system',
        content:
          'You summarize audio transcripts for a knowledge management app. Use clear Markdown headings and stay grounded in the transcript.',
      },
      {
        role: 'user',
        content: `${prompt}\n\n${buildContextBlock(context)}`,
      },
    ],
    0.3,
    settings,
    1800000,
  );
}

export async function chatWithTranscript(
  context: LlmTaskContext,
  history: LlmMessage[],
  message: string,
  settings?: Partial<UserSettings>,
) {
  return callChatCompletion(
    [
      {
        role: 'system',
        content:
          'You are an assistant for an audio workspace. Answer based on the provided transcript, cite uncertainty when the transcript is incomplete, and keep answers concise unless the user asks for more detail.',
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
  );
}

export async function streamChatWithTranscript(
  context: LlmTaskContext,
  history: LlmMessage[],
  message: string,
  settings?: Partial<UserSettings>,
  onDelta?: (text: string) => Promise<void> | void,
  signal?: AbortSignal,
) {
  return streamChatCompletion(
    [
      {
        role: 'system',
        content:
          'You are an assistant for an audio workspace. Answer based on the provided transcript, cite uncertainty when the transcript is incomplete, and keep answers concise unless the user asks for more detail.',
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
  );
}

export async function answerAcrossKnowledgeBase(
  query: string,
  sources: KnowledgeSource[],
  settings?: Partial<UserSettings>,
) {
  if (sources.length === 0) {
    throw new Error('No source transcripts available for knowledge-base answering.');
  }

  const sourceBlock = sources
    .map((source, index) =>
      [
        `Source ${index + 1}: ${source.title}`,
        `Language: ${source.language || 'unknown'}`,
        `Notebook: ${source.notebook || 'unassigned'}`,
        `Tags: ${(source.tags || []).join(', ') || 'none'}`,
        source.transcript || '(empty transcript)',
      ].join('\n'),
    )
    .join('\n\n---\n\n');

  return callChatCompletion(
    [
      {
        role: 'system',
        content:
          'You answer questions across multiple audio transcripts. Synthesize only from the provided sources, cite uncertainty clearly, and end with a short "Sources" section listing the titles you relied on.',
      },
      {
        role: 'user',
        content: `Question: ${query}\n\nKnowledge sources:\n\n${sourceBlock}`,
      },
    ],
    0.2,
    settings,
  );
}

export function getLlmInfo(settings?: Partial<UserSettings>) {
  return {
    configured: isLlmConfigured(settings),
    model: getModel(settings),
    baseUrl: getBaseUrl(settings),
  };
}
