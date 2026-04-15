// Re-exports from FSD entity layer — all types are now co-located with their entities.
// This file exists for backward compatibility during migration.

export type { TaskStatus, Task, TranscriptSegment, TranscriptWord, SpeakerSummary, TaskMessage } from '@/entities/task';
export type { AuthUser, PublicConfig } from '@/entities/user';
export type { Notebook } from '@/entities/notebook';
export type { TagStat } from '@/entities/tag';
export type { ApiTokenInfo } from '@/entities/api-token';
export type {
  ProviderInfo, ProviderHealth, OpenAIWhisperSettings, LocalRuntimeSettings,
  LlmSettings, UserSettings, LocalRuntimeModelCatalogEntry,
  LocalRuntimeBackendCatalogEntry, AppCapabilities,
} from '@/entities/settings';
export type {
  KnowledgeAnswer, KnowledgeConversation, KnowledgeSourceCitation,
  KnowledgeSourceMeta, KnowledgeMessageMetadata, KnowledgeMessage,
  MentionRef, MentionCandidate,
} from '@/entities/knowledge';
export type { SummaryPrompt } from '@/entities/summary-prompt';
export type { Workspace } from '@/entities/workspace';
