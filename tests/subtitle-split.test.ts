import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { buildTranscriptionResult } from '../lib/audio-engine/normalize.js';
import { alignSubtitlePartsToWords } from '../lib/audio-engine/subtitle-split-alignment.js';
import {
  buildFallbackTokens,
  chunkSegmentsForSplitting,
} from '../lib/audio-engine/subtitle-split-prepare.js';
import {
  splitSegmentByLlm,
  type LlmSplitConfig,
} from '../lib/audio-engine/llm-split.js';
import {
  getBoundaryPenalty,
  mergeAdjacentSegments,
} from '../lib/audio-engine/subtitle-rule-split.js';
import type {
  ProviderTranscriptionPayload,
  TranscriptSegment,
  TranscriptWord,
  TranscriptionJobInput,
  TranscriptionProviderCapabilities,
} from '../lib/audio-engine/types.js';

function joinEnglishTokens(tokens: string[]) {
  return tokens.join(' ').replace(/\s+([,.!?;:])/g, '$1').trim();
}

function makeTimedWords(
  tokens: string[],
  options: {
    speaker?: string;
    gapAfterIndex?: number;
    gapSeconds?: number;
    baseGapSeconds?: number;
    durationSeconds?: number;
  } = {},
): TranscriptWord[] {
  const {
    speaker,
    gapAfterIndex = -1,
    gapSeconds = 1.5,
    baseGapSeconds = 0.05,
    durationSeconds = 0.35,
  } = options;

  let cursor = 0;

  return tokens.map((text, index) => {
    const start = cursor;
    const end = start + durationSeconds;
    cursor = end + (index === gapAfterIndex ? gapSeconds : baseGapSeconds);

    return {
      id: String(index + 1),
      start,
      end,
      text,
      speaker,
    };
  });
}

function buildProviderInput(
  payload: ProviderTranscriptionPayload['payload'],
  request: Partial<TranscriptionJobInput> = {},
) {
  return {
    providerCapabilities: {
      diarization: 'none',
      wordTimestamps: false,
      translation: false,
      asyncPolling: false,
    } satisfies TranscriptionProviderCapabilities,
    request: {
      filePath: '/tmp/example.wav',
      diarization: false,
      wordTimestamps: false,
      task: 'transcribe',
      ...request,
    } satisfies TranscriptionJobInput,
    providerResponse: {
      payload,
      warnings: [],
    } satisfies ProviderTranscriptionPayload,
    providerName: 'test-provider',
  };
}

function toSplitTokens(words: TranscriptWord[]) {
  return words.map((word) => ({
    ...word,
    source: 'provider' as const,
  }));
}

test('buildFallbackTokens tokenizes multilingual text and preserves timing bounds', () => {
  const chinese = buildFallbackTokens({
    id: 'seg-zh',
    start: 0,
    end: 4,
    text: '你好世界',
  });
  assert.equal(chinese.length, 4);
  assert.equal(chinese.map((word) => word.text).join(''), '你好世界');
  assert.equal(chinese[0]?.start, 0);
  assert.equal(chinese.at(-1)?.end, 4);

  const english = buildFallbackTokens({
    id: 'seg-en',
    start: 1,
    end: 5,
    text: 'hello subtitle splitting',
  });
  assert.deepEqual(english.map((word) => word.text), ['hello', 'subtitle', 'splitting']);

  const mixed = buildFallbackTokens({
    id: 'seg-mixed',
    start: 0,
    end: 6,
    text: 'hello 世界 2026',
  });
  assert.deepEqual(mixed.map((word) => word.text), ['hello', '世', '界', '2026']);

  const japanese = buildFallbackTokens({
    id: 'seg-ja',
    start: 0,
    end: 3,
    text: 'こんにちは',
  });
  assert.ok(japanese.length >= 5);
  assert.equal(japanese.map((word) => word.text).join(''), 'こんにちは');

  const punctuationOnly = buildFallbackTokens({
    id: 'seg-punc',
    start: 0,
    end: 1,
    text: '...?!',
  });
  assert.deepEqual(punctuationOnly.map((word) => word.text), ['.', '.', '.', '?', '!']);

  const empty = buildFallbackTokens({
    id: 'seg-empty',
    start: 0,
    end: 1,
    text: '',
  });
  assert.deepEqual(empty, []);
});

test('chunkSegmentsForSplitting keeps exact-threshold content in one chunk', () => {
  const tokens = Array.from({ length: 500 }, (_, index) => `w${index + 1}`);
  const words = makeTimedWords(tokens);
  const segment: TranscriptSegment = {
    id: 'segment-1',
    start: words[0]!.start,
    end: words.at(-1)!.end,
    text: joinEnglishTokens(tokens),
    words,
  };

  const chunks = chunkSegmentsForSplitting([segment]);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.unitCount, 500);
});

