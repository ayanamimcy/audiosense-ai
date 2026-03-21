import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';

export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

export interface SpeakerSummary {
  id: string;
  label: string;
  segmentCount: number;
  durationSeconds: number;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  durationSeconds?: number;
  segments: TranscriptSegment[];
  speakers: SpeakerSummary[];
  raw: unknown;
}

export interface TranscriptionJobInput {
  filePath: string;
  language?: string;
  diarization?: boolean;
}

export interface TranscriptionProvider {
  readonly name: string;
  transcribe(input: TranscriptionJobInput): Promise<TranscriptionResult>;
}

export interface TranscriptionProviderInfo {
  id: string;
  label: string;
  configured: boolean;
  description: string;
}

function normalizeSegments(rawSegments: unknown[] = []): TranscriptSegment[] {
  return rawSegments
    .filter((segment) => typeof (segment as { text?: unknown })?.text === 'string')
    .map((segment, index) => {
      const item = segment as {
        id?: string | number;
        start?: number;
        end?: number;
        text: string;
        speaker?: string;
      };

      return {
        id: String(item.id ?? index + 1),
        start: typeof item.start === 'number' ? item.start : 0,
        end: typeof item.end === 'number' ? item.end : 0,
        text: item.text.trim(),
        speaker: item.speaker?.trim() || undefined,
      };
    });
}

function summarizeSpeakers(segments: TranscriptSegment[]): SpeakerSummary[] {
  const speakers = new Map<string, SpeakerSummary>();

  for (const segment of segments) {
    const label = segment.speaker || 'Speaker';
    const duration = Math.max(0, segment.end - segment.start);
    const existing = speakers.get(label);

    if (existing) {
      existing.segmentCount += 1;
      existing.durationSeconds += duration;
      continue;
    }

    speakers.set(label, {
      id: label,
      label,
      segmentCount: 1,
      durationSeconds: duration,
    });
  }

  return Array.from(speakers.values()).sort((a, b) => b.durationSeconds - a.durationSeconds);
}

function extractTextFromSegments(segments: TranscriptSegment[]) {
  return segments.map((segment) => segment.text).join(' ').trim();
}

function buildResult(data: Record<string, unknown>) {
  const segments = normalizeSegments(Array.isArray(data.segments) ? data.segments : []);
  const speakers = summarizeSpeakers(segments);
  const text =
    typeof data.text === 'string' && data.text.trim() ? data.text.trim() : extractTextFromSegments(segments);

  return {
    text,
    language: typeof data.language === 'string' ? data.language : undefined,
    durationSeconds:
      typeof data.duration === 'number'
        ? data.duration
        : segments.length > 0
          ? Math.max(...segments.map((segment) => segment.end))
          : undefined,
    segments,
    speakers,
    raw: data,
  } satisfies TranscriptionResult;
}

function getTaskStatusPath(identifier: string) {
  const template = process.env.WHISPERX_TASK_STATUS_PATH || '/task/{id}';
  return template.replace('{id}', identifier);
}

class WhisperXProvider implements TranscriptionProvider {
  readonly name = 'whisperx';

  async transcribe(input: TranscriptionJobInput): Promise<TranscriptionResult> {
    const whisperxUrl = process.env.WHISPERX_API_URL || 'http://localhost:8000';
    const endpoint = process.env.WHISPERX_TRANSCRIBE_PATH || '/speech-to-text';
    const formData = new FormData();

    formData.append('file', fs.createReadStream(input.filePath));
    if (input.language && input.language !== 'auto') {
      formData.append('language', input.language);
    }
    if (input.diarization !== undefined) {
      formData.append('diarize', String(input.diarization));
    }

    const response = await axios.post(`${whisperxUrl}${endpoint}`, formData, {
      headers: formData.getHeaders(),
      timeout: 600000,
    });

    const payload = await this.resolveAsyncPayload(whisperxUrl, response.data);
    return buildResult(payload);
  }

  private async resolveAsyncPayload(baseUrl: string, data: unknown) {
    const payload = data as Record<string, unknown>;
    const taskId = payload.identifier || payload.task_id || payload.id;
    if (!taskId || payload.segments || payload.text) {
      return payload;
    }

    for (let attempt = 0; attempt < 120; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const pollResponse = await axios.get(`${baseUrl}${getTaskStatusPath(String(taskId))}`, {
        timeout: 30000,
      });
      const pollData = pollResponse.data as Record<string, unknown>;
      const status = String(pollData.status || '').toLowerCase();

      if (['completed', 'done', 'success'].includes(status)) {
        return (pollData.result || pollData.response || pollData) as Record<string, unknown>;
      }

      if (['failed', 'error'].includes(status)) {
        throw new Error(
          typeof pollData.error === 'string'
            ? pollData.error
            : `WhisperX task failed: ${JSON.stringify(pollData)}`,
        );
      }
    }

    throw new Error('WhisperX task polling timed out after 10 minutes.');
  }
}

class OpenAICompatibleProvider implements TranscriptionProvider {
  readonly name = 'openai-compatible';

