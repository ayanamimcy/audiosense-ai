export class TranscriptionCancelledError extends Error {
  constructor(message = 'Transcription was cancelled.') {
    super(message);
    this.name = 'TranscriptionCancelledError';
  }
}

export function throwIfTranscriptionCancelled(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new TranscriptionCancelledError();
  }
}

export function isTranscriptionCancelledError(error: unknown) {
  return (
    error instanceof TranscriptionCancelledError ||
    (error instanceof Error && error.name === 'TranscriptionCancelledError')
  );
}
