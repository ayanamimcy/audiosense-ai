import type { TranscriptSegment, TranscriptWord } from './types.js';

export type LangCode = 'en' | 'zh' | 'ja';
export type SplitWordSource = 'provider' | 'synthetic' | 'mixed';

export interface SplitToken extends TranscriptWord {
  source: Exclude<SplitWordSource, 'mixed'>;
}

export interface PreparedSplitSegment {
  segment: TranscriptSegment;
  tokens: SplitToken[];
  wordSource: Exclude<SplitWordSource, 'mixed'>;
  lang: LangCode;
  unitCount: number;
}

export interface SplitChunk {
  text: string;
  start: number;
  end: number;
  speaker?: string;
  tokens: SplitToken[];
  lang: LangCode;
  unitCount: number;
  wordSource: SplitWordSource;
}

export interface SplitPipelineResult {
  segments: TranscriptSegment[];
  warnings: string[];
}
