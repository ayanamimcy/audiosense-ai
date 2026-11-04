import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWavHeader,
  chooseTranslationTarget,
  detectCaptionLanguage,
  normalizeLiveLanguage,
  pcmBytesToMs,
} from '../../lib/live/live-caption-utils.js';

test('caption language: recognizer code first, then script', () => {
  assert.equal(detectCaptionLanguage('whatever', 'ja'), 'ja');
  assert.equal(detectCaptionLanguage('whatever', 'zh-CN'), 'zh');
  assert.equal(detectCaptionLanguage('今日は会議です', null), 'ja');
  assert.equal(detectCaptionLanguage('我们开会吧', null), 'zh');
  assert.equal(detectCaptionLanguage('let us start', null), null);
});

test('translation direction is Chinese <-> Japanese, anything else into Chinese', () => {
  assert.equal(chooseTranslationTarget('ja'), 'zh');
  assert.equal(chooseTranslationTarget('zh'), 'ja');
  assert.equal(chooseTranslationTarget('en'), 'zh');
  assert.equal(chooseTranslationTarget(null), 'zh');
});

test('WAV header describes 16 kHz mono PCM16', () => {
  const header = buildWavHeader(32000);
  assert.equal(header.length, 44);
  assert.equal(header.toString('ascii', 0, 4), 'RIFF');
  assert.equal(header.readUInt32LE(4), 36 + 32000);
  assert.equal(header.toString('ascii', 8, 12), 'WAVE');
  assert.equal(header.readUInt16LE(22), 1);
  assert.equal(header.readUInt32LE(24), 16000);
  assert.equal(header.readUInt16LE(34), 16);
  assert.equal(header.readUInt32LE(40), 32000);
  assert.equal(pcmBytesToMs(32000), 1000);
});

test('unknown languages fall back to auto-detect', () => {
  assert.equal(normalizeLiveLanguage('ja'), 'ja');
  assert.equal(normalizeLiveLanguage('fr'), 'auto');
  assert.equal(normalizeLiveLanguage(undefined), 'auto');
});
