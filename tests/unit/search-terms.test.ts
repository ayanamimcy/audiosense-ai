import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSnippet,
  extractSearchTerms,
  fromFtsIndexText,
  toFtsIndexText,
  toLikePattern,
  toSqliteFtsMatch,
} from '../../lib/search/search-terms.js';

test('index text separates CJK characters and round-trips', () => {
  const text = '用 OpenAI 的GPT模型做会议纪要。';
  const indexed = toFtsIndexText(text);
  assert.ok(indexed.includes('会​议'));
  assert.ok(indexed.includes('GPT​模'));
  assert.ok(indexed.includes('OpenAI'), 'Latin words stay whole');
  assert.equal(fromFtsIndexText(indexed), text);
  // Already-indexed text is not separated twice.
  assert.equal(toFtsIndexText(indexed), indexed);
});

test("'all' mode keeps each space-separated chunk whole", () => {
  assert.deepEqual(extractSearchTerms('产品路线图', 'all'), ['产品路线图']);
  assert.deepEqual(extractSearchTerms('roadmap, Q3 review', 'all'), ['roadmap', 'Q3', 'review']);
  assert.deepEqual(extractSearchTerms('Roadmap roadmap', 'all'), ['Roadmap']);
  assert.deepEqual(extractSearchTerms('  ', 'all'), []);
});

test("'any' mode splits questions into words and drops filler", () => {
  const terms = extractSearchTerms('上周会议的结论是什么？', 'any');
  assert.ok(terms.includes('会议'));
  assert.ok(terms.includes('结论'), `expected 结论 among ${JSON.stringify(terms)}`);
  assert.ok(!terms.includes('的'));

  const english = extractSearchTerms('What did we decide about the roadmap?', 'any');
  assert.ok(english.includes('roadmap'));
  assert.ok(!english.includes('the') && !english.includes('What'));

  // Nothing but filler still searches for something.
  assert.deepEqual(extractSearchTerms('的', 'any'), ['的']);
});

test('MATCH expressions quote terms as phrases', () => {
  assert.equal(toSqliteFtsMatch(['会议', 'GPT模型'], 'all'), '"会 议" "GPT 模 型"');
  assert.equal(toSqliteFtsMatch(['会议', 'roadmap'], 'any'), '"会 议" OR "roadmap"');
});

test('LIKE patterns escape wildcards', () => {
  assert.equal(toLikePattern('50%_off\\'), '%50\\%\\_off\\\\%');
});

test('snippets bracket the first match', () => {
  assert.equal(buildSnippet('今天讨论路线图和预算', ['路线图'], 2), '...讨论[路线图]和预...');
  assert.equal(buildSnippet('Roadmap first', ['roadmap'], 10), '[Roadmap] first');
  assert.equal(buildSnippet('nothing here', ['roadmap']), '');
});
