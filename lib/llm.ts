import axios from 'axios';
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
  settings?: Partial<UserSettings>;
}) {
  const candidates = [
    options?.instructions,
    options?.taskPrompt,
    typeof options?.settings?.defaultSummaryPrompt === 'string'
      ? options.settings.defaultSummaryPrompt
      : '',
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
      timeout: 120000,
    },
  );

  const content = response.data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('\n')
      .trim();
  }

  throw new Error('The LLM response did not contain message content.');
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
    settings,
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
