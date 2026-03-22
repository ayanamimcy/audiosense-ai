import type { ProviderTranscriptionPayload, TranscriptionJobInput, TranscriptionProvider } from '../types.js';

export abstract class BaseTranscriptionProvider implements TranscriptionProvider {
  abstract readonly name: string;
  abstract readonly capabilities: TranscriptionProvider['capabilities'];

  abstract transcribe(input: TranscriptionJobInput): Promise<ProviderTranscriptionPayload>;
}

