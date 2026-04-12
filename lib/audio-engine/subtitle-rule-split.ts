import { MAX_CHARS_CJK, MAX_WORDS_EN } from './subtitle-split-limits.js';
import { buildSegmentFromTokens } from './subtitle-split-segments.js';
import type { LangCode, SplitToken, SplitWordSource } from './subtitle-split-models.js';
import { countTextUnits, hasStrongTerminalPunctuation, isCjk, mergeTexts, joinWordTexts } from './subtitle-split-text.js';
import type { TranscriptSegment } from './types.js';

export const MIN_SPLIT_WORDS = 5;
const MIN_SPLIT_CHARS_CJK = 10;
const PAUSE_STRONG = 0.8;
const PAUSE_WEAK = 0.3;
const NATURAL_MERGE_GAP_SECONDS = 0.6;
const SENTENCE_END_PATTERN = /[。！？.!?]$/;
const COMMA_PATTERN = /[，、,;；]$/;

const PREFIX_WORDS: Record<string, Set<string>> = {
  en: new Set(['and', 'or', 'but', 'if', 'then', 'because', 'while', 'when', 'where', 'however', 'moreover', 'so', 'yet', 'although', 'though', 'unless', 'since', 'whereas']),
  zh: new Set(['但', '而', '或', '因', '所以', '如果', '然后', '而且', '不过', '然而', '虽然', '因为', '但是', '我', '你', '他', '她', '它', '这', '那', '哪']),
  ja: new Set(['しかし', 'そして', 'また', 'だから', 'なので', 'もし', 'ただし', 'それから', 'けれども', 'でも', 'ところが', 'それで', 'つまり', 'ちなみに']),
};

const SUFFIX_WORDS: Record<string, Set<string>> = {
  en: new Set(['.', ',', '!', '?', ';', ':', 'mine', 'yours', 'hers', 'theirs', 'either', 'neither']),
  zh: new Set(['的', '了', '着', '过', '吗', '呢', '吧', '啊', '呀', '嘛', '啦', '。', '，', '！', '？']),
  ja: new Set(['です', 'ます', 'ました', 'ません', 'した', 'ない', 'ている', 'ていた', 'でした', 'ですね', 'ますね', 'ですよ', 'ますよ', 'けど', 'けれど', '。', '、', '！', '？']),
};

const JA_SENTENCE_END_PATTERNS: RegExp[] = [
  /ます$/, /ました$/, /ません$/, /ましょう$/,
  /です$/, /でした$/, /ですか$/, /ますか$/,
  /った$/, /んだ$/, /のだ$/,
  /ない$/, /なかった$/,
  /けど$/, /けれど$/, /けども$/,
  /から$/, /ので$/, /のに$/,
  /ですね$/, /ますね$/, /ですよ$/, /ますよ$/,
  /でしょう$/, /だろう$/,
  /ている$/, /ていた$/, /てない$/,
  /ました$/, /ません$/,
];

const JA_CLAUSE_START_PATTERNS: RegExp[] = [
  /^(しかし|そして|また|だから|なので|もし|ただし|それから|けれども|でも)/,
  /^(ところが|それで|つまり|ちなみに|それに|そこで|ただ|なお)/,
  /^(私|僕|俺|彼|彼女|これ|それ|あれ|この|その|あの|今|次)/,
];

const ZH_SENTENCE_END_PATTERNS: RegExp[] = [
  /[了吗呢吧啊呀哦啦嘛哈]$/,
  /[。，！？]$/,
];

const ZH_CLAUSE_START_PATTERNS: RegExp[] = [
  /^(但是|因为|所以|如果|虽然|然后|而且|不过|然而|或者|因此|于是|可是|既然|尽管)/,
  /^(我|你|他|她|它|我们|你们|他们|咱们|这|那|这个|那个|这些|那些)/,
];

const JA_NO_BREAK_AFTER = new Set(['を', 'に', 'が', 'は', 'の', 'と', 'で', 'も', 'へ', 'や', 'か']);
const JA_NO_BREAK_BEFORE = new Set(['お', 'ご', 'っ', 'ゃ', 'ゅ', 'ょ']);
const JA_CONTINUATION_ENDINGS = ['って', 'ので', 'から', 'けど', 'けれど', 'たり', 'とか', 'んで', 'のを', 'ことを', 'ために'];
const JA_NO_BREAK_PATTERNS: RegExp[] = [
  /さんをお/,
  /たいと思/,
  /っていう/,
  /というの/,
  /んですけど/,
  /してお/,
  /してい/,
  /してま/,
  /ことを/,
  /のを/,
  /ために/,
];

