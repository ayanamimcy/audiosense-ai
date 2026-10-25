/**
 * Retrieval quality for search and Ask AI: does the right recording (and the right moment
 * in it) come back for a question?
 *
 *   npm run eval:retrieval -- --email you@example.com [--workspace name] [--questions path] [--modes fts,vector,hybrid] [--enhance]
 *
 * Reads a JSONL question set (one per line):
 *   {"id": "q1", "question": "アップロードの再試行はいつ対応する？",
 *    "relevant": [{"task": "<task id or exact recording title>", "start": 748, "end": 800}]}
 * `start`/`end` (seconds) are optional; with them the timestamp hit rate is also scored.
 *
 * Runs against the database configured in .env (read-only queries; vector mode calls the
 * embeddings API). Without --enhance, LLM query rewriting and HyDE are off so modes are
 * compared on retrieval alone; with it, the run matches what Ask AI does in the app.
 */
import fs from 'fs';
import path from 'path';
import { db } from '../db.js';
import { searchChunksHybrid } from '../lib/search/search-index.js';
import { getUserSettings } from '../lib/settings/settings.js';
import { mean, rangesOverlap, recallAtK, reciprocalRank } from '../lib/evaluation/metrics.js';

type Mode = 'fts' | 'vector' | 'hybrid';

interface Question {
  id: string;
  question: string;
  relevant: { task: string; start?: number; end?: number }[];
}

function readArg(name: string, fallback?: string) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value && !value.startsWith('--')) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing --${name}`);
}

const root = path.dirname(new URL(import.meta.url).pathname);
const email = readArg('email');
const questionsPath = path.resolve(readArg('questions', path.join(root, 'datasets/retrieval/questions.jsonl')));
const modes = readArg('modes', 'fts,vector,hybrid').split(',') as Mode[];
const ks = readArg('k', '1,3,5').split(',').map(Number);
const enhance = process.argv.includes('--enhance');
const label = readArg('label', enhance ? 'enhanced' : 'baseline');
const TIMESTAMP_TOLERANCE_SEC = 15;

const user = await db('users').where({ email }).first();
if (!user) throw new Error(`No user with email ${email}`);
const settings = await getUserSettings(user.id);
const workspaceName = readArg('workspace', '');
const workspaces = await db('workspaces').where({ userId: user.id });
const workspace = workspaceName
  ? workspaces.find((item) => item.name === workspaceName)
  : workspaces.find((item) => item.id === settings.currentWorkspaceId) || workspaces[0];
if (!workspace) throw new Error(workspaceName ? `No workspace named "${workspaceName}"` : 'User has no workspace');
const tasks = await db('tasks').where({ userId: user.id, workspaceId: workspace.id }).select('id', 'originalName');
const taskIdByKey = new Map<string, string>();
for (const task of tasks) {
  taskIdByKey.set(task.id, task.id);
  taskIdByKey.set(task.originalName, task.id);
}

const questions = fs.readFileSync(questionsPath, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('//'))
  .map((line) => JSON.parse(line) as Question);

const unresolved = questions.flatMap((q) => q.relevant.filter((r) => !taskIdByKey.has(r.task)).map((r) => `${q.id}: ${r.task}`));
if (unresolved.length) {
  throw new Error(`Relevant recordings not found in workspace "${workspace.name}":\n  ${unresolved.join('\n  ')}`);
}

const report: Record<string, unknown> = {
  label,
  createdAt: new Date().toISOString(),
  workspace: workspace.name,
  questions: questions.length,
  enhance,
  modes: {},
};

for (const mode of modes) {
  const perQuestion = [];
  for (const question of questions) {
    const relevantIds = new Set(question.relevant.map((r) => taskIdByKey.get(r.task)!));
    const startedAt = Date.now();
    const retrieval = await searchChunksHybrid(user.id, workspace.id, question.question, {
      retrievalMode: mode,
      maxChunks: Math.max(...ks),
      settings: enhance ? settings : undefined,
    });
    const latencyMs = Date.now() - startedAt;
    const rankedTasks = retrieval.taskRanking.map((item) => item.taskId);

    const timed = question.relevant.filter((r) => r.start != null && r.end != null);
    const timestampHitAtK = Object.fromEntries(ks.map((k) => {
      if (!timed.length) return [k, null];
      const top = retrieval.chunkRanking.slice(0, k);
      const hit = timed.some((r) => top.some((chunk) => (
        chunk.taskId === taskIdByKey.get(r.task)
        && chunk.startTime != null && chunk.endTime != null
        && rangesOverlap({ start: chunk.startTime, end: chunk.endTime }, { start: r.start!, end: r.end! }, TIMESTAMP_TOLERANCE_SEC)
      )));
      return [k, hit ? 1 : 0];
    }));

    perQuestion.push({
      id: question.id,
      latencyMs,
      recallAtK: Object.fromEntries(ks.map((k) => [k, recallAtK(rankedTasks, relevantIds, k)])),
      reciprocalRank: reciprocalRank(rankedTasks, relevantIds),
      timestampHitAtK,
      top: rankedTasks.slice(0, Math.max(...ks)),
    });
  }

  const summary = {
    recallAtK: Object.fromEntries(ks.map((k) => [k, mean(perQuestion.map((q) => q.recallAtK[k]))])),
    mrr: mean(perQuestion.map((q) => q.reciprocalRank)),
    timestampHitAtK: Object.fromEntries(ks.map((k) => {
      const values = perQuestion.map((q) => q.timestampHitAtK[k]).filter((v): v is number => v != null);
      return [k, values.length ? mean(values) : null];
    })),
    meanLatencyMs: mean(perQuestion.map((q) => q.latencyMs)),
  };
  (report.modes as Record<string, unknown>)[mode] = { summary, perQuestion };

  const pct = (value: number | null) => (value == null ? '  —  ' : `${(value * 100).toFixed(0).padStart(3)}%`);
  console.log(
    `${mode.padEnd(7)} ${ks.map((k) => `R@${k} ${pct(summary.recallAtK[k])}`).join('  ')}  MRR ${summary.mrr.toFixed(2)}  ` +
    `${ks.map((k) => `TS@${k} ${pct(summary.timestampHitAtK[k])}`).join('  ')}  ${Math.round(summary.meanLatencyMs)}ms`,
  );
}

const outDir = path.join(root, 'results/retrieval');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${label}.json`);
fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n${questions.length} questions · R@k = share of relevant recordings in the top k · TS@k = right moment (±${TIMESTAMP_TOLERANCE_SEC}s) in the top k passages`);
console.log(`Wrote ${path.relative(process.cwd(), outFile)}`);
await db.destroy();
