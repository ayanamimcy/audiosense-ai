import test from 'node:test';
import assert from 'node:assert/strict';
import {
  characterErrorRate,
  editDistance,
  normalizeForCer,
  pooledErrorRate,
  rangesOverlap,
  recallAtK,
  reciprocalRank,
  wordErrorRate,
} from '../../lib/evaluation/metrics.js';

test('edit distance counts substitutions, insertions and deletions', () => {
  assert.equal(editDistance([...'kitten'], [...'sitting']), 3);
  assert.equal(editDistance([], [...'abc']), 3);
  assert.equal(editDistance([...'abc'], []), 3);
});

test('CER ignores width, punctuation and spacing differences', () => {
  assert.equal(normalizeForCer('ＡＩ　エンジニア、です。'), 'aiエンジニアです');
  assert.equal(characterErrorRate('今日はＡＩの話です。', '今日は AI の話です').rate, 0);
});

test('CER counts a misrecognized proper noun per character', () => {
  // One substituted character (ト → ク) out of 9.
  const result = characterErrorRate('株式会社ロナバイト', '株式会社ロナバイク');
  assert.equal(result.errors, 1);
  assert.equal(result.referenceLength, 9);
});

test('WER works on space-delimited text', () => {
  const result = wordErrorRate('the quick brown fox', 'the quick brown box!');
  assert.equal(result.errors, 1);
  assert.equal(result.rate, 0.25);
});

test('pooled rate weights long clips more than short ones', () => {
  const short = characterErrorRate('はい', 'いいえ');
  const long = characterErrorRate('あ'.repeat(100), 'あ'.repeat(100));
  // Averaging per-clip rates would give ~0.75; pooling gives total errors / total length.
  assert.ok(pooledErrorRate([short, long]) < 0.05);
});

test('recall@k and reciprocal rank', () => {
  const ranked = ['a', 'b', 'c', 'd'];
  assert.equal(recallAtK(ranked, new Set(['b', 'z']), 3), 0.5);
  assert.equal(recallAtK(ranked, new Set(['d']), 3), 0);
  assert.equal(reciprocalRank(ranked, new Set(['c'])), 1 / 3);
  assert.equal(reciprocalRank(ranked, new Set(['z'])), 0);
});

test('time ranges overlap with tolerance', () => {
  assert.equal(rangesOverlap({ start: 10, end: 20 }, { start: 21, end: 30 }), false);
  assert.equal(rangesOverlap({ start: 10, end: 20 }, { start: 21, end: 30 }, 2), true);
});
