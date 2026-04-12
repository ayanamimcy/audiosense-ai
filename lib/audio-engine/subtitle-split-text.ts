import { MAX_CHARS_CJK, MAX_WORDS_EN } from './subtitle-split-limits.js';
import type { LangCode } from './subtitle-split-models.js';

export function detectLanguage(text: string): LangCode {
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) {
    return 'ja';
  }
  if (/[\u4e00-\u9fff]/.test(text)) {
    return 'zh';
  }
  return 'en';
}

export function isCjk(lang: LangCode): boolean {
  return lang === 'zh' || lang === 'ja';
}

export function countTextUnits(text: string, lang: LangCode): number {
  if (isCjk(lang)) {
    return text.replace(/\s/g, '').length;
  }

  return text.split(/\s+/).filter(Boolean).length;
}

export function exceedsLineLimit(text: string, lang: LangCode): boolean {
  return countTextUnits(text, lang) > (isCjk(lang) ? MAX_CHARS_CJK : MAX_WORDS_EN);
}

export function joinWordTexts(words: Array<{ text: string }>, lang: LangCode) {
  const raw = words.map((word) => word.text.trim()).filter(Boolean);
  if (isCjk(lang)) {
    return raw.join('').replace(/\s+/g, '').trim();
  }

  return raw
    .join(' ')
    .replace(/\s+([,.!?;:。！？，、；：])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function mergeTexts(left: string, right: string, lang: LangCode) {
  if (isCjk(lang)) {
    return `${left}${right}`.replace(/\s+/g, '').trim();
  }

  return `${left} ${right}`
    .replace(/\s+([,.!?;:。！？，、；：])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasStrongTerminalPunctuation(text: string) {
  return /[。！？.!?]$/.test(text.trim());
}
