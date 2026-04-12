import { v4 as uuidv4 } from 'uuid';
import { db, isSqliteDb } from '../db.js';
import { cosineSimilarity, createEmbedding, getEmbeddingsInfo, isEmbeddingsConfigured } from './embeddings.js';
import { repairPossiblyMojibakeText } from './text-encoding.js';
import { parseJsonField, type TaskRow } from './task-types.js';
import type { TranscriptSegment } from './audio-engine/types.js';
import { triggerAssociationAnalysis } from './background-analysis.js';
import { rewriteQueryForSearch, generateHydeEmbedding } from './query-enhancer.js';
import { rerankChunks } from './reranker.js';
import type { UserSettings } from './user-settings-schema.js';

type SearchChunk = {
  id: string;
  taskId: string;
  userId: string;
  workspaceId?: string | null;
  chunkIndex: number;
  content: string;
  embedding?: string | null;
  embeddingModel?: string | null;
  startTime?: number | null;
  endTime?: number | null;
  parentId?: string | null;
  createdAt: number;
  updatedAt: number;
};

const EMBEDDING_TAG_LIMIT = 5;

function toSqliteFtsQuery(query: string) {
  const tokens = query.match(/[\p{L}\p{N}]+/gu) || [];
  if (tokens.length === 0) {
    return '';
  }

  return tokens.join(' ');
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
  const chunks = (await db('task_chunks').where({ taskId })) as SearchChunk[];
  if (isSqliteDb() && chunks.length > 0) {
    for (const chunk of chunks) {
      await db.raw('DELETE FROM task_chunk_fts WHERE taskChunkId = ?', [chunk.id]);
    }
  }

  await db('task_chunks').where({ taskId }).delete();
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
        row.title,
        row.summary || '',
        row.tags || '',
        row.content,
      ],
    );
  }
}

