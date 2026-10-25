import { asProcessingError, createServiceError, createTaskError, type ProcessingError } from './errors.js';
import {
  TranscriptionCancelledError,
  isTranscriptionCancelledError,
  throwIfTranscriptionCancelled,
} from './cancellation.js';

export interface ProviderChainResult<T> {
  provider: string;
  value: T;
  attemptedProviders: string[];
  skippedProviders: string[];
}

/**
 * Tries providers in order until one succeeds.
 *
 * - Open circuit: skipped without calling it (the breaker exists so we stop hammering it).
 * - Service error (outage, 429, 5xx, timeout): recorded against the provider's circuit,
 *   then the next provider is tried.
 * - Task error (this input was rejected, e.g. an unsupported format): the next provider is
 *   tried, since another engine may accept it. It does not count against the circuit.
 *
 * When nothing succeeds, a service error wins over a task error: if any provider was merely
 * unavailable, retrying later may still work, so the queue should back off rather than fail
 * the recording permanently.
 */
export async function runProviderChain<T>(
  chain: string[],
  deps: {
    attempt: (provider: string) => Promise<T>;
    isCircuitOpen: (provider: string) => Promise<boolean>;
    recordFailure: (provider: string, error: ProcessingError) => Promise<void>;
    signal?: AbortSignal;
  },
): Promise<ProviderChainResult<T>> {
  const attemptedProviders: string[] = [];
  const skippedProviders: string[] = [];
  const errors: string[] = [];
  let lastServiceError: ProcessingError | null = null;
  let lastTaskError: ProcessingError | null = null;

  for (const provider of chain) {
    throwIfTranscriptionCancelled(deps.signal);

    if (await deps.isCircuitOpen(provider)) {
      skippedProviders.push(provider);
      errors.push(`${provider}: circuit open`);
      lastServiceError = createServiceError(`Provider ${provider} circuit open.`, provider);
      continue;
    }

    attemptedProviders.push(provider);
    try {
      const value = await deps.attempt(provider);
      return { provider, value, attemptedProviders, skippedProviders };
    } catch (error) {
      if (deps.signal?.aborted) {
        throw new TranscriptionCancelledError();
      }
      if (isTranscriptionCancelledError(error)) {
        throw error;
      }

      const normalized = asProcessingError(error, provider);
      skippedProviders.push(provider);
      errors.push(`${provider}: ${normalized.message}`);
      if (normalized.category === 'service') {
        await deps.recordFailure(provider, normalized);
        lastServiceError = normalized;
      } else {
        lastTaskError = normalized;
      }
    }
  }

  const summary = `All providers failed. ${errors.join(' | ')}`;
  if (lastServiceError) {
    throw createServiceError(summary, lastServiceError.provider || chain[0], lastServiceError);
  }
  if (lastTaskError) {
    throw createTaskError(summary, lastTaskError.provider, lastTaskError);
  }
  throw createServiceError('No transcription provider is configured.', chain[0]);
}
