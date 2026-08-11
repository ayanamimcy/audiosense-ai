import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTranscriptionResult } from '../../lib/audio-engine/normalize.js';
import { labelTranscriptWithSpeakers } from '../../lib/audio-engine/speaker-merge.js';

test('speaker assignment enriches metadata without rebuilding authoritative segment text', () => {
  const authoritativeText = 'AIエンジニアリングとagents.mdについて話します';
  const result = labelTranscriptWithSpeakers(
    [
      {
        id: 'raw-1',
        start: 0,
        end: 4,
        text: authoritativeText,
      },
    ],
    [
      { id: '1', start: 0.4, end: 2.2, text: 'エンジニアリング' },
      { id: '2', start: 2.3, end: 3.8, text: 'について話します' },
    ],
    [{ start: 0, end: 4, speaker: 'SPEAKER_00' }],
  );

  assert.equal(result.segments[0]?.text, authoritativeText);
  assert.equal(result.segments[0]?.speaker, 'SPEAKER_00');
  assert.ok(result.words.every((word) => word.speaker === 'SPEAKER_00'));
});

test('normalization preserves provider text when diarization words omit unalignable tokens', async () => {
  const authoritativeText = 'AIエンジニアリングとagents.mdについて話します';
  const result = await buildTranscriptionResult({
    providerCapabilities: {
      diarization: 'mergeable',
      wordTimestamps: true,
      translation: true,
      asyncPolling: false,
    },
    request: {
      filePath: '/tmp/example.wav',
      diarization: true,
      wordTimestamps: true,
      task: 'transcribe',
    },
    providerResponse: {
      payload: {
        text: authoritativeText,
        language: 'ja',
        segments: [
          {
            id: 'raw-1',
            start: 0,
            end: 4,
            text: authoritativeText,
          },
        ],
        words: [
          { id: '1', start: 0.4, end: 2.2, text: 'エンジニアリング' },
          { id: '2', start: 2.3, end: 3.8, text: 'について話します' },
        ],
        diarization_segments: [{ start: 0, end: 4, speaker: 'SPEAKER_00' }],
      },
      warnings: [],
    },
    providerName: 'local-python',
  });

  assert.equal(result.text, authoritativeText);
  assert.equal(result.segments[0]?.text, authoritativeText);
  assert.equal(result.segments[0]?.speaker, 'SPEAKER_00');
  assert.equal(result.metadata.analysisMode, 'word-alignment');
});