export async function reindexTask(task: TaskRow) {
  await clearTaskIndex(task.id);

  const userId = task.userId;
  const workspaceId = task.workspaceId;
  if (!userId || !workspaceId || !task.transcript) {
    return;
  }

  const segments = parseJsonField<TranscriptSegment[]>(task.segments, []);
  const parentChunks = chunkTranscriptWithTimestamps(task.transcript, segments, PARENT_CHUNK_SIZE);
  const tags = parseJsonField<string[]>(task.tags, []);
  const embeddingTags = tags.slice(0, EMBEDDING_TAG_LIMIT).join(' ');
  const ftsTags = tags.join(' ');
  const summary = task.summary || '';
  const title = repairPossiblyMojibakeText(task.originalName);
  const now = Date.now();

  const summarySnippet = summary.length > 300 ? summary.slice(0, 297) + '...' : summary;

  for (let index = 0; index < parentChunks.length; index += 1) {
    const { content: parentContent, startTime, endTime } = parentChunks[index];

    // 1. Insert parent chunk (no embedding — used for LLM context)
    const parentId = uuidv4();
    await db('task_chunks').insert({
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

    // FTS index on parent chunk (keyword search operates on full content)
    if (isSqliteDb()) {
      await db.raw(
        'INSERT INTO task_chunk_fts (taskChunkId, taskId, userId, workspaceId, title, summary, tags, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [parentId, task.id, userId, workspaceId, title, summary, ftsTags, parentContent],
      );
    }

    // 2. Split parent into child chunks and embed each (for vector search)
    if (isEmbeddingsConfigured()) {
      const childTexts = splitIntoChildChunks(parentContent, CHILD_CHUNK_SIZE);

      for (let ci = 0; ci < childTexts.length; ci += 1) {
        const childContent = childTexts[ci];
        try {
          // Contextual embedding: title + summary + tags + child content
          const contextParts = [
            title,
            summarySnippet,
            embeddingTags,
            childContent,
          ].filter(Boolean);

          const result = await createEmbedding(contextParts.join('\n\n'));

          await db('task_chunks').insert({
            id: uuidv4(),
            taskId: task.id,
            userId,
            workspaceId,
            chunkIndex: index * 100 + ci,
            content: childContent,
            embedding: JSON.stringify(result.vector),
            embeddingModel: result.model,
            parentId,
            startTime: startTime ?? null,
            endTime: endTime ?? null,
            createdAt: now,
            updatedAt: now,
          });
        } catch (error) {
          console.error(`Failed to embed child chunk ${task.id}#${index}.${ci}`, error);
        }
      }
    }
  }

  if (userId) {
    triggerAssociationAnalysis(userId, task.id);
  }
}

export async function searchTasksByText(userId: string, workspaceId: string, query: string) {
  if (!query.trim()) {
    return [];
  }

  if (!isSqliteDb()) {
    const rows = await db('tasks')
      .where({ userId })
      .andWhere({ workspaceId })
      .andWhere((builder) => {
        builder
          .whereILike('originalName', `%${query}%`)
          .orWhereILike('summary', `%${query}%`)
          .orWhereILike('transcript', `%${query}%`);
      })
      .orderBy('createdAt', 'desc')
      .limit(20);
    return rows.map((row) => ({ taskId: row.id as string, score: 1, snippet: row.originalName as string }));
  }

  const sqliteQuery = toSqliteFtsQuery(query);
  if (!sqliteQuery) {
    return [];
  }

  const result = await db.raw(
    `SELECT taskId, -bm25(task_chunk_fts) AS score, snippet(task_chunk_fts, 7, '[', ']', '...', 12) AS snippet
     FROM task_chunk_fts
     WHERE task_chunk_fts MATCH ? AND userId = ? AND workspaceId = ?
     ORDER BY score DESC
     LIMIT 50`,
    [sqliteQuery, userId, workspaceId],
  );

  const rows = (result as Array<{ taskId: string; score: number; snippet: string }> | { rows: Array<{ taskId: string; score: number; snippet: string }> })
    && Array.isArray((result as { rows?: unknown }).rows)
    ? ((result as { rows: Array<{ taskId: string; score: number; snippet: string }> }).rows)
    : (result as Array<{ taskId: string; score: number; snippet: string }>);

  const bestByTask = new Map<string, { taskId: string; score: number; snippet: string }>();
  for (const row of rows) {
    const current = bestByTask.get(row.taskId);
    if (!current || row.score > current.score) {
      bestByTask.set(row.taskId, row);
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
  },
) {
  const maxChunks = options?.maxChunks || 8;
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
      ? searchTasksByText(userId, workspaceId, query)
      : Promise.resolve([]),
  ]);

  const enhancementMs = Date.now() - enhancementStart;

  // Use rewritten query FTS only if it differs from the original and enhancement succeeded
  const ftsResults = rewrittenQuery !== query && retrievalMode !== 'vector'
    ? await searchTasksByText(userId, workspaceId, rewrittenQuery).catch(() => baselineFtsResults)
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

    // Query only child chunks (those with embeddings) for vector search
    let chunkRowsQuery = db('task_chunks')
      .where({ userId, workspaceId })
      .whereNotNull('embedding')
      .select('id', 'taskId', 'content', 'embedding', 'startTime', 'endTime', 'parentId');

    if (allowedTaskIds?.length) {
      chunkRowsQuery = chunkRowsQuery.whereIn('taskId', allowedTaskIds);
    }

    const chunkRows = (await chunkRowsQuery) as Array<{
      id: string;
      taskId: string;
      content: string;
      embedding?: string | null;
      startTime?: number | null;
      endTime?: number | null;
      parentId?: string | null;
    }>;

    // Score child chunks by vector similarity
    const scoredChildren = chunkRows
      .map((row) => ({
        taskId: row.taskId,
        chunkId: row.id,
        content: row.content,
        score: cosineSimilarity(queryEmbedding.vector, parseJsonField<number[]>(row.embedding, [])),
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
