import { AzureOpenAIProvider } from './azure-openai.js';
import { LocalPythonProvider } from './local-python.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { WhisperXProvider } from './whisperx.js';
import type { TranscriptionProvider, TranscriptionProviderInfo } from '../types.js';

const PROVIDERS = {
  whisperx: {
    create: () => new WhisperXProvider(),
    label: 'WhisperX',
    configured: () => Boolean(process.env.WHISPERX_API_URL || 'http://localhost:8000'),
    description: 'Self-hosted service with diarization and segment-level timestamps.',
  },
  'openai-compatible': {
    create: () => new OpenAICompatibleProvider(),
    label: 'OpenAI-Compatible ASR',
    configured: () => Boolean(process.env.OPENAI_TRANSCRIPTION_API_KEY || process.env.OPENAI_API_KEY),
    description: 'OpenAI-style audio transcription and translation endpoints.',
  },
  'azure-openai': {
    create: () => new AzureOpenAIProvider(),
    label: 'Azure OpenAI ASR',
    configured: () =>
      Boolean(
        process.env.AZURE_OPENAI_ENDPOINT &&
          process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT &&
          process.env.AZURE_OPENAI_API_KEY,
      ),
    description: 'Microsoft-hosted OpenAI deployment for transcription workloads.',
  },
  'local-python': {
    create: () => new LocalPythonProvider(),
    label: 'Local Python Runtime',
    configured: () =>
      process.env.LOCAL_AUDIO_ENGINE_ENABLED === 'true' || Boolean(process.env.LOCAL_AUDIO_ENGINE_URL),
    description: 'Local faster-whisper / WhisperX + PyAnnote runtime started from this repo.',
  },
} as const;

function getProviderName(input?: string) {
  return (input || process.env.TRANSCRIPTION_PROVIDER || 'whisperx').toLowerCase();
}

export function createTranscriptionProvider(providerName?: string): TranscriptionProvider {
  const normalizedProviderName = getProviderName(providerName);
  const entry = PROVIDERS[normalizedProviderName as keyof typeof PROVIDERS];

  if (!entry) {
    throw new Error(`Unsupported transcription provider: ${normalizedProviderName}`);
  }

  return entry.create();
}

export function getAvailableTranscriptionProviders(): TranscriptionProviderInfo[] {
  return Object.entries(PROVIDERS).map(([id, entry]) => {
    const provider = entry.create();

    return {
      id,
      label: entry.label,
      configured: entry.configured(),
      description: entry.description,
      capabilities: provider.capabilities,
    } satisfies TranscriptionProviderInfo;
  });
}
