export const PROVIDER_CATALOG = {
  whisperx: {
    label: 'WhisperX Service',
    description: 'Self-hosted WhisperX HTTP service with diarization and segment-level timestamps.',
  },
  'openai-compatible': {
    label: 'OpenAI Whisper API',
    description: 'OpenAI-style audio transcription and translation endpoints.',
  },
  'azure-openai': {
    label: 'Azure OpenAI ASR',
    description: 'Microsoft-hosted OpenAI deployment for transcription workloads.',
  },
  'local-python': {
    label: 'Local Deployed Models',
    description: 'Python runtime with local Whisper-family models and diarization backends.',
  },
} as const;

export type ProviderCatalogId = keyof typeof PROVIDER_CATALOG;

export const KNOWN_PROVIDER_IDS = Object.keys(PROVIDER_CATALOG) as ProviderCatalogId[];