  async transcribe(input: TranscriptionJobInput): Promise<TranscriptionResult> {
    const baseUrl = (process.env.OPENAI_TRANSCRIPTION_API_BASE_URL || 'https://api.openai.com/v1').replace(
      /\/$/,
      '',
    );
    const apiKey = process.env.OPENAI_TRANSCRIPTION_API_KEY || process.env.OPENAI_API_KEY;
    const endpoint = process.env.OPENAI_TRANSCRIPTION_PATH || '/audio/transcriptions';
    const model = process.env.OPENAI_TRANSCRIPTION_MODEL || 'whisper-1';

    if (!apiKey) {
      throw new Error('OPENAI_TRANSCRIPTION_API_KEY or OPENAI_API_KEY is required.');
    }

    const formData = new FormData();
    formData.append('file', fs.createReadStream(input.filePath));
    formData.append('model', model);
    formData.append(
      'response_format',
      process.env.OPENAI_TRANSCRIPTION_RESPONSE_FORMAT || 'verbose_json',
    );
    if (input.language && input.language !== 'auto') {
      formData.append('language', input.language);
    }

    const response = await axios.post(`${baseUrl}${endpoint}`, formData, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...formData.getHeaders(),
      },
      timeout: 600000,
    });

    const data = response.data as Record<string, unknown>;
    return buildResult(data);
  }
}

class AzureOpenAIProvider implements TranscriptionProvider {
  readonly name = 'azure-openai';

  async transcribe(input: TranscriptionJobInput): Promise<TranscriptionResult> {
    const endpoint = (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/$/, '');
    const deployment = process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT || '';
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-10-21';
    const apiKey = process.env.AZURE_OPENAI_API_KEY || '';

    if (!endpoint || !deployment || !apiKey) {
      throw new Error(
        'AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT, and AZURE_OPENAI_API_KEY are required.',
      );
    }

    const formData = new FormData();
    formData.append('file', fs.createReadStream(input.filePath));
    if (input.language && input.language !== 'auto') {
      formData.append('language', input.language);
    }
    formData.append('response_format', 'verbose_json');

    const response = await axios.post(
      `${endpoint}/openai/deployments/${deployment}/audio/transcriptions?api-version=${apiVersion}`,
      formData,
      {
        headers: {
          'api-key': apiKey,
          ...formData.getHeaders(),
        },
        timeout: 600000,
      },
    );

    const data = response.data as Record<string, unknown>;
    return buildResult(data);
  }
}

function getProviderName(input?: string) {
  return (input || process.env.TRANSCRIPTION_PROVIDER || 'whisperx').toLowerCase();
}

export function createTranscriptionProvider(providerName?: string): TranscriptionProvider {
  const provider = getProviderName(providerName);

  switch (provider) {
    case 'whisperx':
      return new WhisperXProvider();
    case 'openai-compatible':
    case 'openai':
    case 'qwen-openai':
      return new OpenAICompatibleProvider();
    case 'azure-openai':
      return new AzureOpenAIProvider();
    default:
      throw new Error(`Unsupported transcription provider: ${provider}`);
  }
}

export function getAvailableTranscriptionProviders(): TranscriptionProviderInfo[] {
  return [
    {
      id: 'whisperx',
      label: 'WhisperX',
      configured: Boolean(process.env.WHISPERX_API_URL || 'http://localhost:8000'),
      description: 'Self-hosted service with diarization and segment-level timestamps.',
    },
    {
      id: 'openai-compatible',
      label: 'OpenAI-Compatible ASR',
      configured: Boolean(process.env.OPENAI_TRANSCRIPTION_API_KEY || process.env.OPENAI_API_KEY),
      description: 'Covers OpenAI-style audio transcription endpoints and compatible gateways.',
    },
    {
      id: 'azure-openai',
      label: 'Azure OpenAI ASR',
      configured: Boolean(
        process.env.AZURE_OPENAI_ENDPOINT &&
          process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT &&
          process.env.AZURE_OPENAI_API_KEY,
      ),
      description: 'Microsoft-hosted OpenAI deployment for transcription workloads.',
    },
  ];
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const secs = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');

  return `${mins}:${secs}`;
}

export function formatTranscriptMarkdown(result: TranscriptionResult) {
  const sections: string[] = ['## Transcript'];

  if (result.speakers.length > 0) {
    sections.push('### Speakers');
    for (const speaker of result.speakers) {
      sections.push(
        `- ${speaker.label}: ${speaker.segmentCount} segments, ${speaker.durationSeconds.toFixed(1)}s`,
      );
    }
  }

  if (result.segments.length > 0) {
    sections.push('', '### Timeline');
    for (const segment of result.segments) {
      const speaker = segment.speaker ? `**${segment.speaker}** ` : '';
      sections.push(
        `- [${formatTime(segment.start)} - ${formatTime(segment.end)}] ${speaker}${segment.text}`,
      );
    }
  } else if (result.text) {
    sections.push('', result.text);
  }

  return sections.join('\n');
}
