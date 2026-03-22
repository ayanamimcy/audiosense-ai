import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import { BaseTranscriptionProvider } from './base.js';
import type { ProviderTranscriptionPayload, TranscriptionJobInput } from '../types.js';

function normalizeBaseUrl(url: string) {
  return url.replace(/\/$/, '');
}

export class OpenAICompatibleProvider extends BaseTranscriptionProvider {
  readonly name = 'openai-compatible';

  readonly capabilities = {
    diarization: 'none',
    wordTimestamps: true,
    translation: true,
    asyncPolling: false,
  } as const;

  async transcribe(input: TranscriptionJobInput): Promise<ProviderTranscriptionPayload> {
    const baseUrl = normalizeBaseUrl(process.env.OPENAI_TRANSCRIPTION_API_BASE_URL || 'https://api.openai.com/v1');
    const apiKey = process.env.OPENAI_TRANSCRIPTION_API_KEY || process.env.OPENAI_API_KEY;
    const transcriptionPath = process.env.OPENAI_TRANSCRIPTION_PATH || '/audio/transcriptions';
    const translationPath = process.env.OPENAI_TRANSLATION_PATH || '/audio/translations';
    const endpoint = input.task === 'translate' ? translationPath : transcriptionPath;
    const model = process.env.OPENAI_TRANSCRIPTION_MODEL || 'whisper-1';

    if (!apiKey) {
      throw new Error('OPENAI_TRANSCRIPTION_API_KEY or OPENAI_API_KEY is required.');
    }

    const formData = new FormData();
    formData.append('file', fs.createReadStream(input.filePath));
    formData.append('model', model);
    formData.append('response_format', process.env.OPENAI_TRANSCRIPTION_RESPONSE_FORMAT || 'verbose_json');

    if (input.language && input.language !== 'auto' && input.task !== 'translate') {
      formData.append('language', input.language);
    }

    if (input.wordTimestamps && process.env.OPENAI_TRANSCRIPTION_DISABLE_TIMESTAMP_GRANULARITIES !== 'true') {
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

