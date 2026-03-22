import type { SpeakerSummary, TranscriptSegment } from './transcription.js';
import { repairPossiblyMojibakeText } from './text-encoding.js';

export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface TaskRow {
  id: string;
  userId?: string | null;
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
  return {
    ...task,
    originalName: repairPossiblyMojibakeText(task.originalName),
    tags: parseJsonField<string[]>(task.tags, []),
    segments: parseJsonField<TranscriptSegment[]>(task.segments, []),
    speakers: parseJsonField<SpeakerSummary[]>(task.speakers, []),
    metadata: parseJsonField<Record<string, unknown>>(task.metadata, {}),
  };
}
