import axios from 'axios';
import { logSubtitleSplitEvent } from './subtitle-split-observability.js';
import type { LlmSplitConfig, SplitSegmentByLlmOptions } from './subtitle-split-llm-types.js';

export async function requestSubtitleSplitCompletion(
  config: LlmSplitConfig,
  requestBody: Record<string, unknown>,
  requestTimeoutMs: number,
  attempt: number,
  options: SplitSegmentByLlmOptions,
) {
  logSubtitleSplitEvent('llm_split_request', {
    model: config.model,
    attempt,
    chunkIndex: options.chunkIndex,
    chunkCount: options.chunkCount,
    unitCount: options.unitCount,
    source: options.source,
    request: {
      url: `${config.baseUrl}/chat/completions`,
      timeoutMs: requestTimeoutMs,
      body: requestBody,
    },
  });

  try {
    const response = await axios.post(
      `${config.baseUrl}/chat/completions`,
      requestBody,
      {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: requestTimeoutMs,
      },
    );

    logSubtitleSplitEvent('llm_split_response', {
      model: config.model,
      attempt,
      chunkIndex: options.chunkIndex,
      chunkCount: options.chunkCount,
      unitCount: options.unitCount,
      source: options.source,
      response: response.data,
    });

    return response.data;
  } catch (error) {
    logSubtitleSplitEvent('llm_split_request_error', {
      model: config.model,
      attempt,
      chunkIndex: options.chunkIndex,
      chunkCount: options.chunkCount,
      unitCount: options.unitCount,
      source: options.source,
      error: axios.isAxiosError(error)
        ? {
            message: error.message,
            code: error.code,
            status: error.response?.status,
            response: error.response?.data ?? null,
          }
        : {
            message: error instanceof Error ? error.message : 'Unknown subtitle split request error.',
          },
    });
    throw error;
  }
}