const ZH_NO_BREAK_AFTER = new Set(['把', '被', '给', '跟', '和', '与', '对', '向', '在']);
const ZH_NO_BREAK_BEFORE = new Set(['的', '了', '着', '过']);
const ZH_CONTINUATION_ENDINGS = ['的话', '的时候', '就是', '不是', '因为', '所以', '然后'];
const ZH_NO_BREAK_PATTERNS: RegExp[] = [
  /的话/,
  /的时候/,
  /不是/,
  /就是/,
  /这个/,
  /那个/,
  /因为/,
  /所以/,
  /然后/,
];

const EN_CONTINUATION_START_WORDS = new Set(['and', 'but', 'or', 'so', 'because', 'that', 'which', 'who', 'when', 'while', 'if', 'then', 'to', 'for', 'of', 'with', 'in', 'on']);
const EN_CONTINUATION_END_WORDS = new Set(['and', 'but', 'or', 'so', 'because', 'that', 'which', 'who', 'when', 'while', 'if', 'then', 'to', 'for', 'of', 'with', 'in', 'on', 'a', 'an', 'the']);

function isSentenceEnd(token: SplitToken): boolean {
  const text = token.text.trim();
  if (!text) {
    return false;
  }
  if (/\d\.\d/.test(text)) {
    return false;
  }
  if (/^[A-Z][a-z]?\.$/.test(text)) {
    return false;
  }
  return SENTENCE_END_PATTERN.test(text);
}

function isComma(token: SplitToken): boolean {
  return COMMA_PATTERN.test(token.text.trim());
}

function positionWeight(index: number, total: number): number {
  if (total <= 1) {
    return 1;
  }
  const ratio = index / total;
  return Math.max(1.0 - Math.abs(ratio - 0.5) * 2, 0.3);
}

function buildBoundaryContext(tokens: SplitToken[], index: number, window = 3) {
  const start = Math.max(0, index - window + 1);
  const end = Math.min(tokens.length, index + window + 1);
  return tokens.slice(start, end).map((token) => token.text.trim()).join('');
}

export function getBoundaryPenalty(tokens: SplitToken[], index: number, lang: LangCode) {
  const current = tokens[index];
  const next = tokens[index + 1];
  if (!current || !next) {
    return 0;
  }

  const currentText = current.text.trim();
  const nextText = next.text.trim();
  const context = buildBoundaryContext(tokens, index);

  if (lang === 'ja') {
    if (JA_NO_BREAK_PATTERNS.some((pattern) => pattern.test(context))) {
      return 8;
    }
    if (JA_NO_BREAK_AFTER.has(currentText) || JA_NO_BREAK_BEFORE.has(nextText)) {
      return 5;
    }
  }

  if (lang === 'zh') {
    if (ZH_NO_BREAK_PATTERNS.some((pattern) => pattern.test(context))) {
      return 8;
    }
    if (ZH_NO_BREAK_AFTER.has(currentText) || ZH_NO_BREAK_BEFORE.has(nextText)) {
      return 4;
    }
  }

  return 0;
}

function buildNgramEnding(tokens: SplitToken[], endIndex: number, n: number): string {
  const start = Math.max(0, endIndex - n + 1);
  return tokens.slice(start, endIndex + 1).map((token) => token.text.trim()).join('');
}

function buildNgramStarting(tokens: SplitToken[], startIndex: number, n: number): string {
  const end = Math.min(tokens.length, startIndex + n);
  return tokens.slice(startIndex, end).map((token) => token.text.trim()).join('');
}

