import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import { BaseTranscriptionProvider } from './base.js';
import type { ProviderTranscriptionPayload, TranscriptionJobInput } from '../types.js';

function getTaskStatusPath(identifier: string) {
  const template = process.env.WHISPERX_TASK_STATUS_PATH || '/task/{id}';
  return template.replace('{id}', identifier);
}

export class WhisperXProvider extends BaseTranscriptionProvider {
  readonly name = 'whisperx';

  readonly capabilities = {
    diarization: 'integrated',
    wordTimestamps: true,
    translation: false,
    asyncPolling: true,
  } as const;

  async transcribe(input: TranscriptionJobInput): Promise<ProviderTranscriptionPayload> {
    const baseUrl = process.env.WHISPERX_API_URL || 'http://localhost:8000';
    const endpoint = process.env.WHISPERX_TRANSCRIBE_PATH || '/speech-to-text';
    const formData = new FormData();

    formData.append('file', fs.createReadStream(input.filePath));
    if (input.language && input.language !== 'auto') {
      formData.append('language', input.language);
    }
    if (input.diarization !== undefined) {
      formData.append('diarize', String(input.diarization));
    }

    const response = await axios.post(`${baseUrl}${endpoint}`, formData, {
      headers: formData.getHeaders(),
      timeout: 600000,
    });

    return {
      payload: await this.resolveAsyncPayload(baseUrl, response.data),
    };
  }

  private async resolveAsyncPayload(baseUrl: string, rawPayload: unknown) {
    const payload =
      rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
        ? (rawPayload as Record<string, unknown>)
        : {};
    const taskId = payload.identifier || payload.task_id || payload.id;

    if (!taskId || payload.segments || payload.text) {
      return payload;
    }

    for (let attempt = 0; attempt < 120; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      const pollResponse = await axios.get(`${baseUrl}${getTaskStatusPath(String(taskId))}`, {
        timeout: 30000,
      });
      const pollPayload =
        pollResponse.data && typeof pollResponse.data === 'object' && !Array.isArray(pollResponse.data)
          ? (pollResponse.data as Record<string, unknown>)
          : {};
      const status = String(pollPayload.status || '').toLowerCase();

      if (['completed', 'done', 'success'].includes(status)) {
        const result =
          pollPayload.result && typeof pollPayload.result === 'object' && !Array.isArray(pollPayload.result)
            ? (pollPayload.result as Record<string, unknown>)
            : pollPayload.response && typeof pollPayload.response === 'object' && !Array.isArray(pollPayload.response)
              ? (pollPayload.response as Record<string, unknown>)
              : pollPayload;
        return result;
      }

      if (['failed', 'error'].includes(status)) {
        throw new Error(
          typeof pollPayload.error === 'string'
            ? pollPayload.error
            : `WhisperX task failed: ${JSON.stringify(pollPayload)}`,
        );
      }
    }

    throw new Error('WhisperX task polling timed out after 10 minutes.');
  }
}

