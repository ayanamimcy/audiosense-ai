export type TaskStatus = 'pending' | 'processing' | 'blocked' | 'completed' | 'failed';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  createdAt: number;
}

export interface PublicConfig {
  auth: {
    allowRegistration: boolean;
  };
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
  workspaceId?: string | null;
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
  summarySnippet?: string | null;
  segments: TranscriptSegment[];
  speakerCount: number;
  metadata?: Record<string, unknown>;
  score?: number;
}

export interface Notebook {
  id: string;
  userId?: string | null;
  workspaceId?: string | null;
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
  pending?: boolean;
  error?: boolean;
}

export interface TagStat {
  name: string;
  count: number;
}

export interface ApiTokenInfo {
  id: string;
  name: string;
  scopes: string[];
  expiresAt: number | null;
  createdAt: number;
  lastUsedAt: number | null;
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

export interface KnowledgeConversation {
  id: string;
  userId: string;
  workspaceId?: string | null;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeSourceCitation {
  content: string;
  startTime: number | null;
  endTime: number | null;
}

export interface KnowledgeSourceMeta {
  id: string;
  sourceIndex: number;
  originalName: string;
  notebookName?: string | null;
  tags: string[];
  snippet: string;
  citations?: KnowledgeSourceCitation[];
}

export interface KnowledgeMessageMetadata {
  sources?: KnowledgeSourceMeta[];
  retrieval?: {
    mode: string;
    chunkCount: number;
  };
}

export interface KnowledgeMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  mentions: MentionRef[];
  metadata: KnowledgeMessageMetadata | null;
  createdAt: number;
  pending?: boolean;
  error?: boolean;
}

export interface MentionRef {
  type: 'notebook' | 'task';
  id: string;
  name: string;
}

export interface MentionCandidate {
  type: 'notebook' | 'task';
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  notebookId?: string | null;
}

export interface SummaryPrompt {
  id: string;
  userId?: string;
  workspaceId?: string | null;
  name: string;
  prompt: string;
  notebookIds: string[];
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Workspace {
  id: string;
  userId: string;
  name: string;
  description?: string | null;
  color?: string | null;
  createdAt: number;
  updatedAt: number;
}
