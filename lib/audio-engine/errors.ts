export type ProcessingErrorCategory = 'service' | 'task';

export class ProcessingError extends Error {
  readonly category: ProcessingErrorCategory;
  readonly provider?: string;
  readonly cause?: unknown;

  constructor(
    message: string,
    category: ProcessingErrorCategory,
    options?: { provider?: string; cause?: unknown },
  ) {
    super(message);
    this.name = 'ProcessingError';
    this.category = category;
    this.provider = options?.provider;
    this.cause = options?.cause;
  }
}

type HttpLikeError = {
  code?: string;
  response?: {
    status?: number;
    data?: unknown;
  };
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function hasHttpShape(error: unknown): error is HttpLikeError {
  return Boolean(error) && typeof error === 'object' && ('response' in error || 'code' in error);
}

export function createServiceError(message: string, provider?: string, cause?: unknown) {
  return new ProcessingError(message, 'service', { provider, cause });
}

export function createTaskError(message: string, provider?: string, cause?: unknown) {
  return new ProcessingError(message, 'task', { provider, cause });
}

export function asProcessingError(error: unknown, provider?: string) {
  if (error instanceof ProcessingError) {
    return error;
  }

  const message = getErrorMessage(error);

  if (hasHttpShape(error)) {
    const status = Number(error.response?.status || 0);
    if (status === 408 || status === 409 || status === 423 || status === 425 || status === 429 || status >= 500) {
      return createServiceError(message, provider, error);
    }

    if (status >= 400) {
      return createTaskError(message, provider, error);
    }

    if (error.code) {
      return createServiceError(message, provider, error);
    }
  }

  const normalized = message.toLowerCase();
  const serviceMarkers = [
    'circuit open',
    'runtime',
    'timed out',
    'timeout',
    'econnrefused',
    'enotfound',
    'ehostunreach',
    'network',
    'service unavailable',
    'request failed',
    'connection reset',
  ];
  if (serviceMarkers.some((marker) => normalized.includes(marker))) {
    return createServiceError(message, provider, error);
  }

  return createTaskError(message, provider, error);
}

export function isServiceProcessingError(error: unknown) {
  return asProcessingError(error).category === 'service';
}
