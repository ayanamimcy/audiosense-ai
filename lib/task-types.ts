import type { SpeakerSummary, TranscriptSegment } from './transcription.js';
import { repairPossiblyMojibakeText } from './text-encoding.js';

export type TaskStatus = 'pending' | 'processing' | 'blocked' | 'completed' | 'failed';
export type JobStatus = 'queued' | 'processing' | 'blocked' | 'completed' | 'failed';

export interface TaskRow {
  id: string;
  userId?: string | null;
  workspaceId?: string | null;
  filename: string;
  originalName: string;
  status: TaskStatus;
  result?: string | null;
  transcript?: string | null;
  summary?: string | null;
  createdAt: number;
  notebookId?: string | null;
  eventDate?: number | null;
  tags?: string | null;
  language?: string | null;
  provider?: string | null;
  sourceType?: string | null;
  durationSeconds?: number | null;
  segments?: string | null;
  speakers?: string | null;
  metadata?: string | null;
  startedAt?: number | null;
  completedAt?: number | null;
  updatedAt?: number | null;
}

export interface TaskMessageRow {
  id: string;
  taskId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface TaskJobRow {
  id: string;
  taskId: string;
  userId?: string | null;
  status: JobStatus;
  provider: string;
  attemptCount: number;
  payload?: string | null;
  lastError?: string | null;
  runAfter: number;
  lockedAt?: number | null;
  workerId?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeConversationRow {
  id: string;
  userId: string;
  workspaceId?: string | null;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeMessageRow {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  mentions?: string | null;
  metadata?: string | null;
  createdAt: number;
}

export interface QueueStateRow {
  queueName: string;
  paused: boolean;
  reason?: string | null;
  blockedJobId?: string | null;
  blockedTaskId?: string | null;
  provider?: string | null;
  lastError?: string | null;
  resumeCheckAfter?: number | null;
  updatedAt: number;
}

export function parseJsonField<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function normalizeTags(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 20);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 20);
  }

  return [];
}

export function toTaskResponse(task: TaskRow) {
  const segments = parseJsonField<TranscriptSegment[]>(task.segments, []);
  const speakers = parseJsonField<SpeakerSummary[]>(task.speakers, []);
  const metadata = parseJsonField<Record<string, unknown>>(task.metadata, {});

  return {
    id: task.id,
    workspaceId: task.workspaceId || null,
    filename: task.filename,
    originalName: repairPossiblyMojibakeText(task.originalName),
    status: task.status,
    result: task.result,
    transcript: task.transcript,
    summary: task.summary,
    createdAt: task.createdAt,
    notebookId: task.notebookId,
    eventDate: task.eventDate,
    tags: parseJsonField<string[]>(task.tags, []),
    language: task.language,
    provider: task.provider,
    durationSeconds: task.durationSeconds,
    segments: segments.map(({ id, start, end, text, speaker }) => ({ id, start, end, text, speaker })),
    speakerCount: speakers.length,
    metadata: {
      originalMimeType: metadata.originalMimeType,
      summaryGenerationStatus: metadata.summaryGenerationStatus,
      summaryGenerationError: metadata.summaryGenerationError,
      tagSuggestionStatus: metadata.tagSuggestionStatus,
      tagSuggestionError: metadata.tagSuggestionError,
      tagSuggestionItems: metadata.tagSuggestionItems,
      tagSuggestionGeneratedAt: metadata.tagSuggestionGeneratedAt,
      tagSuggestionDismissedAt: metadata.tagSuggestionDismissedAt,
      searchSnippet: metadata.searchSnippet,
    },
  };
}

export function toTaskListResponse(task: TaskRow) {
  return {
    id: task.id,
    userId: task.userId,
    workspaceId: task.workspaceId || null,
    filename: task.filename,
    originalName: repairPossiblyMojibakeText(task.originalName),
    status: task.status,
    createdAt: task.createdAt,
    notebookId: task.notebookId,
    eventDate: task.eventDate,
    tags: parseJsonField<string[]>(task.tags, []),
    language: task.language,
    provider: task.provider,
    sourceType: task.sourceType,
    durationSeconds: task.durationSeconds,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    updatedAt: task.updatedAt,
    summarySnippet: task.summary && task.summary !== '__generating__'
      ? task.summary.slice(0, 100)
      : null,
    segments: [],
    speakerCount: 0,
    metadata: {},
  };
}
