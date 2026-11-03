import { v4 as uuidv4 } from 'uuid';
import { db, isSqliteDb } from '../../db.js';
import { cosineSimilarity, createEmbedding, createEmbeddings, getEmbeddingsInfo, isEmbeddingsConfigured } from '../ai/embeddings.js';
import logger from '../shared/logger.js';

const log = logger.child('search-index');
import { repairPossiblyMojibakeText } from '../shared/text-encoding.js';
import { parseJsonField, type TaskRow } from '../tasks/task-types.js';
import type { TranscriptSegment } from '../audio-engine/types.js';
import { triggerAssociationAnalysis } from './background-analysis.js';
import {
  buildSnippet,
  extractSearchTerms,
  fromFtsIndexText,
  toFtsIndexText,
  toLikePattern,
  toSqliteFtsMatch,
  type SearchMatchMode,
} from './search-terms.js';
import { rewriteQueryForSearch, generateHydeEmbedding } from '../ai/query-enhancer.js';
import { rerankChunks } from '../ai/reranker.js';
import type { UserSettings } from '../settings/user-settings-schema.js';

const EMBEDDING_TAG_LIMIT = 5;

function serializeEmbedding(vector: number[]) {
  const serialized = JSON.stringify(vector);
  return isSqliteDb()
    ? { embedding: serialized }
    : { embedding: null, embeddingVector: db.raw('?::halfvec', [serialized]) };
}

function chunkTranscript(transcript: string, maxLength = 1200) {
  const cleaned = transcript.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return [];
  }

  const sentences = cleaned.split(/(?<=[.!?。！？])\s+/);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if ((current + ' ' + sentence).trim().length > maxLength && current.trim()) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = `${current} ${sentence}`.trim();
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

interface TimestampedChunk {
  content: string;
  startTime: number | null;
  endTime: number | null;
}

function chunkTranscriptWithTimestamps(
  transcript: string,
  segments: TranscriptSegment[],
  maxLength = 1200,
): TimestampedChunk[] {
  if (!segments || segments.length === 0) {
    return chunkTranscript(transcript, maxLength).map((content) => ({
      content,
      startTime: null,
      endTime: null,
    }));
  }

  const chunks: TimestampedChunk[] = [];
  let currentText = '';
  let currentStart: number | null = null;
  let currentEnd: number | null = null;

  for (const segment of segments) {
    const segText = (segment.text || '').trim();
    if (!segText) continue;

    const combined = currentText ? `${currentText} ${segText}` : segText;

    if (combined.length > maxLength && currentText) {
      chunks.push({
        content: currentText.trim(),
        startTime: currentStart,
        endTime: currentEnd,
      });
      currentText = segText;
      currentStart = segment.start;
      currentEnd = segment.end;
    } else {
      currentText = combined;
      if (currentStart === null) currentStart = segment.start;
      currentEnd = segment.end;
    }
  }

  if (currentText.trim()) {
    chunks.push({
      content: currentText.trim(),
      startTime: currentStart,
      endTime: currentEnd,
    });
  }

  return chunks;
}

const PARENT_CHUNK_SIZE = 1200;
const CHILD_CHUNK_SIZE = 300;

function splitIntoChildChunks(parentContent: string, maxLength = CHILD_CHUNK_SIZE): string[] {
  const sentences = parentContent.split(/(?<=[.!?。！？])\s+/);
  const children: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if ((current + ' ' + sentence).trim().length > maxLength && current.trim()) {
      children.push(current.trim());
      current = sentence;
    } else {
      current = `${current} ${sentence}`.trim();
    }
  }

  if (current.trim()) {
    children.push(current.trim());
  }

  // If no sentence breaks found (e.g. CJK text), split by character count
  if (children.length <= 1 && parentContent.length > maxLength) {
    children.length = 0;
    for (let i = 0; i < parentContent.length; i += maxLength) {
      children.push(parentContent.slice(i, i + maxLength).trim());
    }
  }

  return children.filter(Boolean);
}

