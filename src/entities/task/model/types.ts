export type TaskStatus = 'pending' | 'processing' | 'blocked' | 'completed' | 'failed';

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

export interface TaskMessage {
  id: string;
  taskId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  pending?: boolean;
  error?: boolean;
}
