/** Pure helpers for live captions: translation direction and WAV framing. */

export const LIVE_SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2; // PCM16 mono
export const WAV_HEADER_BYTES = 44;

const KANA = /[぀-ヿ]/;
const HAN = /[㐀-䶿一-鿿]/;
const HANGUL = /[가-힯]/;

export type LiveLanguage = 'auto' | 'zh' | 'ja';

/**
 * The language a caption is in. The recognizer's own language code wins; text with kana is
 * Japanese and Han-only text is Chinese (a fallback for when the recognizer reports nothing).
 */
export function detectCaptionLanguage(text: string, recognizedLanguage?: string | null) {
  const code = String(recognizedLanguage || '').trim().toLowerCase();
  if (code) {
    if (code.startsWith('zh') || code === 'yue') return 'zh';
    return code.split(/[-_]/)[0];
  }
  if (KANA.test(text)) return 'ja';
  if (HANGUL.test(text)) return 'ko';
  if (HAN.test(text)) return 'zh';
  return null;
}

/**
 * Chinese <-> Japanese: Japanese captions are translated into Chinese and Chinese captions into
 * Japanese. Anything else (an English aside, say) goes into Chinese.
 */
export function chooseTranslationTarget(sourceLanguage: string | null) {
  if (sourceLanguage === 'ja') return 'zh';
  if (sourceLanguage === 'zh') return 'ja';
  return 'zh';
}

/** Milliseconds of audio in `bytes` of 16 kHz PCM16 mono. */
export function pcmBytesToMs(bytes: number) {
  return Math.round((bytes / BYTES_PER_SAMPLE / LIVE_SAMPLE_RATE) * 1000);
}

/** A canonical 44-byte WAV header for `dataBytes` of 16 kHz PCM16 mono. */
export function buildWavHeader(dataBytes: number) {
  const header = Buffer.alloc(WAV_HEADER_BYTES);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(LIVE_SAMPLE_RATE, 24);
  header.writeUInt32LE(LIVE_SAMPLE_RATE * BYTES_PER_SAMPLE, 28); // byte rate
  header.writeUInt16LE(BYTES_PER_SAMPLE, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

export function normalizeLiveLanguage(value: unknown): LiveLanguage {
  return value === 'zh' || value === 'ja' ? value : 'auto';
}
