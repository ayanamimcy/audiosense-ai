import { v4 as uuidv4 } from 'uuid';
import { db } from '../db.js';
import { listTaskRowsByUser } from '../database/repositories/tasks-repository.js';
import { cosineSimilarity } from './embeddings.js';
import { parseJsonField, type TaskRow } from './task-types.js';
import { repairPossiblyMojibakeText } from './text-encoding.js';

const SIMILARITY_THRESHOLD = 0.65;

/** Canonical pair: always store smaller ID as taskIdA */
function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function getTaskAverageEmbedding(taskId: string): Promise<number[] | null> {
  const chunks = await db('task_chunks')
    .where({ taskId })
    .whereNotNull('embedding')
    .select('embedding');

  if (chunks.length === 0) return null;

  const vectors = chunks
    .map((row: { embedding: string }) => parseJsonField<number[]>(row.embedding, []))
    .filter((v: number[]) => v.length > 0);

  if (vectors.length === 0) return null;

  const dim = vectors[0].length;
  const avg = new Array(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) {
      avg[i] += vec[i] / vectors.length;
    }
  }

  return avg;
}

export async function computeTaskAssociations(userId: string) {
  const tasks = (await listTaskRowsByUser(userId) as TaskRow[])
    .filter((t) => t.status === 'completed' && t.transcript);

  const embeddings = new Map<string, number[]>();
  for (const task of tasks) {
    const avg = await getTaskAverageEmbedding(task.id);
    if (avg) embeddings.set(task.id, avg);
  }

  const taskIds = [...embeddings.keys()];
  if (taskIds.length < 2) return;

  const now = Date.now();
  const rows: Array<{ id: string; userId: string; taskIdA: string; taskIdB: string; score: number; createdAt: number }> = [];

  for (let i = 0; i < taskIds.length; i++) {
    for (let j = i + 1; j < taskIds.length; j++) {
      const score = cosineSimilarity(embeddings.get(taskIds[i])!, embeddings.get(taskIds[j])!);
      if (score >= SIMILARITY_THRESHOLD) {
        const [a, b] = canonicalPair(taskIds[i], taskIds[j]);
        rows.push({ id: uuidv4(), userId, taskIdA: a, taskIdB: b, score, createdAt: now });
      }
    }
  }

  // Atomic: delete all + insert all in a single transaction
  await db.transaction(async (trx) => {
    await trx('task_associations').where({ userId }).delete();
    for (let i = 0; i < rows.length; i += 50) {
      await trx('task_associations').insert(rows.slice(i, i + 50));
    }
  });

  return { computed: taskIds.length, associations: rows.length };
}

export async function computeAssociationsForTask(userId: string, taskId: string) {
  const taskEmbedding = await getTaskAverageEmbedding(taskId);
  if (!taskEmbedding) return;

  const otherChunks = await db('task_chunks')
    .where({ userId })
    .whereNot({ taskId })
    .whereNotNull('embedding')
    .select('taskId', 'embedding');

  const taskVectors = new Map<string, number[][]>();
  for (const row of otherChunks) {
    const vec = parseJsonField<number[]>(row.embedding, []);
    if (vec.length === 0) continue;
    const existing = taskVectors.get(row.taskId) || [];
    existing.push(vec);
    taskVectors.set(row.taskId, existing);
  }

  const now = Date.now();
  const newRows: Array<{ id: string; userId: string; taskIdA: string; taskIdB: string; score: number; createdAt: number }> = [];

  for (const [otherTaskId, vectors] of taskVectors) {
    const dim = vectors[0].length;
    const avg = new Array(dim).fill(0);
    for (const vec of vectors) {
      for (let i = 0; i < dim; i++) {
        avg[i] += vec[i] / vectors.length;
      }
    }

    const score = cosineSimilarity(taskEmbedding, avg);
    if (score >= SIMILARITY_THRESHOLD) {
      const [a, b] = canonicalPair(taskId, otherTaskId);
      newRows.push({ id: uuidv4(), userId, taskIdA: a, taskIdB: b, score, createdAt: now });
    }
  }

  // Atomic: delete old associations for this task + insert new ones
  await db.transaction(async (trx) => {
    await trx('task_associations')
      .where({ userId })
      .andWhere(function () {
        this.where({ taskIdA: taskId }).orWhere({ taskIdB: taskId });
      })
      .delete();

    if (newRows.length > 0) {
      for (let i = 0; i < newRows.length; i += 50) {
        await trx('task_associations')
          .insert(newRows.slice(i, i + 50))
          .onConflict(['userId', 'taskIdA', 'taskIdB'])
          .ignore();
      }
    }
  });
}

export async function getRelatedTasks(userId: string, taskId: string, limit = 5) {
  const associations = await db('task_associations')
    .where({ userId })
    .andWhere(function () {
      this.where({ taskIdA: taskId }).orWhere({ taskIdB: taskId });
    })
    .orderBy('score', 'desc')
    .limit(limit) as Array<{ taskIdA: string; taskIdB: string; score: number }>;

  const relatedIds = associations.map((a) =>
    a.taskIdA === taskId ? a.taskIdB : a.taskIdA,
  );

  if (relatedIds.length === 0) return [];

  const tasks = await db('tasks').whereIn('id', relatedIds) as TaskRow[];
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  return associations
    .map((a) => {
      const relatedId = a.taskIdA === taskId ? a.taskIdB : a.taskIdA;
      const task = taskMap.get(relatedId);
      if (!task) return null;
      return {
        id: task.id,
        originalName: repairPossiblyMojibakeText(task.originalName),
        tags: parseJsonField<string[]>(task.tags, []),
        notebookId: task.notebookId,
        score: a.score,
      };
    })
    .filter(Boolean);
}
