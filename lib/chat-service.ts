import { v4 as uuidv4 } from 'uuid';
import { db } from '../db.js';
import {
  chatWithTranscript,
  generateTaskSummary,
  isLlmConfigured,
  streamChatWithTranscript,
  type LlmMessage,
} from './llm.js';
import { getUserSettings } from './settings.js';
import {
  getDefaultSummaryPromptForNotebook,
  isSummaryPromptAvailableForNotebook,
  listSummaryPrompts,
} from './summary-prompts.js';
import { reindexTask } from './search-index.js';
import {
  toTaskResponse,
  type TaskMessageRow,
  type TaskRow,
} from './task-types.js';
import { buildTaskContext, findTaskForUser } from './task-helpers.js';

export interface ChatValidationResult {
  task: TaskRow;
  userSettings: ReturnType<typeof getUserSettings> extends Promise<infer T> ? T : never;
  history: TaskMessageRow[];
  normalizedHistory: LlmMessage[];
}

export class TaskNotFoundError extends Error {
  constructor() { super('Task not found.'); }
}

export class TranscriptNotReadyError extends Error {
  constructor() { super('Task transcript is not ready yet.'); }
}

export class LlmNotConfiguredError extends Error {
  constructor() { super('LLM API is not configured.'); }
}

export class SummaryPromptNotFoundError extends Error {
  constructor() { super('Selected Summary Prompt not found.'); }
}

export class SummaryPromptNotAvailableError extends Error {
  constructor() { super('Selected Summary Prompt is not available for this notebook.'); }
}

async function validateChatPrerequisites(userId: string, taskId: string) {
  const task = await findTaskForUser(userId, taskId);
  if (!task) {
    throw new TaskNotFoundError();
  }
  if (!task.transcript) {
    throw new TranscriptNotReadyError();
  }
  const userSettings = await getUserSettings(userId);
  if (!isLlmConfigured(userSettings)) {
    throw new LlmNotConfiguredError();
  }

  const history = (await db('task_messages')
    .where({ taskId: task.id })
    .orderBy('createdAt', 'asc')) as TaskMessageRow[];
  const normalizedHistory: LlmMessage[] = history.map((item) => ({
    role: item.role,
    content: item.content,
  }));

  return { task, userSettings, history, normalizedHistory };
}

export async function handleChatMessage(userId: string, taskId: string, message: string) {
  const { task, userSettings, normalizedHistory } = await validateChatPrerequisites(userId, taskId);

  const reply = await chatWithTranscript(
    buildTaskContext(task),
    normalizedHistory,
    message,
    userSettings,
  );
  const now = Date.now();

  await db('task_messages').insert([
    {
      id: uuidv4(),
      taskId: task.id,
      role: 'user',
      content: message,
      createdAt: now,
    },
    {
      id: uuidv4(),
      taskId: task.id,
      role: 'assistant',
      content: reply,
      createdAt: now + 1,
    },
  ]);

  return (await db('task_messages')
    .where({ taskId: task.id })
    .orderBy('createdAt', 'asc')) as TaskMessageRow[];
}

export async function handleStreamChat(
  userId: string,
  taskId: string,
  message: string,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
) {
  const { task, userSettings, normalizedHistory } = await validateChatPrerequisites(userId, taskId);

  const userMsgTs = Date.now();
  await db('task_messages').insert({
    id: uuidv4(),
    taskId: task.id,
    role: 'user',
    content: message,
    createdAt: userMsgTs,
  });

  const reply = await streamChatWithTranscript(
    buildTaskContext(task),
    normalizedHistory,
    message,
    userSettings,
    onDelta,
    signal,
  );

  await db('task_messages').insert({
    id: uuidv4(),
    taskId: task.id,
    role: 'assistant',
    content: reply,
    createdAt: Date.now(),
  });

  return {
    reply,
    messages: (await db('task_messages')
      .where({ taskId: task.id })
      .orderBy('createdAt', 'asc')) as TaskMessageRow[],
  };
}

export async function handleGenerateSummary(
  userId: string,
  taskId: string,
  options: {
    summaryPromptId?: string | null;
    skipConfiguredPrompt?: boolean;
    instructions?: string;
  },
) {
  const task = await findTaskForUser(userId, taskId);
  if (!task) {
    throw new TaskNotFoundError();
  }
  if (!task.transcript) {
    throw new TranscriptNotReadyError();
  }
  const userSettings = await getUserSettings(userId);
  if (!isLlmConfigured(userSettings)) {
    throw new LlmNotConfiguredError();
  }

  const summaryPrompts = await listSummaryPrompts(userId);
  let resolvedPrompt: string | null = null;

  if (options.summaryPromptId) {
    const selectedPrompt = summaryPrompts.find((item) => item.id === options.summaryPromptId);
    if (!selectedPrompt) {
      throw new SummaryPromptNotFoundError();
    }
    if (!isSummaryPromptAvailableForNotebook(selectedPrompt, task.notebookId)) {
      throw new SummaryPromptNotAvailableError();
    }
    resolvedPrompt = selectedPrompt.prompt;
  } else if (!options.skipConfiguredPrompt) {
    resolvedPrompt = getDefaultSummaryPromptForNotebook(summaryPrompts, task.notebookId)?.prompt || null;
  }

  const summary = await generateTaskSummary(
    buildTaskContext(task),
    options.instructions,
    userSettings,
    resolvedPrompt,
  );
  await db('tasks').where({ id: task.id, userId }).update({
    summary,
    updatedAt: Date.now(),
  });
  const updated = (await db('tasks').where({ id: task.id }).first()) as TaskRow;
  await reindexTask(updated);
  return toTaskResponse(updated);
}
