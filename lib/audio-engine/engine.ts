import { inspectAudioFile } from './media.js';
import { buildTranscriptionResult } from './normalize.js';
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

  for (const providerName of chain) {
    if (await isProviderCircuitOpen(providerName)) {
      skippedProviders.push(providerName);
      errors.push(`${providerName}: circuit open`);
      continue;
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
      const normalized =
        error instanceof Error ? error : new Error(`Provider ${providerName} failed: ${String(error)}`);
      await recordProviderFailure(providerName, userId, normalized);
      errors.push(`${providerName}: ${normalized.message}`);
    }
  }

  throw new Error(`All providers failed. ${errors.join(' | ')}`);
}
