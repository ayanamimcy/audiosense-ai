import { splitSegmentByLlm } from './llm-split.js';
import {
  buildSegmentFromPreparedChunk,
  chunkSegmentsForSplitting,
} from './subtitle-split-prepare.js';
import { mergeAdjacentSegments, MIN_SPLIT_WORDS, splitSegmentByRules } from './subtitle-rule-split.js';
import { exceedsLineLimit } from './subtitle-split-text.js';
import { toTranscriptWords } from './subtitle-split-segments.js';
import type { SplitChunk, SplitPipelineResult } from './subtitle-split-models.js';
import type { TranscriptSegment } from './types.js';
import type { LlmSplitConfig, SubtitleSplitFailureInfo } from './subtitle-split-llm-types.js';

function formatSplitWarning(failure: SubtitleSplitFailureInfo) {
  const chunkLabel =
    failure.chunkIndex && failure.chunkCount
      ? `chunk ${failure.chunkIndex}/${failure.chunkCount}`
      : failure.chunkIndex
        ? `chunk ${failure.chunkIndex}`
        : 'chunk';

  return `Subtitle splitting fell back to rules for ${chunkLabel}: ${failure.reason} (${failure.model}) - ${failure.message}`;
}

async function processSplitChunk(
  chunk: SplitChunk,
  llmConfig: LlmSplitConfig | undefined,
  chunkIndex: number,
  chunkCount: number,
): Promise<SplitPipelineResult> {
  if (!exceedsLineLimit(chunk.text, chunk.lang) || chunk.tokens.length === 0) {
    return {
      segments: [buildSegmentFromPreparedChunk(chunk)],
      warnings: [],
    };
  }

  if (llmConfig?.apiKey) {
    const llmResult = await splitSegmentByLlm(
      {
        id: '',
        start: chunk.start,
        end: chunk.end,
        text: chunk.text,
        speaker: chunk.speaker,
        words: toTranscriptWords(chunk.tokens),
      },
      llmConfig,
      {
        wordSource: chunk.wordSource,
        chunkIndex,
        chunkCount,
        unitCount: chunk.unitCount,
        source: 'chunk',
      },
    );

    if (llmResult.segments && llmResult.segments.length > 0) {
      return {
        segments: llmResult.segments,
        warnings: [],
      };
    }

    if (chunk.tokens.length >= MIN_SPLIT_WORDS * 2) {
      return {
        segments: splitSegmentByRules(chunk.tokens, chunk.speaker, chunk.lang, chunk.wordSource),
        warnings: llmResult.failure ? [formatSplitWarning(llmResult.failure)] : [],
      };
    }

    return {
      segments: [buildSegmentFromPreparedChunk(chunk)],
      warnings: llmResult.failure ? [formatSplitWarning(llmResult.failure)] : [],
    };
  }

  if (chunk.tokens.length >= MIN_SPLIT_WORDS * 2) {
    return {
      segments: splitSegmentByRules(chunk.tokens, chunk.speaker, chunk.lang, chunk.wordSource),
      warnings: [],
    };
  }

  return {
    segments: [buildSegmentFromPreparedChunk(chunk)],
    warnings: [],
  };
}

export async function splitLongSegments(
  segments: TranscriptSegment[],
  llmConfig?: LlmSplitConfig,
): Promise<SplitPipelineResult> {
  const chunks = chunkSegmentsForSplitting(segments);
  const warnings: string[] = [];
  const splitSegments: TranscriptSegment[] = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const processed = await processSplitChunk(chunks[index], llmConfig, index + 1, chunks.length);
    splitSegments.push(...processed.segments);
    warnings.push(...processed.warnings);
  }

  return {
    segments: mergeAdjacentSegments(splitSegments),
    warnings,
  };
}
