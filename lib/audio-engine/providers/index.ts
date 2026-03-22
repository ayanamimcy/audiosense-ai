import { PROVIDER_CATALOG } from './catalog.js';
import { AzureOpenAIProvider } from './azure-openai.js';
import { LocalPythonProvider } from './local-python.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { WhisperXProvider } from './whisperx.js';
import type { TranscriptionProvider, TranscriptionProviderInfo } from '../types.js';
import {
  resolveLocalRuntimeSettings,
  resolveOpenAIWhisperSettings,
  type UserSettings,
} from '../../user-settings-schema.js';

type ProviderRegistryEntry = {
  create: (settings?: Partial<UserSettings>) => TranscriptionProvider;
  configured: (settings?: Partial<UserSettings>) => boolean;
};

const PROVIDERS: Record<string, ProviderRegistryEntry> = {
  whisperx: {
    create: () => new WhisperXProvider(),
    configured: () => Boolean(process.env.WHISPERX_API_URL || 'http://localhost:8000'),
  },
  'openai-compatible': {
    create: (settings?: Partial<UserSettings>) =>
      new OpenAICompatibleProvider(resolveOpenAIWhisperSettings(settings)),
    configured: (settings?: Partial<UserSettings>) => {
      const config = resolveOpenAIWhisperSettings(settings);
      return config.enabled && Boolean(config.apiKey);
    },
  },
  'azure-openai': {
    create: () => new AzureOpenAIProvider(),
    configured: () =>
      Boolean(
        process.env.AZURE_OPENAI_ENDPOINT &&
          process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT &&
          process.env.AZURE_OPENAI_API_KEY,
      ),
  },
  'local-python': {
    create: (settings?: Partial<UserSettings>) =>
      new LocalPythonProvider(resolveLocalRuntimeSettings(settings)),
    configured: (settings?: Partial<UserSettings>) => {
      const config = resolveLocalRuntimeSettings(settings);
      return config.enabled && Boolean(config.baseUrl);
    },
  },
};

function getProviderName(input?: string) {
  return (input || process.env.TRANSCRIPTION_PROVIDER || 'whisperx').toLowerCase();
}

export function createTranscriptionProvider(
  providerName?: string,
  settings?: Partial<UserSettings>,
): TranscriptionProvider {
  const normalizedProviderName = getProviderName(providerName);
  const entry = PROVIDERS[normalizedProviderName];

  if (!entry) {
    throw new Error(`Unsupported transcription provider: ${normalizedProviderName}`);
  }

  return entry.create(settings);
}

export function getAvailableTranscriptionProviders(
  settings?: Partial<UserSettings>,
): TranscriptionProviderInfo[] {
  return Object.entries(PROVIDERS).map(([id, entry]) => {
    const provider = entry.create(settings);
    const catalogEntry = PROVIDER_CATALOG[id as keyof typeof PROVIDER_CATALOG];

    return {
      id,
      label: catalogEntry.label,
      configured: entry.configured(settings),
      description: catalogEntry.description,
      capabilities: provider.capabilities,
    } satisfies TranscriptionProviderInfo;
  });
}
