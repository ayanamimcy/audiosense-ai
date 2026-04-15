export interface ProviderInfo {
  id: string;
  label: string;
  configured: boolean;
  description: string;
  capabilities?: {
    diarization: 'integrated' | 'mergeable' | 'none';
    wordTimestamps: boolean;
    translation: boolean;
    asyncPolling: boolean;
  };
}

export interface ProviderHealth {
  provider: string;
  failureCount: number;
  successCount: number;
  circuitOpenUntil: number | null;
  lastFailureAt: number | null;
  lastError: string | null;
  updatedAt: number;
  configured: boolean;
}

export interface OpenAIWhisperSettings {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  transcriptionPath: string;
  translationPath: string;
  responseFormat: string;
  disableTimestampGranularities: boolean;
}

export interface LocalRuntimeSettings {
  enabled: boolean;
  baseUrl: string;
  backendId: string;
  modelName: string;
  diarizationStrategy: 'auto' | 'parallel' | 'sequential';
  hfToken: string;
  requestTimeoutMs: number;
}

export interface LlmSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface UserSettings {
  currentWorkspaceId: string;
  parseLanguage: string;
  enableDiarization: boolean;
  defaultProvider: string;
  fallbackProviders: string[];
  autoGenerateSummary: boolean;
  autoSuggestTags: boolean;
  circuitBreakerThreshold: number;
  circuitBreakerCooldownMs: number;
  retrievalMode: 'hybrid' | 'fts' | 'vector';
  maxKnowledgeChunks: number;
  openaiWhisper: OpenAIWhisperSettings;
  localRuntime: LocalRuntimeSettings;
  llm: LlmSettings;
}

export interface LocalRuntimeModelCatalogEntry {
  id: string;
  label: string;
  description: string;
}

export interface LocalRuntimeBackendCatalogEntry {
  id: string;
  label: string;
  description: string;
  supportsDiarization: boolean;
  supportsIntegratedDiarization: boolean;
  supportsTranslation: boolean;
  defaultModel: string;
  models: LocalRuntimeModelCatalogEntry[];
}

export interface AppCapabilities {
  auth: {
    type: string;
    userId: string;
  };
  transcription: {
    activeProvider: string;
    providers: ProviderInfo[];
    diarizationSupported: boolean;
    localRuntime: {
      backends: LocalRuntimeBackendCatalogEntry[];
    };
  };
  queue: {
    workerMode: string;
    recommendedCommand: string;
  };
  llm: {
    configured: boolean;
    model: string;
    baseUrl: string;
  };
  embeddings: {
    configured: boolean;
    model: string;
    baseUrl: string;
  };
}
