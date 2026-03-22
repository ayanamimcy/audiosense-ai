export type TranscriptionTask = 'transcribe' | 'translate';
export type DiarizationMode = 'integrated' | 'word-alignment' | 'segment-only' | 'text-only';
export type ProviderDiarizationCapability = 'integrated' | 'mergeable' | 'none';

export interface TranscriptWord {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker?: string;
  confidence?: number;
}

export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker?: string;
  words?: TranscriptWord[];
}

export interface SpeakerSummary {
  id: string;
  label: string;
  segmentCount: number;
  durationSeconds: number;
  wordCount?: number;
}

export interface AudioFileMetadata {
  filePath: string;
  fileName: string;
  extension: string;
  sizeBytes: number;
  mimeType?: string;
  durationSeconds?: number;
  formatName?: string;
  codecName?: string;
  sampleRateHz?: number;
  channelCount?: number;
  bitRateKbps?: number;
}

export interface TranscriptionProviderCapabilities {
  diarization: ProviderDiarizationCapability;
  wordTimestamps: boolean;
  translation: boolean;
  asyncPolling: boolean;
}

export interface TranscriptionMetadata {
  analysisMode: DiarizationMode;
  warnings: string[];
  media?: AudioFileMetadata;
  providerCapabilities: TranscriptionProviderCapabilities;
  requested: {
    diarization: boolean;
    wordTimestamps: boolean;
    task: TranscriptionTask;
    expectedSpeakers?: number | null;
    translationTargetLanguage?: string | null;
  };
  detected: {
    segmentCount: number;
    wordCount: number;
    speakerCount: number;
  };
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  languageProbability?: number;
  durationSeconds?: number;
  segments: TranscriptSegment[];
  speakers: SpeakerSummary[];
  words: TranscriptWord[];
  raw: unknown;
  metadata: TranscriptionMetadata;
}

export interface TranscriptionJobInput {
  filePath: string;
  fileName?: string;
  mimeType?: string;
  language?: string;
  diarization?: boolean;
  wordTimestamps?: boolean;
  task?: TranscriptionTask;
  translationTargetLanguage?: string;
  expectedSpeakers?: number | null;
}

export interface ProviderTranscriptionPayload {
  payload: Record<string, unknown>;
  warnings?: string[];
}

export interface TranscriptionProvider {
  readonly name: string;
  readonly capabilities: TranscriptionProviderCapabilities;
  transcribe(input: TranscriptionJobInput): Promise<ProviderTranscriptionPayload>;
}

export interface TranscriptionProviderInfo {
  id: string;
  label: string;
  configured: boolean;
  description: string;
  capabilities: TranscriptionProviderCapabilities;
}

export interface TranscriptionExecutionResult {
  providerName: string;
  attemptedProviders: string[];
  skippedProviders: string[];
  result: TranscriptionResult;
}

