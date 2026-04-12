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
  console.log(`[transcribe] Starting transcription for "${input.fileName || input.filePath}"`);
  const pipelineStart = Date.now();
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
      console.log(`[transcribe] Sending to provider "${providerName}"...`);
      const providerStart = Date.now();
      const providerResponse = await provider.transcribe({
        ...input,
        wordTimestamps: input.wordTimestamps ?? false,
      });
      console.log(`[transcribe] Provider "${providerName}" completed in ${((Date.now() - providerStart) / 1000).toFixed(1)}s`);
      console.log(`[transcribe] Normalizing and splitting segments...`);
      const normalizeStart = Date.now();
      const result = await buildTranscriptionResult({
        providerName: provider.name,
        providerCapabilities: provider.capabilities,
        request: input,
        providerResponse: {
          ...providerResponse,
          warnings: [...inspectedFile.warnings, ...(providerResponse.warnings || [])],
        },
        media: inspectedFile.metadata,
        llmConfig: userSettings?.subtitleSplit?.enabled && userSettings.subtitleSplit.apiKey
          ? {
              apiKey: userSettings.subtitleSplit.apiKey,
              baseUrl: userSettings.subtitleSplit.baseUrl,
              model: userSettings.subtitleSplit.model,
              requestTimeoutMs: userSettings.subtitleSplit.requestTimeoutMs,
              maxRetries: userSettings.subtitleSplit.maxRetries,
            }
          : undefined,
      });

      console.log(`[transcribe] Normalization + splitting completed in ${((Date.now() - normalizeStart) / 1000).toFixed(1)}s (${result.segments.length} segments)`);
      console.log(`[transcribe] Total pipeline: ${((Date.now() - pipelineStart) / 1000).toFixed(1)}s`);
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
