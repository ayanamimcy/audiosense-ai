import type { TranscriptSegment, TranscriptWord } from './types.js';

const DEFAULT_WORD_PADDING_SECONDS = 0.04;
const DEFAULT_NEAREST_TURN_TOLERANCE_SECONDS = 0.12;
const DEFAULT_MICRO_TURN_MAX_WORDS = 1;

export interface DiarizationSegment {
  start: number;
  end: number;
  speaker: string;
}

function readNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function normalizeWordSpeaker(word: TranscriptWord) {
  return word.speaker?.trim() || 'UNKNOWN';
}

function normalizeComparableText(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function wordsCoverAuthoritativeText(words: TranscriptWord[], text: string) {
  if (words.length === 0) {
    return false;
  }
  return normalizeComparableText(words.map((word) => word.text).join('')) === normalizeComparableText(text);
}

export function assignSpeakersToWords(
  words: TranscriptWord[],
  diarizationSegments: DiarizationSegment[],
  options: {
    wordPaddingSeconds?: number;
    nearestTurnToleranceSeconds?: number;
  } = {},
) {
  if (words.length === 0 || diarizationSegments.length === 0) {
    return words.map((word) => ({ ...word }));
  }

  const wordPaddingSeconds = options.wordPaddingSeconds ?? DEFAULT_WORD_PADDING_SECONDS;
  const nearestTurnToleranceSeconds =
    options.nearestTurnToleranceSeconds ?? DEFAULT_NEAREST_TURN_TOLERANCE_SECONDS;
  const diarization = [...diarizationSegments].sort((a, b) => a.start - b.start);
  const result: TranscriptWord[] = [];

  let previousSpeaker: string | undefined;
  let previousEnd = 0;

  for (const word of words) {
    const wordStart = readNumber(word.start) || 0;
    const wordEnd = readNumber(word.end) || wordStart;
    const wordMidpoint = (wordStart + wordEnd) / 2;
    const paddedStart = wordStart - wordPaddingSeconds;
    const paddedEnd = wordEnd + wordPaddingSeconds;

    let bestSpeaker: string | undefined;
    let bestOverlap = 0;
    let midpointSpeaker: string | undefined;
    let nearestSpeaker: string | undefined;
    let nearestDistance: number | undefined;

    for (const segment of diarization) {
      const overlap = Math.max(0, Math.min(paddedEnd, segment.end) - Math.max(paddedStart, segment.start));
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestSpeaker = segment.speaker;
      }

      if (!midpointSpeaker && segment.start <= wordMidpoint && wordMidpoint <= segment.end) {
        midpointSpeaker = segment.speaker;
      }

      let distance = 0;
      if (wordMidpoint < segment.start) {
        distance = segment.start - wordMidpoint;
      } else if (wordMidpoint > segment.end) {
        distance = wordMidpoint - segment.end;
      }

      if (distance <= nearestTurnToleranceSeconds) {
        if (nearestDistance === undefined || distance < nearestDistance) {
          nearestDistance = distance;
          nearestSpeaker = segment.speaker;
        }
      }
    }

    const speaker =
      (bestSpeaker && bestOverlap > 0 ? bestSpeaker : undefined) ||
      midpointSpeaker ||
      nearestSpeaker ||
      (previousSpeaker && wordStart - previousEnd <= 0.2 ? previousSpeaker : undefined) ||
      'UNKNOWN';

    result.push({
      ...word,
      speaker,
    });
    previousSpeaker = speaker;
    previousEnd = wordEnd;
  }

  return result;
}

export function smoothMicroTurns(
  words: TranscriptWord[],
  options: {
    maxRunLength?: number;
  } = {},
) {
  const maxRunLength = options.maxRunLength ?? DEFAULT_MICRO_TURN_MAX_WORDS;
  if (words.length < 3) {
    return words.map((word) => ({ ...word }));
  }

  const runs: Array<{ speaker: string; startIndex: number; length: number }> = [];
  let index = 0;

  while (index < words.length) {
    const speaker = normalizeWordSpeaker(words[index]);
    let nextIndex = index + 1;

    while (nextIndex < words.length && normalizeWordSpeaker(words[nextIndex]) === speaker) {
      nextIndex += 1;
    }

    runs.push({
      speaker,
      startIndex: index,
      length: nextIndex - index,
    });
    index = nextIndex;
  }

  const relabelMap = new Map<number, string>();
  for (let runIndex = 1; runIndex < runs.length - 1; runIndex += 1) {
    const run = runs[runIndex];
    const previous = runs[runIndex - 1];
    const next = runs[runIndex + 1];

    if (run.length > maxRunLength) {
      continue;
    }
    if (previous.speaker !== next.speaker || previous.speaker === run.speaker) {
      continue;
    }

    for (let wordIndex = run.startIndex; wordIndex < run.startIndex + run.length; wordIndex += 1) {
      relabelMap.set(wordIndex, previous.speaker);
    }
  }

  return words.map((word, wordIndex) =>
    relabelMap.has(wordIndex)
      ? {
          ...word,
          speaker: relabelMap.get(wordIndex),
        }
      : { ...word },
  );
}

