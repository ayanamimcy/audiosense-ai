export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  createdAt: number;
}

export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker?: string;
  words?: TranscriptWord[];
}

export interface TranscriptWord {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker?: string;
  confidence?: number;
}

export interface SpeakerSummary {
  id: string;
  label: string;
  segmentCount: number;
  durationSeconds: number;
  wordCount?: number;
}

export interface Task {
  id: string;
  userId?: string | null;
  filename: string;
  originalName: string;
  status: TaskStatus;
  result?: string;
  transcript?: string;
  summary?: string | null;
  createdAt: number;
  tags: string[];
  notebookId?: string | null;
  eventDate?: number | null;
  language?: string | null;
  provider?: string | null;
  sourceType?: string | null;
  durationSeconds?: number | null;
  segments: TranscriptSegment[];
  speakers: SpeakerSummary[];
  metadata?: Record<string, unknown>;
  startedAt?: number | null;
  completedAt?: number | null;
  updatedAt?: number | null;
  score?: number;
}

export interface Notebook {
  id: string;
  userId?: string | null;
  name: string;
  description?: string | null;
  color?: string | null;
  createdAt: number;
}

export interface TaskMessage {
  id: string;
  taskId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface TagStat {
  name: string;
  count: number;
}

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
  defaultProvider: string;
  fallbackProviders: string[];
  autoGenerateSummary: boolean;
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

export interface KnowledgeAnswer {
  answer: string;
  sources: Array<{
    id: string;
    originalName: string;
    notebookName?: string | null;
    tags: string[];
    snippet?: string;
  }>;
  retrieval: {
    mode: UserSettings['retrievalMode'];
    embeddings: {
      configured: boolean;
      model: string;
      baseUrl: string;
    };
    chunkCount: number;
  };
}

export interface SummaryPrompt {
  id: string;
  userId?: string;
  name: string;
  prompt: string;
  notebookIds: string[];
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}