export async function clearTaskIndex(taskId: string) {
  await db.transaction(async (trx) => {
    if (isSqliteDb()) {
      await trx.raw('DELETE FROM task_chunk_fts WHERE taskId = ?', [taskId]);
    }
    await trx('task_chunks').where({ taskId }).delete();
  });
}

export async function syncTaskWorkspaceScope(taskIds: string[], workspaceId: string) {
  const uniqueTaskIds = [...new Set(taskIds.map((taskId) => String(taskId || '').trim()).filter(Boolean))];
  if (uniqueTaskIds.length === 0) {
    return;
  }

  const now = Date.now();
  await db('task_chunks').whereIn('taskId', uniqueTaskIds).update({
    workspaceId,
    updatedAt: now,
  });

  if (!isSqliteDb()) {
    return;
  }

  const placeholders = uniqueTaskIds.map(() => '?').join(', ');
  await db.raw(`DELETE FROM task_chunk_fts WHERE taskId IN (${placeholders})`, uniqueTaskIds);

  const ftsRows = await db('task_chunks')
    .innerJoin('tasks', 'tasks.id', 'task_chunks.taskId')
    .whereNull('task_chunks.parentId')
    .whereIn('task_chunks.taskId', uniqueTaskIds)
    .select(
      'task_chunks.id as taskChunkId',
      'task_chunks.taskId as taskId',
      'task_chunks.userId as userId',
      'task_chunks.workspaceId as workspaceId',
      'tasks.originalName as title',
      'tasks.summary as summary',
      'tasks.tags as tags',
      'task_chunks.content as content',
    ) as Array<{
    taskChunkId: string;
    taskId: string;
    userId: string;
    workspaceId: string;
    title: string;
    summary: string | null;
    tags: string | null;
    content: string;
  }>;

  for (const row of ftsRows) {
    await db.raw(
      'INSERT INTO task_chunk_fts (taskChunkId, taskId, userId, workspaceId, title, summary, tags, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        row.taskChunkId,
        row.taskId,
        row.userId,
        row.workspaceId,
        toFtsIndexText(repairPossiblyMojibakeText(row.title)),
        toFtsIndexText(row.summary),
        toFtsIndexText(parseJsonField<string[]>(row.tags, []).join(' ')),
        toFtsIndexText(row.content),
      ],
    );
  }
}

function getTaskSearchContext(task: Pick<TaskRow, 'originalName' | 'summary' | 'tags'>) {
  const tags = parseJsonField<string[]>(task.tags, []);
  const summary = task.summary || '';
  return {
    title: repairPossiblyMojibakeText(task.originalName),
    summary,
    summarySnippet: summary.length > 300 ? summary.slice(0, 297) + '...' : summary,
    embeddingTags: tags.slice(0, EMBEDDING_TAG_LIMIT).join(' '),
    ftsTags: tags.join(' '),
  };
}

/**
 * Child chunks are embedded together with the recording's title, summary snippet and first tags.
 * Returns true when an edit changed that prefix, i.e. stored vectors no longer match what
 * a reindex would produce.
 */
export function hasEmbeddingContextChanged(
  previous: Pick<TaskRow, 'originalName' | 'summary' | 'tags'>,
  next: Pick<TaskRow, 'originalName' | 'summary' | 'tags'>,
) {
  const before = getTaskSearchContext(previous);
  const after = getTaskSearchContext(next);
  return before.title !== after.title
    || before.summarySnippet !== after.summarySnippet
    || before.embeddingTags !== after.embeddingTags;
}

/**
 * Cheap path for metadata edits (title, summary, tags): keyword search reads these from the
 * SQLite FTS table, so rewrite them in place without touching chunks or embeddings.
 * PostgreSQL keyword search reads the tasks table directly and needs nothing here.
 */