/**
 * Adds speaker metadata without rebuilding ASR segments from word tokens.
 * Segment text is authoritative provider output and must survive diarization
 * even when alignment omits an unalignable token.
 */
export function labelTranscriptWithSpeakers(
  segments: TranscriptSegment[],
  words: TranscriptWord[],
  diarizationSegments: DiarizationSegment[],
  options: {
    smooth?: boolean;
    wordPaddingSeconds?: number;
    nearestTurnToleranceSeconds?: number;
  } = {},
) {
  const assignedWords = assignSpeakersToWords(words, diarizationSegments, {
    wordPaddingSeconds: options.wordPaddingSeconds,
    nearestTurnToleranceSeconds: options.nearestTurnToleranceSeconds,
  });
  const finalWords = options.smooth === false ? assignedWords : smoothMicroTurns(assignedWords);
  const speakers = new Set<string>();

  const labelledSegments = segments.map((segment, segmentIndex) => {
    const isLastSegment = segmentIndex === segments.length - 1;
    const segmentWords = finalWords.filter((word) => {
      const midpoint = (word.start + word.end) / 2;
      return midpoint >= segment.start && (midpoint < segment.end || (isLastSegment && midpoint <= segment.end));
    });
    const speakerWeights = new Map<string, number>();

    for (const word of segmentWords) {
      const speaker = normalizeWordSpeaker(word);
      if (speaker === 'UNKNOWN') {
        continue;
      }
      const weight = Math.max(0.01, word.end - word.start);
      speakerWeights.set(speaker, (speakerWeights.get(speaker) || 0) + weight);
    }

    const speaker = [...speakerWeights.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
    if (speaker) {
      speakers.add(speaker);
    }

    return {
      ...segment,
      // Preserve the provider's exact text and boundaries. Speaker assignment
      // is metadata enrichment, not another transcription pass.
      text: segment.text,
      speaker: speaker || segment.speaker,
      // Incomplete aligned words must not become the source for subtitle
      // splitting, which would silently drop unmatched Latin text or digits.
      words: wordsCoverAuthoritativeText(segmentWords, segment.text) ? segmentWords : segment.words,
    } satisfies TranscriptSegment;
  });

  return {
    words: finalWords,
    segments: labelledSegments,
    numSpeakers: speakers.size,
  };
}

function joinWordTexts(words: TranscriptWord[]) {
  return words
    .map((word) => word.text.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim();
}

export function buildSegmentsFromWords(words: TranscriptWord[]) {
  if (words.length === 0) {
    return {
      segments: [] as TranscriptSegment[],
      numSpeakers: 0,
    };
  }

  const segments: TranscriptSegment[] = [];
  const speakers = new Set<string>();

  let currentSpeaker = normalizeWordSpeaker(words[0]);
  let currentWords: TranscriptWord[] = [];

  const flush = () => {
    if (currentWords.length === 0) {
      return;
    }

    const segmentSpeaker = normalizeWordSpeaker(currentWords[0]);
    segments.push({
      id: String(segments.length + 1),
      start: currentWords[0].start,
      end: currentWords[currentWords.length - 1].end,
      text: joinWordTexts(currentWords),
      speaker: segmentSpeaker === 'UNKNOWN' ? undefined : segmentSpeaker,
      words: currentWords.map((word) => ({ ...word })),
    });
    speakers.add(segmentSpeaker);
    currentWords = [];
  };

  for (const word of words) {
    const speaker = normalizeWordSpeaker(word);
    if (speaker !== currentSpeaker && currentWords.length > 0) {
      flush();
      currentSpeaker = speaker;
    }
    currentWords.push({ ...word, speaker });
  }

  flush();

  speakers.delete('UNKNOWN');
  return {
    segments,
    numSpeakers: speakers.size,
  };
}

export function buildSpeakerSegments(
  words: TranscriptWord[],
  diarizationSegments: DiarizationSegment[],
  options: {
    smooth?: boolean;
    wordPaddingSeconds?: number;
    nearestTurnToleranceSeconds?: number;
  } = {},
) {
  const labelledWords = assignSpeakersToWords(words, diarizationSegments, {
    wordPaddingSeconds: options.wordPaddingSeconds,
    nearestTurnToleranceSeconds: options.nearestTurnToleranceSeconds,
  });
  const finalWords = options.smooth === false ? labelledWords : smoothMicroTurns(labelledWords);
  const { segments, numSpeakers } = buildSegmentsFromWords(finalWords);

  return {
    words: finalWords,
    segments,
    numSpeakers,
  };
}
