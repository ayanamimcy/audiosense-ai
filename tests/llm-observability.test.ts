import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import { setupTestDb } from './helpers/setup.js';

const { db, resetDb, cleanup } = await setupTestDb();
const { generateTaskSummary, streamChatWithTranscript } = await import('../lib/ai/llm.js');
const { buildPromptVersion, estimateTokens, readProviderUsage } = await import('../lib/ai/llm-trace.js');
const { summarizeLlmUsage, percentile } = await import('../lib/ai/llm-usage.js');

type Handler = (body: Record<string, unknown>, res: http.ServerResponse) => void;
let handler: Handler = () => {};
const requests: Record<string, unknown>[] = [];
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    requests.push(body);
    handler(body, res);
  });
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
const settings = { llm: { baseUrl, apiKey: 'test-key', model: 'test-model' } } as never;

test.after(async () => {
  server.close();
  await cleanup();
});
test.beforeEach(async () => {
  await resetDb();
  requests.length = 0;
  const now = Date.now();
  await db('users').insert({ id: 'user-llm', name: 'LLM', email: 'llm@example.com', passwordHash: 'x:y', createdAt: now });
});

const context = { title: 'Weekly sync', transcript: '今日は来週のリリースについて話しました。', language: 'ja' };

async function waitForCalls(count: number) {
  for (let i = 0; i < 50; i += 1) {
    const rows = await db('llm_calls').select();
    if (rows.length >= count) return rows;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return db('llm_calls').select();
}

function sse(res: http.ServerResponse, frames: unknown[]) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const frame of frames) res.write(`data: ${JSON.stringify(frame)}\n\n`);
  res.end('data: [DONE]\n\n');
}

test('a completion records provider-reported usage and a prompt version, but no prompt text', async () => {
  handler = (_body, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { content: '## 概要\nリリースの話。' } }],
      usage: { prompt_tokens: 321, completion_tokens: 12 },
    }));
  };

  await generateTaskSummary(context, undefined, settings, 'Summarize decisions.', { userId: 'user-llm', taskId: 'task-1' });
  const [row] = await waitForCalls(1);

  assert.equal(row.operation, 'summary');
  assert.equal(row.status, 'ok');
  assert.equal(row.model, 'test-model');
  assert.equal(row.taskId, 'task-1');
  assert.equal(row.usageSource, 'provider');
  assert.equal(row.inputTokens, 321);
  assert.equal(row.outputTokens, 12);
  assert.match(row.promptVersion, /^summary@[0-9a-f]{8}$/);
  assert.equal(row.providerHost, new URL(baseUrl).host);
  assert.ok(row.latencyMs >= 0);
  const stored = JSON.stringify(row);
  assert.ok(!stored.includes('リリース') && !stored.includes('test-key'), 'no content or secrets are stored');
});

test('changing the summary template changes the prompt version; the transcript does not', async () => {
  handler = (_body, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
  };
  const trace = { userId: 'user-llm' };
  await generateTaskSummary(context, undefined, settings, 'Template A', trace);
  await generateTaskSummary({ ...context, transcript: 'まったく別の録音。' }, undefined, settings, 'Template A', trace);
  await generateTaskSummary(context, undefined, settings, 'Template B', trace);
  const rows = await waitForCalls(3);
  const versions = rows.sort((a, b) => a.createdAt - b.createdAt).map((row) => row.promptVersion);

  assert.equal(versions[0], versions[1]);
  assert.notEqual(versions[0], versions[2]);
});

test('a provider without usage is recorded as an estimate', async () => {
  handler = (_body, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'short answer' } }] }));
  };
  await generateTaskSummary(context, undefined, settings, null, { userId: 'user-llm' });
  const [row] = await waitForCalls(1);
  assert.equal(row.usageSource, 'estimated');
  assert.ok(row.inputTokens > 0);
});

test('a failed call is recorded with an error category and the error still reaches the caller', async () => {
  handler = (_body, res) => {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'slow down' } }));
  };
  await assert.rejects(generateTaskSummary(context, undefined, settings, null, { userId: 'user-llm' }));
  const [row] = await waitForCalls(1);
  assert.equal(row.status, 'error');
  assert.equal(row.errorCategory, 'rate_limited');
  assert.equal(row.httpStatus, 429);
});

