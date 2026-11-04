import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareAnswerHistory,
  prepareRetrievalHistory,
  stripCitations,
  type ConversationTurn,
} from '../../lib/ai/conversation-history.js';

test('stripCitations removes per-turn source markers and the trailing sources list', () => {
  const english = 'The team chose diarization first [Source 1 @ 02:15]. Budget is open [Source 2].\n\n**Sources**\n- Weekly sync\n- Budget review';
  assert.equal(stripCitations(english), 'The team chose diarization first. Budget is open.');

  const chinese = '结论是先优化说话人分离 [Source 1 @ 00:04]，由张三负责 [Sources 1, 2]。\n\n来源：\n1. 周一例会';
  assert.equal(stripCitations(chinese), '结论是先优化说话人分离，由张三负责。');

  const heading = 'Answer [Source 3 @ 1:02:03; Source 4]\n\n## Sources\n- A';
  assert.equal(stripCitations(heading), 'Answer');

  // Text that merely mentions sources is kept.
  assert.equal(stripCitations('We discussed open sources of funding.'), 'We discussed open sources of funding.');
});

function conversation(turns: number): ConversationTurn[] {
  return Array.from({ length: turns }, (_, index) => [
    { role: 'user' as const, content: `question ${index + 1}` },
    { role: 'assistant' as const, content: `answer ${index + 1} [Source 1 @ 00:0${index}]` },
  ]).flat();
}

test('answer history keeps the last four turns without citations', () => {
  const history = prepareAnswerHistory(conversation(6));
  assert.equal(history.length, 8);
  assert.deepEqual(history[0], { role: 'user', content: 'question 3' });
  assert.deepEqual(history.at(-1), { role: 'assistant', content: 'answer 6' });
});

test('retrieval history keeps the last two turns and clips long answers', () => {
  const turns = conversation(3);
  turns[5] = { role: 'assistant', content: 'x'.repeat(5000) };
  const history = prepareRetrievalHistory(turns);
  assert.deepEqual(history.map((message) => message.content.slice(0, 10)), ['question 2', 'answer 2', 'question 3', 'xxxxxxxxxx']);
  assert.ok(history[3].content.length <= 600);
});

test('a question that was never answered is kept and empty messages are dropped', () => {
  const history = prepareAnswerHistory([
    { role: 'user', content: 'stopped question' },
    { role: 'user', content: 'next question' },
    { role: 'assistant', content: '   ' },
  ]);
  assert.deepEqual(history.map((message) => message.content), ['stopped question', 'next question']);
});
