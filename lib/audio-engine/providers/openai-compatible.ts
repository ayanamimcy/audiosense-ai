import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
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
      throw new Error('OPENAI_TRANSCRIPTION_API_KEY or OPENAI_API_KEY is required.');
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

    const response = await axios.post(`${baseUrl}${endpoint}`, formData, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...formData.getHeaders(),
      },
      timeout: 600000,
    });

    return {
      payload:
        response.data && typeof response.data === 'object' && !Array.isArray(response.data)
          ? (response.data as Record<string, unknown>)
          : {},
    };
  }
}
