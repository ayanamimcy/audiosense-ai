import axios from 'axios';
import { ensureLocalAudioRuntime, getLocalAudioRuntimeBaseUrl } from '../local-runtime.js';
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

  async transcribe(input: TranscriptionJobInput): Promise<ProviderTranscriptionPayload> {
    await ensureLocalAudioRuntime(this.config.baseUrl);

    let response;
    try {
      response = await axios.post(
        `${getLocalAudioRuntimeBaseUrl(this.config.baseUrl)}/transcribe`,
        {
          file_path: input.filePath,
          language: input.language && input.language !== 'auto' ? input.language : null,
          diarization: Boolean(input.diarization),
          word_timestamps: Boolean(input.wordTimestamps || input.diarization),
          task: input.task || 'transcribe',
          translation_target_language: input.translationTargetLanguage || null,
          expected_speakers: input.expectedSpeakers ?? null,
          diarization_strategy: readString(this.config.diarizationStrategy),
          backend: readString(this.config.backendId),
          model_name: readString(this.config.modelName),
          hf_token: readString(this.config.hfToken),
        },
        {
          timeout: Math.max(60_000, Number(this.config.requestTimeoutMs || 3_600_000)),
        },
      );
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const detail =
          typeof error.response?.data?.detail === 'string'
            ? error.response?.data?.detail
            : error.message;
        throw new Error(`Local audio runtime request failed: ${detail}`);
      }

      throw error;
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
