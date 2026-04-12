import { listNotebookRowsByUserAndWorkspace } from '../database/repositories/notebooks-repository.js';
import { listTaskRowsByUserAndWorkspace } from '../database/repositories/tasks-repository.js';
import {
  answerAcrossKnowledgeBase,
  isLlmConfigured,
} from './llm.js';
import { getUserSettings } from './settings.js';
import { searchChunksHybrid } from './search-index.js';
import { repairPossiblyMojibakeText } from './text-encoding.js';
import { toTaskResponse, type TaskRow } from './task-types.js';
import { scoreTask } from './task-helpers.js';

export async function searchTasks(userId: string, workspaceId: string, query: string) {
  const tasks = ((await listTaskRowsByUserAndWorkspace(userId, workspaceId)) as TaskRow[]).map(
    toTaskResponse,
  );

  if (!query) {
    return tasks.slice(0, 20);
  }

  const userSettings = await getUserSettings(userId);
  const ranking = await searchChunksHybrid(userId, workspaceId, query, {
    retrievalMode: userSettings.retrievalMode,
    maxChunks: userSettings.maxKnowledgeChunks,
    settings: userSettings,
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
  workspaceId: string,
  query: string,
  taskIds?: string[],
) {
  const userSettings = await getUserSettings(userId);
  if (!isLlmConfigured(userSettings)) {
    throw new Error('LLM API is not configured.');
  }

  const allTasks = ((await listTaskRowsByUserAndWorkspace(userId, workspaceId)) as TaskRow[]).map(
    toTaskResponse,
  );
  const selectedIds = taskIds?.length ? taskIds : [];
  const allowedTaskIds = selectedIds.length
    ? selectedIds.filter((id) => allTasks.some((task) => task.id === id))
    : undefined;
  if (selectedIds.length > 0 && (!allowedTaskIds || allowedTaskIds.length === 0)) {
    throw new Error('No matching transcripts found.');
  }
  const retrieval = await searchChunksHybrid(userId, workspaceId, query, {
    taskIds: allowedTaskIds,
    retrievalMode: userSettings.retrievalMode,
    maxChunks: userSettings.maxKnowledgeChunks,
    settings: userSettings,
  });

  const MAX_SOURCE_TASKS = 8;
  const taskRanking = retrieval.taskRanking;
  const candidateTasks = taskRanking
    .map((item) => allTasks.find((task) => task.id === item.taskId))
    .filter(Boolean)
    .slice(0, MAX_SOURCE_TASKS) as typeof allTasks;

  if (candidateTasks.length === 0) {
    throw new Error('No matching transcripts found.');
  }

  const notebooks = await listNotebookRowsByUserAndWorkspace(userId, workspaceId);
  const notebookMap = new Map(notebooks.map((item) => [item.id, item.name]));
  const answer = await answerAcrossKnowledgeBase(
    query,
    candidateTasks.map((task) => {
      const taskChunks = retrieval.chunkRanking.filter((chunk) => chunk.taskId === task.id);
      const chunkContent = taskChunks.map((chunk) => chunk.content).join('\n\n');
      return {
        title: repairPossiblyMojibakeText(task.originalName),
        transcript: chunkContent || task.transcript?.slice(0, 2000) || '',
        language: task.language,
        notebook: task.notebookId ? notebookMap.get(task.notebookId) || null : null,
        tags: task.tags,
        chunks: taskChunks.map((chunk) => ({
          content: chunk.content,
          startTime: chunk.startTime ?? null,
          endTime: chunk.endTime ?? null,
        })),
      };
    }),
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
