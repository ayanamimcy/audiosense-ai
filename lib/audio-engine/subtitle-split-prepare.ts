import type { TranscriptSegment } from './types.js';
import type {
  LangCode,
  PreparedSplitSegment,
  SplitChunk,
  SplitToken,
  SplitWordSource,
} from './subtitle-split-models.js';
import { buildSegmentFromChunk } from './subtitle-split-segments.js';
import { countTextUnits, detectLanguage, joinWordTexts } from './subtitle-split-text.js';

const CHARS_PER_PHONEME = 4;
const TARGET_SPLIT_CHUNK_UNITS = 500;
const CHUNK_SEARCH_WINDOW_TOKENS = 30;
const FALLBACK_WORD_SPLIT_PATTERN =
  /[a-zA-Z\u00c0-\u00ff\u0100-\u017f']+|[\u0400-\u04ff]+|[\u0370-\u03ff]+|[\u0600-\u06ff]+|[\u0590-\u05ff]+|\d+|[\u4e00-\u9fff]|[\u3040-\u309f]|[\u30a0-\u30ff]|[\uac00-\ud7af]|[\u0e00-\u0e7f][\u0e30-\u0e3a\u0e47-\u0e4e]*|[\u0900-\u097f]|[\u0980-\u09ff]|[\u0e80-\u0eff]|[\u1000-\u109f]|[^\s]/gu;
const SENTENCE_END_PATTERN = /[。！？.!?]$/;
const COMMA_PATTERN = /[，、,;；]$/;

function hasSentenceEndingText(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (/\d\.\d/.test(trimmed)) {
    return false;
  }
  if (/^[A-Z][a-z]?\.$/.test(trimmed)) {
    return false;
  }
  return SENTENCE_END_PATTERN.test(trimmed);
}

function hasCommaEndingText(text: string) {
  return COMMA_PATTERN.test(text.trim());
}

export function buildFallbackTokens(segment: TranscriptSegment): SplitToken[] {
  const tokens = [...segment.text.matchAll(FALLBACK_WORD_SPLIT_PATTERN)]
    .map((match) => match[0]?.trim())
    .filter(Boolean) as string[];

  if (tokens.length === 0) {
    return [];
  }

  const duration = Math.max(0, segment.end - segment.start);
  const totalPhonemes = tokens.reduce(
    (sum, token) => sum + Math.max(1, Math.ceil(token.length / CHARS_PER_PHONEME)),
    0,
  );

  let cursor = segment.start;

  return tokens.map((token, index) => {
    const tokenPhonemes = Math.max(1, Math.ceil(token.length / CHARS_PER_PHONEME));
    const tokenDuration = duration > 0 ? (duration * tokenPhonemes) / totalPhonemes : 0;
    const start = cursor;
    const end = index === tokens.length - 1
      ? segment.end
      : Math.min(segment.end, cursor + tokenDuration);

    cursor = end;

    return {
      id: `${segment.id || 'segment'}:${index + 1}`,
      start,
      end,
      text: token,
      speaker: segment.speaker,
      source: 'synthetic',
    } satisfies SplitToken;
  });
}

export function getTokensForSplitting(segment: TranscriptSegment): SplitToken[] {
  if (segment.words && segment.words.length > 0) {
    return [...segment.words]
      .map((word, index) => ({
        ...word,
        id: String(word.id || `${segment.id || 'segment'}:${index + 1}`),
        speaker: word.speaker || segment.speaker,
        source: 'provider' as const,
      }))
      .sort((a, b) => a.start - b.start || a.end - b.end);
  }

  return buildFallbackTokens(segment);
}

export function prepareSegmentForSplitting(segment: TranscriptSegment): PreparedSplitSegment {
  const tokens = getTokensForSplitting(segment);
  const wordSource: Exclude<SplitWordSource, 'mixed'> = segment.words && segment.words.length > 0
    ? 'provider'
    : 'synthetic';
  const lang = detectLanguage(segment.text || joinWordTexts(tokens, 'en'));
  const unitCount = countTextUnits(segment.text || joinWordTexts(tokens, lang), lang);

  return {
    segment,
    tokens,
    wordSource,
    lang,
    unitCount,
  };
}

export function countTokenUnits(token: { text: string }, lang: LangCode) {
  return Math.max(1, countTextUnits(token.text.trim(), lang));
}

function scoreChunkBoundary(tokens: SplitToken[], index: number) {
  const current = tokens[index];
  const next = tokens[index + 1];
  if (!current || !next) {
    return Number.NEGATIVE_INFINITY;
  }

  const gap = Math.max(0, next.start - current.end);
  let score = gap;

  if (hasSentenceEndingText(current.text)) {
    score += 10;
  } else if (hasCommaEndingText(current.text)) {
    score += 5;
  }

  return score;
}

function findTargetBoundaryIndex(
  tokens: SplitToken[],
  lang: LangCode,
  startIndex: number,
  endIndexExclusive: number,
  targetUnits: number,
) {
  let consumed = 0;

  for (let index = startIndex; index < endIndexExclusive - 1; index += 1) {
    consumed += countTokenUnits(tokens[index], lang);
    if (consumed >= targetUnits) {
      return index;
    }
  }

  return Math.max(startIndex, endIndexExclusive - 2);
}

function findBestChunkBoundary(
  tokens: SplitToken[],
  lang: LangCode,
  startIndex: number,
  endIndexExclusive: number,
  targetUnits: number,
) {
  const targetIndex = findTargetBoundaryIndex(tokens, lang, startIndex, endIndexExclusive, targetUnits);
  const searchStart = Math.max(startIndex, targetIndex - CHUNK_SEARCH_WINDOW_TOKENS);
  const searchEnd = Math.min(endIndexExclusive - 2, targetIndex + CHUNK_SEARCH_WINDOW_TOKENS);

  let bestIndex = targetIndex;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let index = searchStart; index <= searchEnd; index += 1) {
    const score = scoreChunkBoundary(tokens, index);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function mergeWordSource(segments: PreparedSplitSegment[]): SplitWordSource {
  const sources = new Set(segments.map((segment) => segment.wordSource));
  if (sources.size === 1) {
    return segments[0]?.wordSource || 'synthetic';
  }
  return 'mixed';
}

function buildChunkFromTokens(
  tokens: SplitToken[],
  lang: LangCode,
  speaker: string | undefined,
  wordSource: SplitWordSource,
): SplitChunk {
  const text = joinWordTexts(tokens, lang);
  return {
    text,
    start: tokens[0]?.start ?? 0,
    end: tokens[tokens.length - 1]?.end ?? 0,
    speaker,
    tokens,
    lang,
    unitCount: countTextUnits(text, lang),
    wordSource,
  };
}

function chunkPreparedRegion(segments: PreparedSplitSegment[]): SplitChunk[] {
  if (segments.length === 0) {
    return [];
  }

  const lang = segments[0].lang;
  const speaker = segments[0].segment.speaker;
  const wordSource = mergeWordSource(segments);
  const tokens = segments.flatMap((segment) => segment.tokens);

  if (tokens.length === 0) {
    return segments.map((segment) => ({
      text: segment.segment.text,
      start: segment.segment.start,
      end: segment.segment.end,
      speaker: segment.segment.speaker,
      tokens: [],
      lang: segment.lang,
      unitCount: segment.unitCount,
      wordSource: segment.wordSource,
    }));
  }

  const fullText = joinWordTexts(tokens, lang);
  const totalUnits = countTextUnits(fullText, lang);
  if (totalUnits <= TARGET_SPLIT_CHUNK_UNITS) {
    return [buildChunkFromTokens(tokens, lang, speaker, wordSource)];
  }

  const chunkCount = Math.ceil(totalUnits / TARGET_SPLIT_CHUNK_UNITS);
  const chunks: SplitChunk[] = [];
  let startIndex = 0;

  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const remainingChunks = chunkCount - chunkIndex;
    if (remainingChunks === 1) {
      chunks.push(buildChunkFromTokens(tokens.slice(startIndex), lang, speaker, wordSource));
      break;
    }

    let remainingUnits = 0;
    for (let index = startIndex; index < tokens.length; index += 1) {
      remainingUnits += countTokenUnits(tokens[index], lang);
    }

    const targetUnits = remainingUnits / remainingChunks;
    const boundaryIndex = findBestChunkBoundary(tokens, lang, startIndex, tokens.length, targetUnits);
    chunks.push(buildChunkFromTokens(tokens.slice(startIndex, boundaryIndex + 1), lang, speaker, wordSource));
    startIndex = boundaryIndex + 1;
  }

  return chunks;
}

function getSpeakerKey(speaker?: string) {
  const trimmed = speaker?.trim();
  return trimmed || null;
}

export function chunkSegmentsForSplitting(segments: TranscriptSegment[]): SplitChunk[] {
  const prepared = segments.map(prepareSegmentForSplitting);
  const chunks: SplitChunk[] = [];
  let buffered: PreparedSplitSegment[] = [];

  const flushBuffered = () => {
    if (buffered.length === 0) {
      return;
    }
    chunks.push(...chunkPreparedRegion(buffered));
    buffered = [];
  };

  for (const preparedSegment of prepared) {
    if (preparedSegment.tokens.length === 0) {
      flushBuffered();
      chunks.push({
        text: preparedSegment.segment.text,
        start: preparedSegment.segment.start,
        end: preparedSegment.segment.end,
        speaker: preparedSegment.segment.speaker,
        tokens: [],
        lang: preparedSegment.lang,
        unitCount: preparedSegment.unitCount,
        wordSource: preparedSegment.wordSource,
      });
      continue;
    }

    const currentSpeaker = getSpeakerKey(buffered[0]?.segment.speaker);
    const nextSpeaker = getSpeakerKey(preparedSegment.segment.speaker);
    if (buffered.length > 0 && currentSpeaker !== nextSpeaker) {
      flushBuffered();
    }

    buffered.push(preparedSegment);
  }

  flushBuffered();
  return chunks;
}

export function buildSegmentFromPreparedChunk(chunk: SplitChunk) {
  return buildSegmentFromChunk(chunk);
}
