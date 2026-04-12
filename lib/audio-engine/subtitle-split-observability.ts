import type { SubtitleSplitFailureInfo } from './subtitle-split-llm-types.js';

export function logSubtitleSplitFailure(failure: SubtitleSplitFailureInfo) {
  console.warn('[subtitle-split]', JSON.stringify({
    event: 'llm_split_failed',
    ...failure,
  }));
}

export function logSubtitleSplitEvent(event: string, payload: Record<string, unknown>) {
  console.log('[subtitle-split]', JSON.stringify({
    event,
    ...payload,
  }));
}
