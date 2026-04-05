import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import { createServiceError, createTaskError } from '../errors.js';
import { BaseTranscriptionProvider } from './base.js';
import type { ProviderTranscriptionPayload, TranscriptionJobInput } from '../types.js';
import type { OpenAIWhisperSettings } from '../../user-settings-schema.js';

function normalizeBaseUrl(url: string) {
  return url.replace(/\/$/, '');
}

export class OpenAICompatibleProvider extends BaseTranscriptionProvider {
  readonly name = 'openai-compatible';
  private readonly config: OpenAIWhisperSettings;

  constructor(config: OpenAIWhisperSettings) {
    super();
    this.config = config;
  }

  readonly capabilities = {
    diarization: 'none',
    wordTimestamps: true,
    translation: true,
    asyncPolling: false,
  } as const;

  async transcribe(input: TranscriptionJobInput): Promise<ProviderTranscriptionPayload> {
    const baseUrl = normalizeBaseUrl(this.config.baseUrl || 'https://api.openai.com/v1');
    const apiKey = this.config.apiKey;
    const transcriptionPath = this.config.transcriptionPath || '/audio/transcriptions';
    const translationPath = this.config.translationPath || '/audio/translations';
    const endpoint = input.task === 'translate' ? translationPath : transcriptionPath;
    const model = this.config.model || 'whisper-1';

    if (!apiKey) {
      throw createServiceError('OPENAI_TRANSCRIPTION_API_KEY or OPENAI_API_KEY is required.', this.name);
    }

    const formData = new FormData();
    formData.append('file', fs.createReadStream(input.filePath));
    formData.append('model', model);
    formData.append('response_format', this.config.responseFormat || 'verbose_json');

    if (input.language && input.language !== 'auto' && input.task !== 'translate') {
      formData.append('language', input.language);
    }

    if (input.wordTimestamps && !this.config.disableTimestampGranularities) {
      formData.append('timestamp_granularities[]', 'segment');
      formData.append('timestamp_granularities[]', 'word');
    }

    let response;
    try {
      response = await axios.post(`${baseUrl}${endpoint}`, formData, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...formData.getHeaders(),
        },
        timeout: 600000,
      });
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = Number(error.response?.status || 0);
        const detail =
          typeof error.response?.data?.error?.message === 'string'
            ? error.response?.data?.error?.message
            : error.message;
        const message = `OpenAI-compatible transcription failed: ${detail}`;
        if (status >= 400 && status < 500 && ![408, 409, 423, 425, 429].includes(status)) {
          throw createTaskError(message, this.name, error);
        }
        throw createServiceError(message, this.name, error);
      }

      throw createServiceError(
        error instanceof Error ? error.message : 'OpenAI-compatible transcription failed.',
        this.name,
        error,
      );
    }

    return {
      payload:
        response.data && typeof response.data === 'object' && !Array.isArray(response.data)
          ? (response.data as Record<string, unknown>)
          : {},
    };
  }
}
