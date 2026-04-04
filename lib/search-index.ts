import { v4 as uuidv4 } from 'uuid';
import { db, isSqliteDb } from '../db.js';
import { cosineSimilarity, createEmbedding, getEmbeddingsInfo, isEmbeddingsConfigured } from './embeddings.js';
import { repairPossiblyMojibakeText } from './text-encoding.js';
import { parseJsonField, type TaskRow } from './task-types.js';

type SearchChunk = {
  id: string;
  taskId: string;
  userId: string;
  chunkIndex: number;
  content: string;
  embedding?: string | null;
  embeddingModel?: string | null;
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

export async function clearTaskIndex(taskId: string) {
  const chunks = (await db('task_chunks').where({ taskId })) as SearchChunk[];
  if (isSqliteDb() && chunks.length > 0) {
    for (const chunk of chunks) {
      await db.raw('DELETE FROM task_chunk_fts WHERE taskChunkId = ?', [chunk.id]);
    }
  }

  await db('task_chunks').where({ taskId }).delete();
}

export async function reindexTask(task: TaskRow) {
  await clearTaskIndex(task.id);

  const userId = task.userId;
  if (!userId || !task.transcript) {
    return;
  }

  const chunks = chunkTranscript(task.transcript);
  const tags = parseJsonField<string[]>(task.tags, []);
  const embeddingTags = tags.slice(0, EMBEDDING_TAG_LIMIT).join(' ');
  const ftsTags = tags.join(' ');
  const summary = task.summary || '';
  const title = repairPossiblyMojibakeText(task.originalName);
  const now = Date.now();

  for (let index = 0; index < chunks.length; index += 1) {
    const content = chunks[index];
    let embedding: number[] | null = null;
    let embeddingModel: string | null = null;

    if (isEmbeddingsConfigured()) {
      try {
        const result = await createEmbedding(
          [title, embeddingTags, content].filter(Boolean).join('\n\n'),
        );
        embedding = result.vector;
        embeddingModel = result.model;
      } catch (error) {
        console.error(`Failed to embed task chunk ${task.id}#${index}`, error);
      }
    }

    const row = {
      id: uuidv4(),
      taskId: task.id,
      userId,
      chunkIndex: index,
      content,
      embedding: embedding ? JSON.stringify(embedding) : null,
      embeddingModel,
      createdAt: now,
      updatedAt: now,
    };

    await db('task_chunks').insert(row);

    if (isSqliteDb()) {
      await db.raw(
        'INSERT INTO task_chunk_fts (taskChunkId, taskId, userId, title, summary, tags, content) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [row.id, task.id, userId, title, summary, ftsTags, content],
      );
    }
  }
}

export async function searchTasksByText(userId: string, query: string) {
  if (!query.trim()) {
    return [];
  }

  if (!isSqliteDb()) {
    const rows = await db('tasks')
      .where({ userId })
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
    `SELECT taskId, -bm25(task_chunk_fts) AS score, snippet(task_chunk_fts, 6, '[', ']', '...', 12) AS snippet
     FROM task_chunk_fts
     WHERE task_chunk_fts MATCH ? AND userId = ?
     ORDER BY score DESC
     LIMIT 50`,
    [sqliteQuery, userId],
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
  query: string,
  options?: {
    taskIds?: string[];
    maxChunks?: number;
    retrievalMode?: 'hybrid' | 'fts' | 'vector';
  },
) {
  const maxChunks = options?.maxChunks || 8;
  const retrievalMode = options?.retrievalMode || 'hybrid';
  const ftsResults =
    retrievalMode === 'vector'
      ? []
      : await searchTasksByText(userId, query);

  const ftsTaskIds = ftsResults.map((item) => item.taskId);
  const allowedTaskIds = options?.taskIds?.length ? options.taskIds : undefined;

  let vectorResults: Array<{
    taskId: string;
    chunkId: string;
    content: string;
    score: number;
  }> = [];

  if (retrievalMode !== 'fts' && isEmbeddingsConfigured()) {
    const queryEmbedding = await createEmbedding(query);
    let chunkRowsQuery = db('task_chunks')
      .where({ userId })
      .select('id', 'taskId', 'content', 'embedding');

    if (allowedTaskIds?.length) {
      chunkRowsQuery = chunkRowsQuery.whereIn('taskId', allowedTaskIds);
    }

    const chunkRows = (await chunkRowsQuery) as Array<{
      id: string;
      taskId: string;
      content: string;
      embedding?: string | null;
    }>;

    vectorResults = chunkRows
      .map((row) => ({
        taskId: row.taskId,
        chunkId: row.id,
        content: row.content,
        score: cosineSimilarity(queryEmbedding.vector, parseJsonField<number[]>(row.embedding, [])),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxChunks);
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

  return {
    taskRanking: Array.from(taskMap.entries())
      .map(([taskId, value]) => ({ taskId, score: value.score, snippet: value.snippet }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20),
    chunkRanking: vectorResults,
    embeddings: getEmbeddingsInfo(),
  };
}
