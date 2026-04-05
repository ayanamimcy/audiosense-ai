import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { ensureLocalAudioRuntime, getLocalAudioRuntimeBaseUrl } from '../local-runtime.js';
import { createServiceError, createTaskError } from '../errors.js';
import { BaseTranscriptionProvider } from './base.js';
import type { ProviderTranscriptionPayload, TranscriptionJobInput } from '../types.js';
import type { LocalRuntimeSettings } from '../../user-settings-schema.js';

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readWarnings(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

export class LocalPythonProvider extends BaseTranscriptionProvider {
  readonly name = 'local-python';
  private readonly config: LocalRuntimeSettings;

  constructor(config: LocalRuntimeSettings) {
    super();
    this.config = config;
  }

  readonly capabilities = {
    diarization: 'mergeable',
    wordTimestamps: true,
    translation: true,
    asyncPolling: false,
  } as const;

  async healthCheck() {
    try {
      await ensureLocalAudioRuntime(this.config.baseUrl);
      const response = await axios.get(`${getLocalAudioRuntimeBaseUrl(this.config.baseUrl)}/health`, {
        timeout: 1_500,
      });
      const ok = response.data?.ok !== false;
      return {
        ok,
        detail: ok ? undefined : 'Local audio runtime health check returned not ok.',
      };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : 'Local audio runtime is unavailable.',
      };
    }
  }

  async transcribe(input: TranscriptionJobInput): Promise<ProviderTranscriptionPayload> {
    try {
      await ensureLocalAudioRuntime(this.config.baseUrl);
    } catch (error) {
      throw createServiceError(
        error instanceof Error ? error.message : 'Local audio runtime is unavailable.',
        this.name,
        error,
      );
    }

    const formData = new FormData();
    formData.append(
      'file',
      fs.createReadStream(input.filePath),
      {
        filename: input.fileName || path.basename(input.filePath),
        contentType: input.mimeType || 'application/octet-stream',
      },
    );
    formData.append('language', input.language && input.language !== 'auto' ? input.language : '');
    formData.append('diarization', String(Boolean(input.diarization)));
    formData.append('word_timestamps', String(Boolean(input.wordTimestamps || input.diarization)));
    formData.append('task', input.task || 'transcribe');
    formData.append('translation_target_language', input.translationTargetLanguage || '');
    formData.append(
      'expected_speakers',
      input.expectedSpeakers !== null && input.expectedSpeakers !== undefined
        ? String(input.expectedSpeakers)
        : '',
    );
    formData.append('diarization_strategy', readString(this.config.diarizationStrategy) || '');
    formData.append('backend', readString(this.config.backendId) || '');
    formData.append('model_name', readString(this.config.modelName) || '');
    formData.append('hf_token', readString(this.config.hfToken) || '');

    let response;
    try {
      response = await axios.post(
        `${getLocalAudioRuntimeBaseUrl(this.config.baseUrl)}/transcribe-file`,
        formData,
        {
          headers: formData.getHeaders(),
          timeout: Math.max(60_000, Number(this.config.requestTimeoutMs || 3_600_000)),
        },
      );
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = Number(error.response?.status || 0);
        const detail =
          typeof error.response?.data?.detail === 'string'
            ? error.response?.data?.detail
            : error.message;
        const message = `Local audio runtime request failed: ${detail}`;
        if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
          throw createTaskError(message, this.name, error);
        }
        throw createServiceError(message, this.name, error);
      }

      throw createServiceError(
        error instanceof Error ? error.message : 'Local audio runtime request failed.',
        this.name,
        error,
      );
    }

    const payload =
      response.data && typeof response.data === 'object' && !Array.isArray(response.data)
        ? (response.data as Record<string, unknown>)
        : {};

    return {
      payload,
      warnings: readWarnings(payload.warnings),
    };
  }
}