test('a stream asks for usage, records time to first token and the final usage frame', async () => {
  handler = (_body, res) => sse(res, [
    { choices: [{ delta: { content: 'こん' } }] },
    { choices: [{ delta: { content: 'にちは' } }] },
    { choices: [], usage: { prompt_tokens: 50, completion_tokens: 3 } },
  ]);

  const deltas: string[] = [];
  const reply = await streamChatWithTranscript(context, [], 'hello?', settings, (d) => { deltas.push(d); }, undefined, {
    userId: 'user-llm',
    taskId: 'task-2',
  });
  assert.equal(reply, 'こんにちは');
  assert.deepEqual((requests[0].stream_options as { include_usage: boolean }), { include_usage: true });

  const [row] = await waitForCalls(1);
  assert.equal(row.operation, 'task_chat');
  assert.equal(Boolean(row.streamed), true);
  assert.equal(row.usageSource, 'provider');
  assert.equal(row.outputTokens, 3);
  assert.ok(row.firstTokenMs != null && row.firstTokenMs <= row.latencyMs);
});

test('a server that rejects stream_options is retried without it', async () => {
  handler = (body, res) => {
    if (body.stream_options) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Unrecognized field stream_options' } }));
      return;
    }
    sse(res, [{ choices: [{ delta: { content: 'ok' } }] }]);
  };
  const reply = await streamChatWithTranscript(context, [], 'hi', settings, undefined, undefined, { userId: 'user-llm' });
  assert.equal(reply, 'ok');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].stream_options, undefined);

  const [row] = await waitForCalls(1);
  assert.equal(row.status, 'ok');
  assert.equal(row.usageSource, 'estimated');
});

test('token estimates treat CJK characters as roughly one token each', () => {
  assert.equal(estimateTokens('abcdefgh'), 2);
  assert.equal(estimateTokens('会議録'), 3);
});

test('usage parsing accepts both OpenAI and Responses-style field names', () => {
  assert.deepEqual(readProviderUsage({ usage: { prompt_tokens: 1, completion_tokens: 2 } }), { inputTokens: 1, outputTokens: 2 });
  assert.deepEqual(readProviderUsage({ usage: { input_tokens: 3, output_tokens: 4 } }), { inputTokens: 3, outputTokens: 4 });
  assert.equal(readProviderUsage({}), null);
});

test('prompt versions are stable for the same template', () => {
  assert.equal(buildPromptVersion('summary', ['a', 'b']), buildPromptVersion('summary', ['a', 'b']));
  assert.notEqual(buildPromptVersion('summary', ['a', 'b']), buildPromptVersion('summary', ['a', 'c']));
});

test('usage summary computes percentiles from successful calls and prices only priced models', () => {
  const base = {
    userId: 'u', taskId: null, providerHost: 'h', streamed: false, errorCategory: null, httpStatus: null,
    firstTokenMs: null, usageSource: 'provider' as const, inputChars: 1, outputChars: 1, createdAt: 0,
  };
  const rows = [
    ...[100, 200, 300, 400].map((latencyMs, i) => ({
      ...base, id: `a${i}`, operation: 'summary', model: 'priced', promptVersion: 'summary@1',
      status: 'ok' as const, latencyMs, inputTokens: 1000, outputTokens: 100,
    })),
    { ...base, id: 'err', operation: 'summary', model: 'priced', promptVersion: 'summary@2', status: 'error' as const,
      errorCategory: 'timeout', latencyMs: 120000, inputTokens: 1000, outputTokens: 0 },
    { ...base, id: 'b', operation: 'knowledge_chat', model: 'unpriced', promptVersion: 'knowledge_chat@1',
      status: 'ok' as const, latencyMs: 50, inputTokens: 10, outputTokens: 10, usageSource: 'estimated' as const },
  ];

  const summary = summarizeLlmUsage(rows, { priced: { inputPerMTok: 1, outputPerMTok: 10 } }, 0);
  const summaryGroup = summary.groups.find((group) => group.operation === 'summary')!;
  assert.equal(summaryGroup.calls, 5);
  assert.equal(summaryGroup.latencyP50Ms, 200, 'the 120 s timeout is excluded from latency');
  assert.equal(summaryGroup.latencyP95Ms, 400);
  assert.equal(summaryGroup.errorRate, 0.2);
  assert.equal(summaryGroup.estimatedCostUsd, (5000 * 1 + 400 * 10) / 1_000_000);
  assert.equal(summaryGroup.promptVersions.length, 2);
  assert.equal(summary.groups.find((group) => group.model === 'unpriced')!.estimatedCostUsd, null);
  assert.deepEqual(summary.errorsByCategory, { timeout: 1 });
  assert.equal(percentile([], 50), null);
});