export async function refreshTaskSearchMetadata(task: TaskRow) {
  if (!isSqliteDb()) {
    return;
  }

  const context = getTaskSearchContext(task);
  await db.raw(
    'UPDATE task_chunk_fts SET title = ?, summary = ?, tags = ? WHERE taskId = ?',
    [toFtsIndexText(context.title), toFtsIndexText(context.summary), toFtsIndexText(context.ftsTags), task.id],
  );
}

export async function reindexTask(task: TaskRow) {
  const userId = task.userId;
  const workspaceId = task.workspaceId;
  if (!userId || !workspaceId || !task.transcript) {
    await clearTaskIndex(task.id);
    return;
  }

  const segments = parseJsonField<TranscriptSegment[]>(task.segments, []);
  const parentChunks = chunkTranscriptWithTimestamps(task.transcript, segments, PARENT_CHUNK_SIZE);
  const context = getTaskSearchContext(task);
  const now = Date.now();

  const parentRows: Array<Record<string, unknown>> = [];
  const childRows: Array<Record<string, unknown>> = [];
  const childInputs: string[] = [];

  for (let index = 0; index < parentChunks.length; index += 1) {
    const { content: parentContent, startTime, endTime } = parentChunks[index];

    // Parent chunk: no embedding, used for keyword search and LLM context.
    const parentId = uuidv4();
    parentRows.push({
      id: parentId,
      taskId: task.id,
      userId,
      workspaceId,
      chunkIndex: index,
      content: parentContent,
      embedding: null,
      embeddingModel: null,
      parentId: null,
      startTime: startTime ?? null,
      endTime: endTime ?? null,
      createdAt: now,
      updatedAt: now,
    });

    // Child chunks: embedded for vector search.
    if (isEmbeddingsConfigured()) {
      const childTexts = splitIntoChildChunks(parentContent, CHILD_CHUNK_SIZE);
      for (let ci = 0; ci < childTexts.length; ci += 1) {
        const childContent = childTexts[ci];
        // Contextual embedding: title + summary + tags + child content
        childInputs.push([context.title, context.summarySnippet, context.embeddingTags, childContent].filter(Boolean).join('\n\n'));
        childRows.push({
          id: uuidv4(),
          taskId: task.id,
          userId,
          workspaceId,
          chunkIndex: index * 100 + ci,
          content: childContent,
          parentId,
          startTime: startTime ?? null,
          endTime: endTime ?? null,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  // Embed everything before touching the stored index, so search keeps serving the
  // previous chunks while (possibly slow) embedding requests run.
  const embeddedChildRows: Array<Record<string, unknown>> = [];
  if (childInputs.length > 0) {
    const embeddings = await createEmbeddings(childInputs);
    let failed = 0;
    embeddings.forEach((result, index) => {
      if (!result) {
        failed += 1;
        return;
      }
      embeddedChildRows.push({
        ...childRows[index],
        ...serializeEmbedding(result.vector),
        embeddingModel: result.model,
      });
    });
    if (failed > 0) {
      log.error('Failed to embed child chunks', { taskId: task.id, failed, total: childInputs.length });
    }
  }

  // Swap old chunks for new ones in one transaction: no empty-index window, and two
  // reindexes of the same task cannot interleave into duplicate chunks.
  await db.transaction(async (trx) => {
    if (isSqliteDb()) {
      await trx.raw('DELETE FROM task_chunk_fts WHERE taskId = ?', [task.id]);
    }
    await trx('task_chunks').where({ taskId: task.id }).delete();

    for (const row of parentRows) {
      const children = embeddedChildRows.filter((child) => child.parentId === row.id);
      await trx('task_chunks').insert([row, ...children]);
    }

    if (isSqliteDb()) {
      for (const row of parentRows) {
        await trx.raw(
          'INSERT INTO task_chunk_fts (taskChunkId, taskId, userId, workspaceId, title, summary, tags, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [
            row.id,
            task.id,
            userId,
            workspaceId,
            toFtsIndexText(context.title),
            toFtsIndexText(context.summary),
            toFtsIndexText(context.ftsTags),
            toFtsIndexText(String(row.content)),
          ],
        );
      }
    }
  });

  triggerAssociationAnalysis(userId, task.id);
}

const REINDEX_DEBOUNCE_MS = 3000;
const scheduledReindexes = new Map<string, { timer: ReturnType<typeof setTimeout> | null; running: boolean; rerun: boolean }>();

/**
 * Rebuilds a task's chunks and embeddings in the background. Repeated calls for the same
 * task within the debounce window collapse into one run, and a call during a run queues
 * exactly one more run that reads the latest task row.
 */
export function scheduleTaskReindex(taskId: string, delayMs = REINDEX_DEBOUNCE_MS) {
  const entry = scheduledReindexes.get(taskId) || { timer: null, running: false, rerun: false };
  scheduledReindexes.set(taskId, entry);

  if (entry.running) {
    entry.rerun = true;
    return;
  }

  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    entry.timer = null;
    entry.running = true;
    void (async () => {
      try {
        const task = (await db('tasks').where({ id: taskId }).first()) as TaskRow | undefined;
        if (task?.status === 'completed' && task.transcript) {
          await reindexTask(task);
        }
      } catch (error) {
        log.error('Background reindex failed', { taskId, error: error instanceof Error ? error.message : String(error) });
      } finally {
        entry.running = false;
        if (entry.rerun) {
          entry.rerun = false;
          scheduleTaskReindex(taskId, 0);
        } else {
          scheduledReindexes.delete(taskId);
        }
      }
    })();
  }, delayMs);
  entry.timer.unref?.();
}

type KeywordHit = { taskId: string; score: number; snippet: string };

// Column weights for PostgreSQL keyword scoring: title and tags say more about a recording
// than one mention somewhere in a long transcript.
const PG_KEYWORD_COLUMNS: Array<{ column: string; weight: number }> = [
  { column: 'originalName', weight: 4 },
  { column: 'tags', weight: 3 },
  { column: 'summary', weight: 2 },
  { column: 'transcript', weight: 1 },
];

async function searchTasksByTextPostgres(
  userId: string,
  workspaceId: string,
  terms: string[],
  mode: SearchMatchMode,
): Promise<KeywordHit[]> {
  const patterns = terms.map(toLikePattern);
  const scoreParts: string[] = [];
  const scoreBindings: string[] = [];
  for (const pattern of patterns) {
    for (const { column, weight } of PG_KEYWORD_COLUMNS) {
      scoreParts.push(`(CASE WHEN "${column}" ILIKE ? THEN ${weight} ELSE 0 END)`);
      scoreBindings.push(pattern);
    }
  }

  const rows = await db('tasks')
    .where({ userId, workspaceId })
    .andWhere((builder) => {
      for (const pattern of patterns) {
        const matchesTerm = (inner: typeof builder) => {
          for (const { column } of PG_KEYWORD_COLUMNS) {
            inner.orWhereILike(column, pattern);
          }
        };
        if (mode === 'all') {
          builder.andWhere(matchesTerm);
        } else {
          builder.orWhere(matchesTerm);
        }
      }
    })
    .select('id', 'originalName', 'summary', 'transcript')
    .select(db.raw(`(${scoreParts.join(' + ')}) AS score`, scoreBindings))
    .orderBy([{ column: 'score', order: 'desc' }, { column: 'createdAt', order: 'desc' }])
    .limit(20) as Array<{ id: string; originalName: string; summary: string | null; transcript: string | null; score: number | string }>;

  return rows.map((row) => ({
    taskId: row.id,
    score: Number(row.score) || 0,
    snippet: buildSnippet(row.transcript, terms)
      || buildSnippet(row.summary, terms)
      || repairPossiblyMojibakeText(row.originalName),
  }));
}

/** Union of two keyword result lists, keeping each recording's best-scoring hit. */
export function mergeKeywordHits(primary: KeywordHit[], secondary: KeywordHit[]) {
  const byTask = new Map<string, KeywordHit>();
  for (const hit of [...primary, ...secondary]) {
    const current = byTask.get(hit.taskId);
    if (!current || hit.score > current.score) {
      byTask.set(hit.taskId, hit);
    }
  }
  return [...byTask.values()].sort((left, right) => right.score - left.score);
}

/**
 * Keyword search over recordings. See search-terms.ts for how unspaced CJK text is handled and
 * what the 'all' / 'any' modes mean.
 */
export async function searchTasksByText(
  userId: string,
  workspaceId: string,
  query: string,
  mode: SearchMatchMode = 'all',
): Promise<KeywordHit[]> {
  const terms = extractSearchTerms(query, mode);
  if (terms.length === 0) {
    return [];
  }

  if (!isSqliteDb()) {
    return searchTasksByTextPostgres(userId, workspaceId, terms, mode);
  }

  const result = await db.raw(
    `SELECT taskId, -bm25(task_chunk_fts) AS score, snippet(task_chunk_fts, 7, '[', ']', '...', 32) AS snippet
     FROM task_chunk_fts
     WHERE task_chunk_fts MATCH ? AND userId = ? AND workspaceId = ?
     ORDER BY score DESC
     LIMIT 50`,
    [toSqliteFtsMatch(terms, mode), userId, workspaceId],
  );

  const rows = (result as KeywordHit[] | { rows: KeywordHit[] })
    && Array.isArray((result as { rows?: unknown }).rows)
    ? ((result as { rows: KeywordHit[] }).rows)
    : (result as KeywordHit[]);

  const bestByTask = new Map<string, KeywordHit>();
  for (const row of rows) {
    const current = bestByTask.get(row.taskId);
    if (!current || row.score > current.score) {
      bestByTask.set(row.taskId, { ...row, snippet: fromFtsIndexText(row.snippet) });
    }
  }

  return [...bestByTask.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, 20);
}

export async function searchChunksHybrid(
  userId: string,
  workspaceId: string,
  query: string,
  options?: {
    taskIds?: string[];
    maxChunks?: number;
    retrievalMode?: 'hybrid' | 'fts' | 'vector';
    settings?: Partial<UserSettings>;
    /** Keyword matching: 'any' for questions (default), 'all' for the recording search box. */
    keywordMatch?: SearchMatchMode;
  },
) {
  const maxChunks = options?.maxChunks || 8;
  const keywordMatch = options?.keywordMatch || 'any';
  const retrievalMode = options?.retrievalMode || 'hybrid';
  const allowedTaskIds = options?.taskIds?.length ? options.taskIds : undefined;
  const ENHANCEMENT_TIMEOUT_MS = 4000;

  // Helper: race a promise against a timeout. On timeout, abort via signal and return fallback.
  function withTimeout<T>(
    fn: (signal: AbortSignal) => Promise<T>,
    fallback: T,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ENHANCEMENT_TIMEOUT_MS);
    return fn(controller.signal)
      .then((result) => { clearTimeout(timer); return result; })
      .catch(() => { clearTimeout(timer); return fallback; });
  }

  // Run baseline retrieval (original query) in parallel with LLM enhancements.
  // Enhancements have a latency budget — if they don't finish in time, the request is
  // aborted and we use the baseline.
  const enhancementStart = Date.now();

  const [rewrittenQuery, hydeResult, baselineFtsResults] = await Promise.all([
    // Enhancement: query rewrite (timeout → abort + fall back to original query)
    retrievalMode !== 'vector' && options?.settings
      ? withTimeout(
          (signal) => rewriteQueryForSearch(query, options!.settings, signal),
          query,
        )
      : Promise.resolve(query),
    // Enhancement: HyDE embedding (timeout → abort + null, use direct embedding)
    retrievalMode !== 'fts' && options?.settings
      ? withTimeout(
          (signal) => generateHydeEmbedding(query, options!.settings, signal),
          null,
        )
      : Promise.resolve(null),
    // Baseline: FTS on original query runs in parallel
    retrievalMode !== 'vector'
      ? searchTasksByText(userId, workspaceId, query, keywordMatch)
      : Promise.resolve([]),
  ]);

  const enhancementMs = Date.now() - enhancementStart;

  // The rewritten query adds recall (synonyms, keywords pulled out of a question); it must not
  // replace the original, or a poor rewrite would drop recordings the user's own words found.
  const ftsResults = rewrittenQuery !== query && retrievalMode !== 'vector'
    ? mergeKeywordHits(
      baselineFtsResults,
      await searchTasksByText(userId, workspaceId, rewrittenQuery, keywordMatch).catch(() => []),
    )
    : baselineFtsResults;

  let vectorResults: Array<{
    taskId: string;
    chunkId: string;
    content: string;
    score: number;
    startTime: number | null;
    endTime: number | null;
  }> = [];

  if (retrievalMode !== 'fts' && isEmbeddingsConfigured()) {
    // Use HyDE embedding if available, fall back to direct query embedding
    const queryEmbedding = hydeResult || await createEmbedding(query);

    let chunkRows: Array<{
      id: string;
      taskId: string;
      content: string;
      embedding?: string | null;
      score?: number;
      startTime?: number | null;
      endTime?: number | null;
      parentId?: string | null;
    }>;

    if (isSqliteDb()) {
      // SQLite has no native vector type, so retain the in-process fallback.
      let chunkRowsQuery = db('task_chunks')
        .where({ userId, workspaceId })
        .whereNotNull('embedding')
        .select('id', 'taskId', 'content', 'embedding', 'startTime', 'endTime', 'parentId');

      if (allowedTaskIds?.length) {
        chunkRowsQuery = chunkRowsQuery.whereIn('taskId', allowedTaskIds);
      }
      chunkRows = await chunkRowsQuery;
    } else {
      // PostgreSQL/pgvector performs filtering, scoring, ordering, and limiting in the database.
      const serializedQuery = JSON.stringify(queryEmbedding.vector);
      let chunkRowsQuery = db('task_chunks')
        .where({ userId, workspaceId, embeddingModel: queryEmbedding.model })
        .whereNotNull('embeddingVector')
        .select('id', 'taskId', 'content', 'startTime', 'endTime', 'parentId')
        .select(db.raw('1 - ("embeddingVector" <=> ?::halfvec) AS score', [serializedQuery]))
        .orderByRaw('"embeddingVector" <=> ?::halfvec ASC', [serializedQuery])
        .limit(maxChunks * 2);

      if (allowedTaskIds?.length) {
        chunkRowsQuery = chunkRowsQuery.whereIn('taskId', allowedTaskIds);
      }
      chunkRows = await chunkRowsQuery;
    }

    // Score child chunks by vector similarity
    const scoredChildren = chunkRows
      .map((row) => ({
        taskId: row.taskId,
        chunkId: row.id,
        content: row.content,
        score: row.score === undefined
          ? cosineSimilarity(queryEmbedding.vector, parseJsonField<number[]>(row.embedding, []))
          : Number(row.score),
        startTime: row.startTime ?? null,
        endTime: row.endTime ?? null,
        parentId: row.parentId || null,
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxChunks * 2);

    // Resolve child → parent: fetch parent content for matched children
    const parentIds = [...new Set(scoredChildren.map((c) => c.parentId).filter(Boolean))] as string[];
    const parentMap = new Map<string, { content: string; startTime: number | null; endTime: number | null }>();

    if (parentIds.length > 0) {
      const parentRows = await db('task_chunks')
        .whereIn('id', parentIds)
        .select('id', 'content', 'startTime', 'endTime') as Array<{
          id: string; content: string; startTime?: number | null; endTime?: number | null;
        }>;
      for (const p of parentRows) {
        parentMap.set(p.id, { content: p.content, startTime: p.startTime ?? null, endTime: p.endTime ?? null });
      }
    }

    // Deduplicate by parent: keep the best-scoring child per parent, use parent content
    const seenParents = new Set<string>();
    vectorResults = [];
    for (const child of scoredChildren) {
      if (child.parentId && seenParents.has(child.parentId)) continue;
      if (child.parentId) seenParents.add(child.parentId);

      const parent = child.parentId ? parentMap.get(child.parentId) : null;
      vectorResults.push({
        taskId: child.taskId,
        chunkId: child.parentId || child.chunkId,
        content: parent?.content || child.content,
        score: child.score,
        startTime: parent?.startTime ?? child.startTime,
        endTime: parent?.endTime ?? child.endTime,
      });

      if (vectorResults.length >= maxChunks * 2) break;
    }

    // LLM Rerank: only run if enhancements were fast enough (latency budget)
    // Skip rerank if the enhancement phase already consumed most of the budget
    const rerankBudgetOk = enhancementMs < ENHANCEMENT_TIMEOUT_MS * 0.8;
    if (vectorResults.length > maxChunks && rerankBudgetOk) {
      try {
        const reranked = await withTimeout(
          (signal) => rerankChunks(
            query,
            vectorResults.map((r) => ({ id: r.chunkId, content: r.content })),
            maxChunks,
            options?.settings,
            signal,
          ),
          null,
        );
        if (reranked) {
          const rerankedMap = new Map(reranked.map((r) => [r.id, r.score]));
          vectorResults = vectorResults
            .filter((r) => rerankedMap.has(r.chunkId))
            .sort((a, b) => (rerankedMap.get(b.chunkId) || 0) - (rerankedMap.get(a.chunkId) || 0))
            .slice(0, maxChunks);
        } else {
          vectorResults = vectorResults.slice(0, maxChunks);
        }
      } catch {
        vectorResults = vectorResults.slice(0, maxChunks);
      }
    } else {
      vectorResults = vectorResults.slice(0, maxChunks);
    }
  }

  const taskMap = new Map<string, { score: number; snippet: string }>();
  for (const result of ftsResults) {
    if (!allowedTaskIds || allowedTaskIds.includes(result.taskId)) {
      taskMap.set(result.taskId, {
        score: Number(result.score || 0),
        snippet: result.snippet || '',
      });
    }
  }

  for (const result of vectorResults) {
    const existing = taskMap.get(result.taskId);
    if (existing) {
      existing.score += result.score * 3;
      if (!existing.snippet) {
        existing.snippet = result.content;
      }
    } else {
      taskMap.set(result.taskId, {
        score: result.score * 3,
        snippet: result.content,
      });
    }
  }

  // Merge FTS snippets into chunkRanking for tasks that have no vector hits.
  // This ensures FTS-only matches still provide actual matched content to the LLM
  // instead of falling back to transcript prefixes.
  const vectorTaskIds = new Set(vectorResults.map((r) => r.taskId));
  const ftsOnlyChunks = ftsResults
    .filter((r) => !vectorTaskIds.has(r.taskId) && r.snippet)
    .map((r) => ({
      taskId: r.taskId,
      chunkId: `fts-${r.taskId}`,
      content: r.snippet,
      score: Number(r.score || 0),
      startTime: null as number | null,
      endTime: null as number | null,
    }));
  const mergedChunkRanking = [...vectorResults, ...ftsOnlyChunks];

  return {
    taskRanking: Array.from(taskMap.entries())
      .map(([taskId, value]) => ({ taskId, score: value.score, snippet: value.snippet }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20),
    chunkRanking: mergedChunkRanking,
    embeddings: getEmbeddingsInfo(),
  };
}