function matchesAnyPattern(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function scoreBoundary(tokens: SplitToken[], index: number, lang: LangCode): number {
  const current = tokens[index];
  const next = tokens[index + 1];
  if (!current || !next) {
    return 0;
  }

  const gap = next.start - current.end;
  const currentText = current.text.trim().toLowerCase();
  const nextText = next.text.trim().toLowerCase();
  const prefixes = PREFIX_WORDS[lang] || PREFIX_WORDS.en;
  const suffixes = SUFFIX_WORDS[lang] || SUFFIX_WORDS.en;
  const total = tokens.length;
  const fillRatio = (index + 1) / total;

  let signal = 0;

  if (isSentenceEnd(current) && gap >= PAUSE_WEAK) {
    signal = Math.max(signal, 10);
  } else if (isSentenceEnd(current)) {
    signal = Math.max(signal, 8);
  }

  if (isComma(current) && prefixes.has(nextText)) {
    signal = Math.max(signal, 7);
  }
  if (isComma(current) && gap >= PAUSE_WEAK) {
    signal = Math.max(signal, 6);
  }
  if (prefixes.has(nextText) && fillRatio >= 0.6) {
    signal = Math.max(signal, 5);
  }
  if (suffixes.has(currentText) && fillRatio >= 0.4) {
    signal = Math.max(signal, 5);
  }
  if (isComma(current)) {
    signal = Math.max(signal, 4);
  }

  if (isCjk(lang)) {
    const ctx2 = buildNgramEnding(tokens, index, 2);
    const ctx3 = buildNgramEnding(tokens, index, 3);
    const ctx4 = buildNgramEnding(tokens, index, 4);
    const fwd2 = buildNgramStarting(tokens, index + 1, 2);
    const fwd3 = buildNgramStarting(tokens, index + 1, 3);

    const endPatterns = lang === 'ja' ? JA_SENTENCE_END_PATTERNS : ZH_SENTENCE_END_PATTERNS;
    const startPatterns = lang === 'ja' ? JA_CLAUSE_START_PATTERNS : ZH_CLAUSE_START_PATTERNS;

    if (
      (matchesAnyPattern(ctx4, endPatterns)
        || matchesAnyPattern(ctx3, endPatterns)
        || matchesAnyPattern(ctx2, endPatterns))
      && gap >= PAUSE_WEAK
    ) {
      signal = Math.max(signal, 9);
    } else if (
      matchesAnyPattern(ctx4, endPatterns)
      || matchesAnyPattern(ctx3, endPatterns)
      || matchesAnyPattern(ctx2, endPatterns)
    ) {
      signal = Math.max(signal, 7);
    }

    for (const suffix of suffixes) {
      if (suffix.length > 1 && (ctx2.endsWith(suffix) || ctx3.endsWith(suffix)) && fillRatio >= 0.4) {
        signal = Math.max(signal, 6);
        break;
      }
    }

    if (matchesAnyPattern(fwd3, startPatterns) || matchesAnyPattern(fwd2, startPatterns)) {
      signal = Math.max(signal, fillRatio >= 0.5 ? 6 : 4);
    }

    for (const prefix of prefixes) {
      if (prefix.length > 1 && (fwd2.startsWith(prefix) || fwd3.startsWith(prefix)) && fillRatio >= 0.5) {
        signal = Math.max(signal, 5);
        break;
      }
    }
  }

  if (gap >= PAUSE_STRONG) {
    signal = Math.max(signal, 3);
  }
  if (gap >= PAUSE_WEAK) {
    signal = Math.max(signal, 1);
  }

  if (signal === 0) {
    return 0;
  }

  const penalty = getBoundaryPenalty(tokens, index, lang);
  if (penalty >= 8 && gap < PAUSE_STRONG && !isSentenceEnd(current) && !isComma(current)) {
    return 0;
  }

  return Math.max(0, signal * positionWeight(index, total) - penalty);
}

export function segmentLikelyContinues(text: string, lang: LangCode) {
  const trimmed = text.trim();
  if (!trimmed || hasStrongTerminalPunctuation(trimmed)) {
    return false;
  }

  if (lang === 'ja') {
    return JA_NO_BREAK_AFTER.has(trimmed.slice(-1))
      || JA_CONTINUATION_ENDINGS.some((ending) => trimmed.endsWith(ending));
  }

  if (lang === 'zh') {
    return ZH_NO_BREAK_AFTER.has(trimmed.slice(-1))
      || ZH_CONTINUATION_ENDINGS.some((ending) => trimmed.endsWith(ending));
  }

  const words = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  const lastWord = words.at(-1)?.replace(/[.,!?;:]+$/g, '') || '';
  return EN_CONTINUATION_END_WORDS.has(lastWord);
}

export function segmentStartsAsContinuation(text: string, lang: LangCode) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  if (lang === 'ja') {
    return JA_NO_BREAK_BEFORE.has(trimmed[0])
      || /^(って|で|と|を|に|が|は|も|の|けど|けれど|そして|それで|さらに|また|先に)/.test(trimmed);
  }

  if (lang === 'zh') {
    return ZH_NO_BREAK_BEFORE.has(trimmed[0])
      || /^(而且|但是|所以|然后|并且|或者|先|再|又)/.test(trimmed);
  }

  const firstWord = trimmed.toLowerCase().split(/\s+/).filter(Boolean)[0]?.replace(/^[("'`]+|[.,!?;:]+$/g, '') || '';
  return EN_CONTINUATION_START_WORDS.has(firstWord);
}

export function splitSegmentByRules(
  tokens: SplitToken[],
  speaker: string | undefined,
  lang: LangCode,
  wordSource: SplitWordSource,
): TranscriptSegment[] {
  const text = joinWordTexts(tokens, lang);
  if (!text) {
    return [];
  }

  if (!countTextUnits(text, lang) || !tokens.length) {
    return [];
  }

  if (
    countTextUnits(text, lang) <= (isCjk(lang) ? MAX_CHARS_CJK : MAX_WORDS_EN)
    || tokens.length < MIN_SPLIT_WORDS * 2
  ) {
    const segment = buildSegmentFromTokens(tokens, speaker, lang, wordSource);
    return segment ? [segment] : [];
  }

  const isValidSplit = (index: number) => {
    if (isCjk(lang)) {
      const leftText = tokens.slice(0, index + 1).map((token) => token.text.trim()).join('');
      const rightText = tokens.slice(index + 1).map((token) => token.text.trim()).join('');
      return leftText.length >= MIN_SPLIT_CHARS_CJK && rightText.length >= MIN_SPLIT_CHARS_CJK;
    }
    return true;
  };

  let bestIndex = -1;
  let bestScore = 0;
  for (let index = MIN_SPLIT_WORDS - 1; index < tokens.length - MIN_SPLIT_WORDS; index += 1) {
    if (!isValidSplit(index)) {
      continue;
    }
    const score = scoreBoundary(tokens, index, lang);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  if (bestIndex < 0) {
    let maxGap = 0;
    for (let index = MIN_SPLIT_WORDS - 1; index < tokens.length - MIN_SPLIT_WORDS; index += 1) {
      if (!isValidSplit(index)) {
        continue;
      }
      const gap = tokens[index + 1].start - tokens[index].end;
      if (gap > maxGap) {
        maxGap = gap;
        bestIndex = index;
      }
    }
  }

  if (bestIndex < 0) {
    const midpoint = Math.floor((tokens.length - 1) / 2);
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let index = MIN_SPLIT_WORDS - 1; index < tokens.length - MIN_SPLIT_WORDS; index += 1) {
      if (!isValidSplit(index)) {
        continue;
      }
      const distance = Math.abs(index - midpoint);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
  }

  if (bestIndex < 0) {
    const segment = buildSegmentFromTokens(tokens, speaker, lang, wordSource);
    return segment ? [segment] : [];
  }

  return [
    ...splitSegmentByRules(tokens.slice(0, bestIndex + 1), speaker, lang, wordSource),
    ...splitSegmentByRules(tokens.slice(bestIndex + 1), speaker, lang, wordSource),
  ];
}

function getSpeakerKey(speaker?: string) {
  const trimmed = speaker?.trim();
  return trimmed || null;
}

export function mergeAdjacentSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  if (segments.length <= 1) {
    return segments;
  }

  const merged: TranscriptSegment[] = [];

  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (!previous) {
      merged.push(segment);
      continue;
    }

    if (getSpeakerKey(previous.speaker) !== getSpeakerKey(segment.speaker)) {
      merged.push(segment);
      continue;
    }

    const lang = detectMergeLanguage(previous.text, segment.text);
    const maxUnits = isCjk(lang) ? MAX_CHARS_CJK : MAX_WORDS_EN;
    const minUnits = isCjk(lang) ? MIN_SPLIT_CHARS_CJK : MIN_SPLIT_WORDS;
    const gapSeconds = Math.max(0, segment.start - previous.end);
    const previousUnits = countTextUnits(previous.text, lang);
    const currentUnits = countTextUnits(segment.text, lang);
    const combinedText = mergeTexts(previous.text, segment.text, lang);
    const combinedUnits = countTextUnits(combinedText, lang);

    if (
      gapSeconds <= NATURAL_MERGE_GAP_SECONDS
      && combinedUnits <= maxUnits
      && (
        previousUnits < minUnits
        || currentUnits < minUnits
        || segmentLikelyContinues(previous.text, lang)
        || segmentStartsAsContinuation(segment.text, lang)
      )
    ) {
      previous.text = combinedText;
      previous.end = Math.max(previous.end, segment.end);
      previous.words =
        previous.words && segment.words
          ? [...previous.words, ...segment.words]
          : undefined;
      continue;
    }

    merged.push(segment);
  }

  return merged.map((segment, index) => ({
    ...segment,
    id: String(index + 1),
  }));
}

function detectMergeLanguage(...texts: string[]): LangCode {
  const combined = texts.join(' ');
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(combined)) {
    return 'ja';
  }
  if (/[\u4e00-\u9fff]/.test(combined)) {
    return 'zh';
  }
  return 'en';
}
