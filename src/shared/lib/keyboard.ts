import type { KeyboardEvent } from 'react';

/**
 * True while an input method (Chinese/Japanese/Korean IME) is composing text.
 * Enter/Escape at that moment confirm or cancel the candidate and must not submit or close.
 * Safari reports the confirming keydown with isComposing=false but keyCode 229.
 */
export function isImeComposing(event: KeyboardEvent) {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

/** Enter pressed to submit, not to pick an IME candidate. */
export function isSubmitEnter(event: KeyboardEvent) {
  return event.key === 'Enter' && !isImeComposing(event);
}
