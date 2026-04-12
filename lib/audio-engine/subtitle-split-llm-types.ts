import type { TranscriptSegment } from './types.js';
import type { SplitWordSource } from './subtitle-split-models.js';

export interface LlmSplitConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  requestTimeoutMs: number;
  maxRetries: number;
}

export type SubtitleSplitFailureReason =
  | 'timeout'
  | 'http_429'
  | 'http_5xx'
  | 'invalid_content'
  | 'length_violation'
  | 'alignment_failed'
  | 'empty_response'
  | 'request_failed';

export interface SubtitleSplitFailureInfo {
  reason: SubtitleSplitFailureReason;
  message: string;
  model: string;
  attempt: number;
  status?: number;
  chunkIndex?: number;
  chunkCount?: number;
  unitCount?: number;
  source?: string;
}

export interface SplitSegmentByLlmOptions {
  wordSource?: SplitWordSource;
  chunkIndex?: number;
  chunkCount?: number;
  unitCount?: number;
  source?: string;
}

export interface SplitSegmentByLlmResult {
  segments: TranscriptSegment[] | null;
  failure?: SubtitleSplitFailureInfo;
}