test('chunkSegmentsForSplitting splits over-threshold content and prefers nearby large gaps', () => {
  const tokens = Array.from({ length: 520 }, (_, index) => `w${index + 1}`);
  const words = makeTimedWords(tokens, { gapAfterIndex: 259, gapSeconds: 2.25 });
  const segment: TranscriptSegment = {
    id: 'segment-gap',
    start: words[0]!.start,
    end: words.at(-1)!.end,
    text: joinEnglishTokens(tokens),
    words,
  };

  const chunks = chunkSegmentsForSplitting([segment]);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]?.tokens.at(-1)?.text, 'w260');
  assert.equal(chunks[1]?.tokens[0]?.text, 'w261');
});

test('mergeAdjacentSegments merges short adjacent cues but respects speaker boundaries', () => {
  const merged = mergeAdjacentSegments([
    { id: '1', start: 0, end: 0.8, text: 'short start', speaker: 'A' },
    { id: '2', start: 0.95, end: 2.1, text: 'continues naturally', speaker: 'A' },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.text, 'short start continues naturally');

  const keptSeparate = mergeAdjacentSegments([
    { id: '1', start: 0, end: 0.8, text: 'short start', speaker: 'A' },
    { id: '2', start: 0.95, end: 2.1, text: 'continues naturally', speaker: 'B' },
  ]);
  assert.equal(keptSeparate.length, 2);
});

test('mergeAdjacentSegments merges natural same-speaker continuations even when both parts are not tiny', () => {
  const merged = mergeAdjacentSegments([
    { id: '1', start: 0, end: 2, text: '今日はゲストに西野さんを', speaker: 'SPEAKER_00' },
    { id: '2', start: 2.1, end: 4, text: 'お呼びして始めたいと思います', speaker: 'SPEAKER_00' },
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.text, '今日はゲストに西野さんをお呼びして始めたいと思います');
});

test('getBoundaryPenalty discourages splitting Japanese no-break patterns', () => {
  const words = toSplitTokens(makeTimedWords(['西', '野', 'さ', 'ん', 'を', 'お', '呼', 'び']));

  assert.ok(getBoundaryPenalty(words, 4, 'ja') > 0);
});

test('alignSubtitlePartsToWords aligns exact, repeated, and CJK subtitle parts monotonically', () => {
  const englishWords = makeTimedWords(['hello', 'world', '.', 'how', 'are', 'you', '?']);
  const englishAligned = alignSubtitlePartsToWords(
    ['hello world.', 'how are you?'],
    englishWords,
    false,
    'A',
    'provider',
  );
  assert.equal(englishAligned?.length, 2);
  assert.equal(englishAligned?.[0]?.text, 'hello world.');
  assert.equal(englishAligned?.[1]?.text, 'how are you?');

  const repeatedWords = makeTimedWords(['go', 'go', 'go', 'now']);
  const repeatedAligned = alignSubtitlePartsToWords(
    ['go go', 'go now'],
    repeatedWords,
    false,
    undefined,
    'provider',
  );
  assert.equal(repeatedAligned?.length, 2);
  assert.equal(repeatedAligned?.[0]?.text, 'go go');
  assert.equal(repeatedAligned?.[1]?.text, 'go now');

  const cjkWords = makeTimedWords(['你', '好', '，', '世', '界', '。', '再', '见', '。']);
  const cjkAligned = alignSubtitlePartsToWords(
    ['你好，世界。', '再见。'],
    cjkWords,
    true,
    'S1',
    'provider',
  );
  assert.equal(cjkAligned?.length, 2);
  assert.equal(cjkAligned?.[0]?.text, '你好，世界。');

  const mismatch = alignSubtitlePartsToWords(
    ['totally different'],
    englishWords,
    false,
    undefined,
    'provider',
  );
  assert.equal(mismatch, null);
});

test('splitSegmentByLlm retries with corrective feedback and returns aligned segments', async () => {
  const originalPost = axios.post;
  const calls: Array<{ prompt: string }> = [];
  const words = makeTimedWords(['Hello', 'world', '.', 'How', 'are', 'you', '?'], {
    speaker: 'S1',
  });
  const segment: TranscriptSegment = {
    id: 'llm-segment',
    start: words[0]!.start,
    end: words.at(-1)!.end,
    text: 'Hello world. How are you?',
    speaker: 'S1',
    words,
  };
  const config: LlmSplitConfig = {
    apiKey: 'test-key',
    baseUrl: 'https://example.invalid/v1',
    model: 'gpt-4o-mini',
    requestTimeoutMs: 60_000,
    maxRetries: 1,
  };

  try {
    (axios as typeof axios & {
      post: typeof axios.post;
    }).post = (async (_url, body) => {
      const requestBody = body as { messages?: Array<{ content?: string }> };
      const prompt = String(requestBody.messages?.[1]?.content || '');
      calls.push({ prompt });

      if (calls.length === 1) {
        return {
          data: {
            choices: [
              {
                message: {
                  content: 'Hello brave world.<br>How are you?',
                },
              },
            ],
          },
        };
      }

      return {
        data: {
          choices: [
            {
              message: {
                content: 'Hello world.<br>How are you?',
              },
            },
          ],
        },
      };
    }) as typeof axios.post;

    const result = await splitSegmentByLlm(segment, config, {
      chunkIndex: 1,
      chunkCount: 1,
      unitCount: 5,
      source: 'test',
    });

    assert.equal(result.segments?.length, 2);
    assert.equal(calls.length, 2);
    assert.match(calls[1]!.prompt, /modified the source text/i);
  } finally {
    (axios as typeof axios & {
      post: typeof axios.post;
    }).post = originalPost;
  }
});

test('splitSegmentByLlm uses shared CJK line limits in the prompt', async () => {
  const originalPost = axios.post;
  const calls: Array<{ systemPrompt: string }> = [];
  const words = makeTimedWords(['今', '日', 'は', 'テ', 'ス', 'ト', 'で', 'す', '。']);
  const segment: TranscriptSegment = {
    id: 'llm-ja-segment',
    start: words[0]!.start,
    end: words.at(-1)!.end,
    text: '今日はテストです。',
    words,
  };
  const config: LlmSplitConfig = {
    apiKey: 'test-key',
    baseUrl: 'https://example.invalid/v1',
    model: 'gpt-4o-mini',
    requestTimeoutMs: 60_000,
    maxRetries: 0,
  };

  try {
    (axios as typeof axios & {
      post: typeof axios.post;
    }).post = (async (_url, body) => {
      const requestBody = body as { messages?: Array<{ content?: string }> };
      calls.push({
        systemPrompt: String(requestBody.messages?.[0]?.content || ''),
      });

      return {
        data: {
          choices: [
            {
              message: {
                content: '今日はテストです。',
              },
            },
          ],
        },
      };
    }) as typeof axios.post;

    await splitSegmentByLlm(segment, config, {
      chunkIndex: 1,
      chunkCount: 1,
      unitCount: 9,
      source: 'test',
    });

    assert.match(calls[0]!.systemPrompt, /<=32 characters/);
  } finally {
    (axios as typeof axios & {
      post: typeof axios.post;
    }).post = originalPost;
  }
});

test('buildTranscriptionResult splits long segments without native word timestamps', async () => {
  const tokens = Array.from({ length: 32 }, (_, index) => `word${index + 1}`);
  const text = joinEnglishTokens(tokens);
  const result = await buildTranscriptionResult(buildProviderInput({
    text,
    segments: [
      {
        id: '1',
        start: 0,
        end: 24,
        text,
      },
    ],
  }));

  assert.ok(result.segments.length > 1);
  assert.equal(result.words.length, 0);
  assert.ok(result.segments.every((segment) => !segment.words));
  assert.ok(result.metadata.detected.segmentCount > 1);
});

test('buildTranscriptionResult keeps natural-length Japanese sentences intact', async () => {
  const text = '今日はゲストに西野さんをお呼びして始めたいと思います';
  const result = await buildTranscriptionResult(buildProviderInput({
    text,
    segments: [
      {
        id: '1',
        start: 0,
        end: 4,
        text,
      },
    ],
  }));

  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0]?.text, text);
});

test('buildTranscriptionResult preserves speaker labels after rule-based splitting', async () => {
  const tokens = Array.from({ length: 28 }, (_, index) => `word${index + 1}`);
  const words = makeTimedWords(tokens, { speaker: 'SPEAKER_00' });
  const result = await buildTranscriptionResult(buildProviderInput({
    text: joinEnglishTokens(tokens),
    segments: [
      {
        id: '1',
        start: words[0]!.start,
        end: words.at(-1)!.end,
        text: joinEnglishTokens(tokens),
        speaker: 'SPEAKER_00',
        words,
      },
    ],
  }, {
    diarization: true,
    wordTimestamps: true,
  }));

  assert.ok(result.segments.length > 1);
  assert.ok(result.segments.every((segment) => segment.speaker === 'SPEAKER_00'));
  assert.equal(result.metadata.analysisMode, 'integrated');
});
