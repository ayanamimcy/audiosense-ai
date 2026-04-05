import { inspectAudioFile } from './media.js';
import { buildTranscriptionResult } from './normalize.js';
import { asProcessingError, createServiceError, createTaskError, type ProcessingError } from './errors.js';
import { createTranscriptionProvider } from './providers/index.js';
import {
  buildProviderChain,
  isProviderCircuitOpen,
  recordProviderFailure,
  recordProviderSuccess,
} from './routing.js';
import type { TranscriptionExecutionResult, TranscriptionJobInput } from './types.js';
import { getUserSettings } from '../settings.js';

export async function parseAudioWithFallback(
  userId: string | null | undefined,
  primaryProvider: string | null | undefined,
  input: TranscriptionJobInput,
): Promise<TranscriptionExecutionResult> {
  const userSettings = userId ? await getUserSettings(userId) : null;
  const chain = buildProviderChain(userSettings, primaryProvider);
  const attemptedProviders: string[] = [];
  const skippedProviders: string[] = [];
  const errors: string[] = [];
  const inspectedFile = await inspectAudioFile(input.filePath, {
    mimeType: input.mimeType,
    fileName: input.fileName,
  });
  let lastTaskError: ProcessingError | null = null;

  for (const providerName of chain) {
    if (await isProviderCircuitOpen(providerName)) {
      const circuitError = createServiceError(`Provider ${providerName} circuit open.`, providerName);
      await recordProviderFailure(providerName, userId, circuitError);
      throw circuitError;
    }

    attemptedProviders.push(providerName);

    try {
      const provider = createTranscriptionProvider(providerName, userSettings || undefined);
      const providerResponse = await provider.transcribe({
        ...input,
        wordTimestamps: input.wordTimestamps ?? false,
      });
      const result = buildTranscriptionResult({
        providerName: provider.name,
        providerCapabilities: provider.capabilities,
        request: input,
        providerResponse: {
          ...providerResponse,
          warnings: [...inspectedFile.warnings, ...(providerResponse.warnings || [])],
        },
        media: inspectedFile.metadata,
      });

      await recordProviderSuccess(provider.name);
      return {
        providerName: provider.name,
        attemptedProviders,
        skippedProviders,
        result,
      };
    } catch (error) {
      const normalized = asProcessingError(error, providerName);
      if (normalized.category === 'service') {
        await recordProviderFailure(providerName, userId, normalized);
        throw normalized;
      }

      lastTaskError = normalized;
      errors.push(`${providerName}: ${normalized.message}`);
      skippedProviders.push(providerName);
    }
  }

  if (lastTaskError) {
    throw createTaskError(`All providers failed. ${errors.join(' | ')}`, lastTaskError.provider, lastTaskError);
  }

  throw createServiceError(`All providers failed. ${errors.join(' | ')}`);
}
