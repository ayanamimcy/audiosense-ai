import axios from 'axios';
import { alignSubtitlePartsToWords } from './subtitle-split-alignment.js';
import { requestSubtitleSplitCompletion } from './subtitle-split-client.js';
import { MAX_CHARS_CJK, MAX_WORDS_EN } from './subtitle-split-limits.js';
import type {
  LlmSplitConfig,
  SplitSegmentByLlmOptions,
  SplitSegmentByLlmResult,
  SubtitleSplitFailureInfo,
  SubtitleSplitFailureReason,
} from './subtitle-split-llm-types.js';
import { logSubtitleSplitFailure } from './subtitle-split-observability.js';
import { buildSubtitleSplitRequestBody } from './subtitle-split-prompt.js';
import {
  findLengthViolation,
  normalizeForComparison,
  stripBreaks,
  textSimilarity,
} from './subtitle-split-validation.js';
import type { TranscriptSegment } from './types.js';

export type {
  LlmSplitConfig,
  SplitSegmentByLlmOptions,
  SplitSegmentByLlmResult,
  SubtitleSplitFailureInfo,
  SubtitleSplitFailureReason,
} from './subtitle-split-llm-types.js';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFailure(
  reason: SubtitleSplitFailureReason,
  message: string,
  config: LlmSplitConfig,
  attempt: number,
  options: SplitSegmentByLlmOptions,
  status?: number,
): SubtitleSplitFailureInfo {
  return {
    reason,
    message,
    model: config.model,
    attempt,
    status,
    chunkIndex: options.chunkIndex,
    chunkCount: options.chunkCount,
    unitCount: options.unitCount,
    source: options.source,
  };
}

function classifyRequestFailure(
  error: unknown,
  config: LlmSplitConfig,
  attempt: number,
  options: SplitSegmentByLlmOptions,
) {
  if (axios.isAxiosError(error)) {
    const status = Number(error.response?.status || 0) || undefined;
    const detail =
      typeof error.response?.data?.error?.message === 'string'
        ? error.response.data.error.message
        : typeof error.response?.data?.detail === 'string'
          ? error.response.data.detail
          : error.message;

    if (error.code === 'ECONNABORTED' || /timeout/i.test(detail)) {
      return createFailure('timeout', detail, config, attempt, options, status);
    }
    if (status === 429) {
      return createFailure('http_429', detail, config, attempt, options, status);
    }
    if (status && status >= 500) {
      return createFailure('http_5xx', detail, config, attempt, options, status);
    }

    return createFailure('request_failed', detail, config, attempt, options, status);
  }

  return createFailure(
    'request_failed',
    error instanceof Error ? error.message : 'Subtitle split request failed.',
    config,
    attempt,
    options,
  );
}

export async function splitSegmentByLlm(
  segment: TranscriptSegment,
  config: LlmSplitConfig,
  options: SplitSegmentByLlmOptions = {},
): Promise<SplitSegmentByLlmResult> {
  if (!config.apiKey || !segment.words || segment.words.length === 0) {
    return { segments: null };
  }

  const isCjk = /[\u3040-\u30ff\u4e00-\u9fff]/.test(segment.text);
  const maxPerLine = isCjk ? MAX_CHARS_CJK : MAX_WORDS_EN;
  const unit = isCjk ? 'characters' : 'words';
  const wordSource = options.wordSource || 'provider';
  const maxRetries = Math.max(0, Number(config.maxRetries || 0));
  const requestTimeoutMs = Math.max(5_000, Number(config.requestTimeoutMs || 60_000));
  const totalAttempts = maxRetries + 1;

  let lastFailure: SubtitleSplitFailureInfo | undefined;

  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    if (attempt > 0) {
      await sleep(attempt === 1 ? 1_000 : 3_000);
    }

    const attemptNumber = attempt + 1;
    const requestBody = buildSubtitleSplitRequestBody(
      config,
      segment.text,
      maxPerLine,
      unit,
      attempt === 0 ? undefined : lastFailure,
    );

    try {
      const data = await requestSubtitleSplitCompletion(
        config,
        requestBody,
        requestTimeoutMs,
        attemptNumber,
        options,
      );

      const content = String(data?.choices?.[0]?.message?.content || '').trim();
      if (!content) {
        lastFailure = createFailure(
          'empty_response',
          'The subtitle split model returned an empty response.',
          config,
          attemptNumber,
          options,
        );
        continue;
      }

      const stripped = stripBreaks(content);
      const original = segment.text.replace(/\s+/g, ' ').trim();
      const similarity = textSimilarity(
        normalizeForComparison(stripped, isCjk),
        normalizeForComparison(original, isCjk),
      );

      if (similarity < 0.96) {
        lastFailure = createFailure(
          'invalid_content',
          `The subtitle split model modified the source text (similarity ${Math.round(similarity * 100)}%).`,
          config,
          attemptNumber,
          options,
        );
        continue;
      }

      const parts = content
        .split(/<br\s*\/?>/gi)
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length <= 1) {
        lastFailure = createFailure(
          'length_violation',
          'The subtitle split model did not insert any usable break markers.',
          config,
          attemptNumber,
          options,
        );
        continue;
      }

      const violation = findLengthViolation(parts, isCjk, maxPerLine);
      if (violation) {
        lastFailure = createFailure(
          'length_violation',
          `Segment "${violation.part.slice(0, 60)}" exceeded the ${maxPerLine} ${unit} limit (${violation.units}).`,
          config,
          attemptNumber,
          options,
        );
        continue;
      }

      const sortedWords = [...segment.words].sort((a, b) => a.start - b.start || a.end - b.end);
      const aligned = alignSubtitlePartsToWords(
        parts,
        sortedWords,
        isCjk,
        segment.speaker,
        wordSource,
      );
      if (!aligned || aligned.length <= 1) {
        lastFailure = createFailure(
          'alignment_failed',
          'The subtitle split model output could not be aligned back to the source timestamps.',
          config,
          attemptNumber,
          options,
        );
        continue;
      }

      return {
        segments: aligned.filter((entry) => entry.end > entry.start && entry.text.trim()),
      };
    } catch (error) {
      lastFailure = classifyRequestFailure(error, config, attemptNumber, options);
    }
  }

  if (lastFailure) {
    logSubtitleSplitFailure(lastFailure);
  }

  return {
    segments: null,
    failure: lastFailure,
  };
}
