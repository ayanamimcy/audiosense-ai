/**
 * Keyword search across SQLite (default) and PostgreSQL.
 * Set TEST_POSTGRES_URL (a database with the vector extension available) to run against PostgreSQL.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const postgresUrl = process.env.TEST_POSTGRES_URL || '';
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audiosense-keyword-'));
if (postgresUrl) {
  process.env.DB_TYPE = 'pg';
  process.env.DATABASE_URL = postgresUrl;
} else {
  process.env.DB_TYPE = 'sqlite3';
  process.env.SQLITE_FILENAME = path.join(tempDir, 'keyword.sqlite');
}
process.env.NODE_ENV = 'test';
// No embeddings: these tests are about keyword search only.
process.env.EMBEDDING_API_KEY = '';
process.env.LLM_API_KEY = '';

const { db, runMigrations, isSqliteDb } = await import('../db.js');
await runMigrations();
const {
  reindexTask, refreshTaskSearchMetadata, searchTasksByText, searchChunksHybrid, mergeKeywordHits, reciprocalRankFusion,
} = await import('../lib/search/search-index.js');
const { streamKnowledgeChatMessage } = await import('../lib/search/knowledge-chat-service.js');
const cjkMigration = await import('../database/migrations/202611030001_cjk_keyword_search.cjs');

// A stub LLM. Query rewrites are unrelated to the question, except that a follow-up sent with
// conversation history mentioning the roadmap is rewritten into "路线图 负责人". Streamed answers
// cite sources the way real answers do. Every request body is recorded.
type LlmRequest = { stream?: boolean; messages: Array<{ role: string; content: string }> };
const llmRequests: LlmRequest[] = [];
const STUB_ANSWER = '结论是先优化说话人分离 [Source 1 @ 00:04]。\n\nSources:\n- 周一例会';
const llmServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    const request = JSON.parse(body) as LlmRequest;
    llmRequests.push(request);
    if (request.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: STUB_ANSWER } }] })}\n\n`);
      res.end('data: [DONE]\n\n');
      return;
    }
    const input = request.messages.at(-1)?.content || '';
    const rewrite = input.includes('Conversation so far') && input.includes('路线图') ? '路线图 负责人' : 'unrelated rewritten words';
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: rewrite } }] }));
  });
});
await new Promise<void>((resolve) => llmServer.listen(0, '127.0.0.1', resolve));
const llmUrl = `http://127.0.0.1:${(llmServer.address() as AddressInfo).port}`;

test.after(async () => {
  await new Promise<void>((resolve) => llmServer.close(() => resolve()));
  await db.destroy();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const USER = 'user-kw';
const WS = 'ws-kw';

async function resetData() {
  if (isSqliteDb()) {
    await db.raw('DELETE FROM task_chunk_fts');
  }
  await db('knowledge_messages').delete();
  await db('knowledge_conversations').delete();
  await db('task_chunks').delete();
  await db('tasks').delete();
  await db('workspaces').delete();
  await db('users').delete();
  await db('users').insert({ id: USER, name: 'KW', email: 'kw@example.com', passwordHash: 'salt:hash', createdAt: 1 });
  await db('workspaces').insert({ id: WS, userId: USER, name: 'WS', description: null, color: '#111111', createdAt: 1, updatedAt: 1 });
}

let createdAt = 100;
async function addTask(id: string, fields: {
  originalName: string;
  transcript: string;
  summary?: string;
  tags?: string[];
  segments?: Array<{ id: string; start: number; end: number; text: string }>;
}) {
  createdAt += 1;
  await db('tasks').insert({
    id,
    userId: USER,
    workspaceId: WS,
    filename: `${id}.wav`,
    originalName: fields.originalName,
    status: 'completed',
    transcript: fields.transcript,
    summary: fields.summary || null,
    tags: JSON.stringify(fields.tags || []),
    segments: fields.segments ? JSON.stringify(fields.segments) : null,
    createdAt,
    updatedAt: createdAt,
  });
  await reindexTask(await db('tasks').where({ id }).first());
}

async function seed() {
  await resetData();
  const roadmapLines = [
    '大家好，今天我们讨论一下第三季度的产品路线图。',
    '会议结论是先优化说话人分离。',
    'The roadmap review covers diarization.',
  ];
  await addTask('task-roadmap', {
    originalName: '周一例会',
    transcript: roadmapLines.join(''),
    summary: '确认了下季度的优先级',
    tags: ['会议', '路线图'],
    segments: roadmapLines.map((text, index) => ({ id: `s${index}`, start: 30 + index * 4, end: 34 + index * 4, text })),
  });
  await addTask('task-weather', {
    originalName: 'Podcast episode',
    transcript: '今天的天气很好，我们去公园散步。Then we talked about hiking gear.',
  });
}

const ids = (hits: Array<{ taskId: string }>) => hits.map((hit) => hit.taskId).sort();

test('search box: Chinese substrings of any length match inside unspaced text', async () => {
  await seed();
  assert.deepEqual(ids(await searchTasksByText(USER, WS, '会议', 'all')), ['task-roadmap']);
  assert.deepEqual(ids(await searchTasksByText(USER, WS, '产品路线图', 'all')), ['task-roadmap']);
  assert.deepEqual(ids(await searchTasksByText(USER, WS, '天气', 'all')), ['task-weather']);
  assert.deepEqual(ids(await searchTasksByText(USER, WS, '今天', 'all')), ['task-roadmap', 'task-weather']);
  // Characters that are not adjacent in the text do not match.
  assert.deepEqual(ids(await searchTasksByText(USER, WS, '路图', 'all')), []);
});

test('search box: every term must match', async () => {
  await seed();
  assert.deepEqual(ids(await searchTasksByText(USER, WS, '今天 天气', 'all')), ['task-weather']);
  assert.deepEqual(ids(await searchTasksByText(USER, WS, '今天 路线图', 'all')), ['task-roadmap']);
  assert.deepEqual(ids(await searchTasksByText(USER, WS, '天气 路线图', 'all')), []);
});

test('English and mixed text still match, case-insensitively', async () => {
  await seed();
  assert.deepEqual(ids(await searchTasksByText(USER, WS, 'ROADMAP', 'all')), ['task-roadmap']);
  assert.deepEqual(ids(await searchTasksByText(USER, WS, 'hiking gear', 'all')), ['task-weather']);
  assert.deepEqual(ids(await searchTasksByText(USER, WS, 'podcast', 'all')), ['task-weather']);
});

test('titles, summaries and tags are searchable', async () => {
  await seed();
  assert.deepEqual(ids(await searchTasksByText(USER, WS, '例会', 'all')), ['task-roadmap']);
  assert.deepEqual(ids(await searchTasksByText(USER, WS, '优先级', 'all')), ['task-roadmap']);
});

test('a natural-language Chinese question finds the recording (Ask AI mode)', async () => {
  await seed();
  const hits = await searchTasksByText(USER, WS, '上周会议的结论是什么？', 'any');
  assert.equal(hits[0]?.taskId, 'task-roadmap');
  assert.ok(!ids(hits).includes('task-weather'));

  const english = await searchTasksByText(USER, WS, 'What did we decide about the roadmap?', 'any');
  assert.equal(english[0]?.taskId, 'task-roadmap');
});

test('snippets show the original text without index separators', async () => {
  await seed();
  const [hit] = await searchTasksByText(USER, WS, '路线图', 'all');
  assert.ok(hit.snippet.includes('[路线图]') || hit.snippet.includes('路线图'), hit.snippet);
  assert.ok(!hit.snippet.includes('​'));
});

test('renaming a recording makes the new Chinese title searchable', async () => {
  await seed();
  await db('tasks').where({ id: 'task-weather' }).update({ originalName: '周末散步录音' });
  await refreshTaskSearchMetadata(await db('tasks').where({ id: 'task-weather' }).first());
  assert.deepEqual(ids(await searchTasksByText(USER, WS, '散步录音', 'all')), ['task-weather']);
});

test('a poor query rewrite does not drop what the original query found', async () => {
  await seed();
  const settings = { llm: { baseUrl: llmUrl, apiKey: 'stub', model: 'stub' } };
  const result = await searchChunksHybrid(USER, WS, '路线图', { retrievalMode: 'fts', settings });
  assert.ok(result.taskRanking.some((item) => item.taskId === 'task-roadmap'));
});

test('mergeKeywordHits keeps each recording once with its best score', () => {
  const merged = mergeKeywordHits(
    [{ taskId: 'a', score: 2, snippet: 'a1' }, { taskId: 'b', score: 1, snippet: 'b1' }],
    [{ taskId: 'b', score: 5, snippet: 'b2' }, { taskId: 'c', score: 3, snippet: 'c2' }],
  );
  assert.deepEqual(merged.map((hit) => [hit.taskId, hit.snippet]), [['b', 'b2'], ['c', 'c2'], ['a', 'a1']]);
});

test('the migration converts an existing SQLite index to the CJK format', { skip: !isSqliteDb() }, async () => {
  await seed();
  // Simulate an index written before this change: plain text, no separators.
  await cjkMigration.down(db);
  assert.deepEqual(ids(await searchTasksByText(USER, WS, '会议', 'all')), []);
  await cjkMigration.up(db);
  assert.deepEqual(ids(await searchTasksByText(USER, WS, '会议', 'all')), ['task-roadmap']);
});

const stubSettings = () => ({ llm: { baseUrl: llmUrl, apiKey: 'stub', model: 'stub' } });

test('keyword-only hits give the model the matching passage with its timestamps', async () => {
  await seed();
  const result = await searchChunksHybrid(USER, WS, '说话人分离', { retrievalMode: 'fts' });
  const chunk = result.chunkRanking.find((item) => item.taskId === 'task-roadmap');
  assert.ok(chunk, 'the recording contributes a chunk');
  assert.ok(chunk.content.includes('大家好') && chunk.content.includes('diarization'), chunk.content);
  assert.equal(chunk.startTime, 30);
  assert.equal(chunk.endTime, 42);
});

test('an @mention scope is applied inside the keyword search', async () => {
  await seed();
  const hits = await searchTasksByText(USER, WS, '今天', 'any', ['task-weather']);
  assert.deepEqual(ids(hits), ['task-weather']);
  const result = await searchChunksHybrid(USER, WS, '今天', { retrievalMode: 'fts', taskIds: ['task-weather'] });
  assert.deepEqual(result.taskRanking.map((item) => item.taskId), ['task-weather']);
});

test('a follow-up question is searched for what it means in the conversation', async () => {
  await seed();
  const followUp = '那这件事谁负责？';
  const history = [
    { role: 'user' as const, content: '产品路线图的结论是什么？' },
    { role: 'assistant' as const, content: '结论是先优化说话人分离。' },
  ];

  const without = await searchChunksHybrid(USER, WS, followUp, { retrievalMode: 'fts', settings: stubSettings() });
  assert.ok(!without.taskRanking.some((item) => item.taskId === 'task-roadmap'), 'the literal follow-up finds nothing');

  llmRequests.length = 0;
  const withHistory = await searchChunksHybrid(USER, WS, followUp, { retrievalMode: 'fts', settings: stubSettings(), history });
  assert.equal(withHistory.taskRanking[0]?.taskId, 'task-roadmap');
  const rewriteInput = llmRequests[0]?.messages.at(-1)?.content || '';
  assert.ok(rewriteInput.includes('产品路线图的结论是什么？') && rewriteInput.includes(followUp), rewriteInput);
  assert.equal(llmRequests.length, 1, 'no extra model call for the follow-up');
});

test('Ask AI sends recent history without old citations and resolves follow-ups', async () => {
  await seed();
  await db('user_settings').where({ userId: USER }).delete().catch(() => {});
  const { saveUserSettings } = await import('../lib/settings/settings.js');
  await saveUserSettings(USER, { llm: { baseUrl: llmUrl, apiKey: 'stub', model: 'stub' }, retrievalMode: 'fts' });

  const first = await streamKnowledgeChatMessage(USER, WS, null, '产品路线图的结论是什么？', [], () => {});
  assert.equal(first.sources[0]?.id, 'task-roadmap');

  llmRequests.length = 0;
  const second = await streamKnowledgeChatMessage(USER, WS, first.conversationId, '那这件事谁负责？', [], () => {});
  assert.equal(second.sources[0]?.id, 'task-roadmap', 'the follow-up found the recording');

  const answerRequest = llmRequests.find((request) => request.stream);
  assert.ok(answerRequest);
  const previousAnswer = answerRequest.messages.find((message) => message.role === 'assistant');
  assert.equal(previousAnswer?.content, '结论是先优化说话人分离。');
  const sourcesBlock = answerRequest.messages.find((message) => message.content.startsWith('Knowledge sources'));
  assert.ok(sourcesBlock?.content.includes('[0:30-0:42]'), 'keyword hits carry timestamps into the prompt');
});

test('reciprocalRankFusion rewards items found by both rankings', () => {
  const scores = reciprocalRankFusion([['a', 'b', 'c'], ['c', 'd']]);
  const order = [...scores.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id);
  assert.deepEqual(order.slice(0, 2), ['c', 'a']);
  // Second place in either ranking is worth the same.
  assert.equal(scores.get('b'), scores.get('d'));
});
