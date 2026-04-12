import {
  buildSegmentsFromWords,
  buildSpeakerSegments,
  type DiarizationSegment,
} from './speaker-merge.js';
import { splitLongSegments } from './subtitle-split-pipeline.js';
import type { LlmSplitConfig } from './subtitle-split-llm-types.js';
import type {
  AudioFileMetadata,
  ProviderTranscriptionPayload,
  SpeakerSummary,
  TranscriptSegment,
  TranscriptWord,
  TranscriptionJobInput,
  TranscriptionProviderCapabilities,
  TranscriptionResult,
} from './types.js';

function toRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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

function joinTexts(parts: string[]) {
  return parts.join(' ').replace(/\s+([,.!?;:])/g, '$1').replace(/\s+/g, ' ').trim();
}

function normalizeWord(record: Record<string, unknown>, index: number, fallbackSpeaker?: string) {
  const text = readString(record.text) || readString(record.word) || readString(record.token);
  if (!text) {
    return null;
  }

  const start = readNumber(record.start) ?? readNumber(record.start_time) ?? 0;
  const end = readNumber(record.end) ?? readNumber(record.end_time) ?? start;

  return {
    id: String(record.id ?? index + 1),
    start,
    end,
    text,
    speaker:
      readString(record.speaker) ||
      readString(record.speaker_label) ||
      readString(record.speakerLabel) ||
      fallbackSpeaker,
    confidence: readNumber(record.confidence) ?? readNumber(record.probability),
  } satisfies TranscriptWord;
}

function normalizeWords(rawWords: unknown, fallbackSpeaker?: string) {
  if (!Array.isArray(rawWords)) {
    return [];
  }

  return rawWords
    .map((word, index) => normalizeWord(toRecord(word) || {}, index, fallbackSpeaker))
    .filter(Boolean) as TranscriptWord[];
}

function normalizeSegment(record: Record<string, unknown>, index: number) {
  const speaker =
    readString(record.speaker) ||
    readString(record.speaker_label) ||
    readString(record.speakerLabel);
  const words = normalizeWords(record.words ?? record.word_segments ?? record.wordSegments, speaker);
  const text =
    readString(record.text) ||
    readString(record.segment) ||
    (words.length > 0 ? joinTexts(words.map((word) => word.text)) : undefined);

  if (!text) {
    return null;
  }

  const start = readNumber(record.start) ?? readNumber(record.start_time) ?? 0;
  const end =
    readNumber(record.end) ??
    readNumber(record.end_time) ??
    (words.length > 0 ? words[words.length - 1].end : start);

  return {
    id: String(record.id ?? index + 1),
    start,
    end,
    text,
    speaker,
    words: words.length > 0 ? words : undefined,
  } satisfies TranscriptSegment;
}

function normalizeSegments(rawSegments: unknown) {
  if (!Array.isArray(rawSegments)) {
    return [];
  }

  return rawSegments
    .map((segment, index) => normalizeSegment(toRecord(segment) || {}, index))
    .filter(Boolean) as TranscriptSegment[];
}

function extractWordsFromSegments(segments: TranscriptSegment[]) {
  const words: TranscriptWord[] = [];
  for (const segment of segments) {
    if (!segment.words || segment.words.length === 0) {
      continue;
    }

    for (const word of segment.words) {
      words.push({
        ...word,
        speaker: word.speaker || segment.speaker,
      });
    }
  }
  return words;
}

function normalizeDiarizationSegments(rawValue: unknown) {
  if (!Array.isArray(rawValue)) {
    return [];
  }

  return rawValue
    .map((segment) => {
      const record = toRecord(segment);
      if (!record) {
        return null;
      }

      const start = readNumber(record.start) ?? readNumber(record.start_time);
      const end = readNumber(record.end) ?? readNumber(record.end_time);
      const speaker =
        readString(record.speaker) ||
        readString(record.label) ||
        readString(record.speaker_label) ||
        readString(record.speakerLabel);

      if (start === undefined || end === undefined || !speaker) {
        return null;
      }

      return {
        start,
        end,
        speaker,
      } satisfies DiarizationSegment;
    })
    .filter(Boolean) as DiarizationSegment[];
}

function findNestedRecord(payload: Record<string, unknown>) {
  const directResult = toRecord(payload.result);
  if (directResult) {
    return directResult;
  }

  const responseResult = toRecord(payload.response);
  if (responseResult) {
    return responseResult;
  }

  const dataResult = toRecord(payload.data);
  if (dataResult) {
    return dataResult;
  }

  return payload;
}

function summarizeSpeakers(segments: TranscriptSegment[], words: TranscriptWord[]) {
  const speakerMap = new Map<string, SpeakerSummary>();

  for (const segment of segments) {
    const speaker = segment.speaker?.trim();
    if (!speaker) {
      continue;
    }

    const durationSeconds = Math.max(0, segment.end - segment.start);
    const current = speakerMap.get(speaker);
    if (current) {
      current.segmentCount += 1;
      current.durationSeconds += durationSeconds;
      continue;
    }

    speakerMap.set(speaker, {
      id: speaker,
      label: speaker,
      segmentCount: 1,
      durationSeconds,
      wordCount: 0,
    });
  }

  for (const word of words) {
    const speaker = word.speaker?.trim();
    if (!speaker || speaker === 'UNKNOWN') {
      continue;
    }

    const current = speakerMap.get(speaker);
    if (!current) {
      speakerMap.set(speaker, {
        id: speaker,
        label: speaker,
        segmentCount: 0,
        durationSeconds: 0,
        wordCount: 1,
      });
      continue;
    }

    current.wordCount = (current.wordCount || 0) + 1;
  }

  return [...speakerMap.values()].sort((left, right) => right.durationSeconds - left.durationSeconds);
}

