import type { SubtitleSplitFailureInfo } from './subtitle-split-llm-types.js';
import logger from '../shared/logger.js';

const log = logger.child('subtitle-split');

export function logSubtitleSplitFailure(failure: SubtitleSplitFailureInfo) {
  log.warn('LLM split failed', { event: 'llm_split_failed', ...failure });
}

export function logSubtitleSplitEvent(event: string, payload: Record<string, unknown>) {
  log.info(event, payload);
}
