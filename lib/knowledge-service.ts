import { listNotebookRowsByUser } from '../database/repositories/notebooks-repository.js';
import { listTaskRowsByUser } from '../database/repositories/tasks-repository.js';
import {
  answerAcrossKnowledgeBase,
  isLlmConfigured,
} from './llm.js';
import { getUserSettings } from './settings.js';
import { searchChunksHybrid } from './search-index.js';
import { repairPossiblyMojibakeText } from './text-encoding.js';
import { toTaskResponse, type TaskRow } from './task-types.js';
import { scoreTask } from './task-helpers.js';

export async function searchTasks(userId: string, query: string) {
  const tasks = ((await listTaskRowsByUser(userId)) as TaskRow[]).map(toTaskResponse);

  if (!query) {
    return tasks.slice(0, 20);
  }

  const userSettings = await getUserSettings(userId);
  const ranking = await searchChunksHybrid(userId, query, {
    retrievalMode: userSettings.retrievalMode,
    maxChunks: userSettings.maxKnowledgeChunks,
  });
  const rankingMap = new Map(ranking.taskRanking.map((item) => [item.taskId, item]));

  return tasks
    .map((task) => ({
      task,
      score:
        rankingMap.get(task.id)?.score ||
        scoreTask(query, task),
      snippet: rankingMap.get(task.id)?.snippet || '',
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.task.createdAt - a.task.createdAt)
    .slice(0, 20)
    .map((item) => ({
      ...item.task,
      score: item.score,
      metadata: {
        ...(item.task.metadata || {}),
        searchSnippet: item.snippet,
      },
    }));
}

export async function answerFromKnowledgeBase(
  userId: string,
  query: string,
  taskIds?: string[],
) {
  const userSettings = await getUserSettings(userId);
  if (!isLlmConfigured(userSettings)) {
    throw new Error('LLM API is not configured.');
  }

  const allTasks = ((await listTaskRowsByUser(userId)) as TaskRow[]).map(toTaskResponse);
  const selectedIds = taskIds?.length ? taskIds : [];
  const retrieval = await searchChunksHybrid(userId, query, {
    taskIds: selectedIds.length ? selectedIds : undefined,
    retrievalMode: userSettings.retrievalMode,
    maxChunks: userSettings.maxKnowledgeChunks,
  });

  const taskRanking = retrieval.taskRanking;
  const candidateTasks = (selectedIds.length
    ? allTasks.filter((task) => selectedIds.includes(task.id))
    : taskRanking
        .map((item) => allTasks.find((task) => task.id === item.taskId))
        .filter(Boolean)) as typeof allTasks;

  if (candidateTasks.length === 0) {
    throw new Error('No matching transcripts found.');
  }

  const notebooks = await listNotebookRowsByUser(userId);
  const notebookMap = new Map(notebooks.map((item) => [item.id, item.name]));
  const answer = await answerAcrossKnowledgeBase(
    query,
    candidateTasks.map((task) => ({
      title: repairPossiblyMojibakeText(task.originalName),
      transcript:
        retrieval.chunkRanking
          .filter((chunk) => chunk.taskId === task.id)
          .map((chunk) => chunk.content)
          .join('\n\n') || task.transcript || '',
      language: task.language,
      notebook: task.notebookId ? notebookMap.get(task.notebookId) || null : null,
      tags: task.tags,
    })),
    userSettings,
  );

  return {
    answer,
    sources: candidateTasks.map((task) => ({
      id: task.id,
      originalName: repairPossiblyMojibakeText(task.originalName),
      notebookName: task.notebookId ? notebookMap.get(task.notebookId) || null : null,
      tags: task.tags,
      snippet:
        retrieval.chunkRanking.find((chunk) => chunk.taskId === task.id)?.content ||
        taskRanking.find((item) => item.taskId === task.id)?.snippet ||
        '',
    })),
    retrieval: {
      mode: userSettings.retrievalMode,
      embeddings: retrieval.embeddings,
      chunkCount: retrieval.chunkRanking.length,
    },
  };
}