function buildFallbackSegment(text: string, durationSeconds?: number) {
  if (!text) {
    return [];
  }

  return [
    {
      id: '1',
      start: 0,
      end: durationSeconds || 0,
      text,
    },
  ] satisfies TranscriptSegment[];
}

function getText(payload: Record<string, unknown>, segments: TranscriptSegment[], words: TranscriptWord[]) {
  return (
    readString(payload.text) ||
    (segments.length > 0 ? joinTexts(segments.map((segment) => segment.text)) : undefined) ||
    (words.length > 0 ? joinTexts(words.map((word) => word.text)) : undefined) ||
    ''
  );
}

export async function buildTranscriptionResult(input: {
  providerCapabilities: TranscriptionProviderCapabilities;
  request: TranscriptionJobInput;
  providerResponse: ProviderTranscriptionPayload;
  media?: AudioFileMetadata;
  providerName: string;
  llmConfig?: LlmSplitConfig;
}) {
  const payload = findNestedRecord(input.providerResponse.payload);
  let segments = normalizeSegments(payload.segments);
  let words = normalizeWords(payload.words ?? payload.word_segments ?? payload.wordSegments);
  const diarizationSegments = normalizeDiarizationSegments(payload.diarization_segments);
  const fallbackDiarizationSegments =
    diarizationSegments.length > 0
      ? diarizationSegments
      : normalizeDiarizationSegments(payload.speaker_segments ?? payload.speakers);
  const warnings = [...(input.providerResponse.warnings || [])];

  if (words.length === 0 && segments.length > 0) {
    words = extractWordsFromSegments(segments);
  }

  let analysisMode: TranscriptionResult['metadata']['analysisMode'] = 'text-only';

  if (segments.some((segment) => Boolean(segment.speaker))) {
    analysisMode = 'integrated';
  } else if (input.request.diarization && words.length > 0 && fallbackDiarizationSegments.length > 0) {
    const merged = buildSpeakerSegments(words, fallbackDiarizationSegments);
    if (merged.segments.length > 0) {
      words = merged.words;
      segments = merged.segments;
      analysisMode = 'word-alignment';
    }
  } else if (words.length > 0 && words.some((word) => Boolean(word.speaker))) {
    const grouped = buildSegmentsFromWords(words);
    if (grouped.segments.length > 0) {
      segments = grouped.segments;
      analysisMode = 'integrated';
    }
  }

  if (segments.length === 0 && words.length > 0) {
    const grouped = buildSegmentsFromWords(
      words.map((word) => ({
        ...word,
        speaker: word.speaker,
      })),
    );
    if (grouped.segments.length > 0) {
      segments = grouped.segments;
      analysisMode = grouped.numSpeakers > 0 ? 'integrated' : 'segment-only';
    }
  }

  const durationSeconds =
    readNumber(payload.duration) ||
    readNumber(payload.duration_seconds) ||
    input.media?.durationSeconds ||
    (segments.length > 0 ? Math.max(...segments.map((segment) => segment.end)) : undefined);
  const text = getText(payload, segments, words);

  if (segments.length === 0 && text) {
    segments = buildFallbackSegment(text, durationSeconds);
    analysisMode = 'text-only';
  } else if (analysisMode === 'text-only' && segments.length > 0) {
    analysisMode = 'segment-only';
  }

  if (input.request.diarization && analysisMode !== 'integrated' && analysisMode !== 'word-alignment') {
    warnings.push(`Provider ${input.providerName} returned transcript without speaker labels.`);
  }

  const splitResult = await splitLongSegments(segments, input.llmConfig);
  segments = splitResult.segments;
  warnings.push(...splitResult.warnings);

  const speakers = summarizeSpeakers(segments, words);

  return {
    text,
    language: readString(payload.language),
    languageProbability:
      readNumber(payload.language_probability) ?? readNumber(payload.languageProbability),
    durationSeconds,
    segments,
    speakers,
    words,
    raw: input.providerResponse.payload,
    metadata: {
      analysisMode,
      warnings,
      media: input.media,
      providerCapabilities: input.providerCapabilities,
      requested: {
        diarization: Boolean(input.request.diarization),
        wordTimestamps: Boolean(input.request.wordTimestamps),
        task: input.request.task || 'transcribe',
        expectedSpeakers: input.request.expectedSpeakers ?? null,
        translationTargetLanguage: input.request.translationTargetLanguage || null,
      },
      detected: {
        segmentCount: segments.length,
        wordCount: words.length,
        speakerCount: speakers.length,
      },
    },
  } satisfies TranscriptionResult;
}
