import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import { createServiceError, createTaskError } from '../errors.js';
import { BaseTranscriptionProvider } from './base.js';
import type { ProviderTranscriptionPayload, TranscriptionJobInput } from '../types.js';

export class AzureOpenAIProvider extends BaseTranscriptionProvider {
  readonly name = 'azure-openai';

  readonly capabilities = {
    diarization: 'none',
    wordTimestamps: false,
    translation: false,
    asyncPolling: false,
  } as const;

  async transcribe(input: TranscriptionJobInput): Promise<ProviderTranscriptionPayload> {
    const endpoint = (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/$/, '');
    const deployment = process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT || '';
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-10-21';
    const apiKey = process.env.AZURE_OPENAI_API_KEY || '';

    if (!endpoint || !deployment || !apiKey) {
      throw createServiceError(
        'AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT, and AZURE_OPENAI_API_KEY are required.',
        this.name,
      );
    }

    if (input.task === 'translate') {
      throw createTaskError('Azure OpenAI provider does not currently expose translation in this project.', this.name);
    }

    const formData = new FormData();
    formData.append('file', fs.createReadStream(input.filePath));
    formData.append('response_format', 'verbose_json');

    if (input.language && input.language !== 'auto') {
      formData.append('language', input.language);
    }

    let response;
    try {
      response = await axios.post(
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
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = Number(error.response?.status || 0);
        const detail =
          typeof error.response?.data?.error?.message === 'string'
            ? error.response?.data?.error?.message
            : error.message;
        const message = `Azure OpenAI transcription failed: ${detail}`;
        if (status >= 400 && status < 500 && ![408, 409, 423, 425, 429].includes(status)) {
          throw createTaskError(message, this.name, error);
        }
        throw createServiceError(message, this.name, error);
      }

      throw createServiceError(
        error instanceof Error ? error.message : 'Azure OpenAI transcription failed.',
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
