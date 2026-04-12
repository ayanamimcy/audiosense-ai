import type { TranscriptSegment, TranscriptWord } from './types.js';
import type { LangCode, SplitChunk, SplitToken, SplitWordSource } from './subtitle-split-models.js';
import { joinWordTexts } from './subtitle-split-text.js';

export function toTranscriptWords(tokens: SplitToken[]): TranscriptWord[] {
  return tokens.map(({ source: _source, ...word }) => ({ ...word }));
}

export function shouldPreserveProviderWords(wordSource: SplitWordSource) {
  return wordSource === 'provider';
}

export function buildSegmentFromTokens(
  tokens: SplitToken[],
  speaker: string | undefined,
  lang: LangCode,
  wordSource: SplitWordSource,
): TranscriptSegment | null {
  if (tokens.length === 0) {
    return null;
  }

  const text = joinWordTexts(tokens, lang);
  if (!text) {
    return null;
  }

  const start = tokens[0].start;
  const end = tokens[tokens.length - 1].end;
  if (end <= start) {
    return null;
  }

  return {
    id: '',
    start,
    end,
    text,
    speaker,
    words: shouldPreserveProviderWords(wordSource) ? toTranscriptWords(tokens) : undefined,
  };
}

export function buildSegmentFromChunk(chunk: SplitChunk): TranscriptSegment {
  return buildSegmentFromTokens(chunk.tokens, chunk.speaker, chunk.lang, chunk.wordSource) || {
    id: '',
    start: chunk.start,
    end: chunk.end,
    text: chunk.text,
    speaker: chunk.speaker,
  };
}
