import { v4 as uuidv4 } from 'uuid';
import logger from '../shared/logger.js';
import {
  insertTaskMessageRow,
  insertTaskMessageRows,
  listTaskMessageRows,
} from '../../database/repositories/task-messages-repository.js';

const log = logger.child('chat-service');
import {
  findTaskRowById,
  updateTaskRowForUser,
} from '../../database/repositories/tasks-repository.js';
import {
  chatWithTranscript,
  generateTaskSummary,
  isLlmConfigured,
  streamChatWithTranscript,
  type LlmMessage,
} from '../ai/llm.js';
import { getUserSettings } from '../settings/settings.js';
import {
  getDefaultSummaryPromptForNotebook,
  isSummaryPromptAvailableForNotebook,
  listSummaryPrompts,
} from './summary-prompts.js';
import { reindexTask } from '../search/search-index.js';
import {
  parseJsonField,
  toTaskResponse,
  type TaskRow,
} from './task-types.js';
import { buildTaskContext, findTaskForUser } from './task-helpers.js';

export interface ChatValidationResult {
  task: TaskRow;
  userSettings: ReturnType<typeof getUserSettings> extends Promise<infer T> ? T : never;
  history: Awaited<ReturnType<typeof listTaskMessageRows>>;
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

  const history = await listTaskMessageRows(task.id);
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

  await insertTaskMessageRows([
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

  return await listTaskMessageRows(task.id);
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
  await insertTaskMessageRow({
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

  await insertTaskMessageRow({
    id: uuidv4(),
    taskId: task.id,
    role: 'assistant',
    content: reply,
    createdAt: Date.now(),
  });

  return {
    reply,
    messages: await listTaskMessageRows(task.id),
  };
}

/** Sentinel value stored in the summary column while generation is in progress. */
export const SUMMARY_GENERATING_SENTINEL = '__generating__';

type SummaryGenerationStatus = 'generating' | 'failed';

function getTaskMetadata(task: Pick<TaskRow, 'metadata'>) {
  return parseJsonField<Record<string, unknown>>(task.metadata, {});
}

export function buildSummaryGenerationMetadata(
  task: Pick<TaskRow, 'metadata'>,
  options: {
    status?: SummaryGenerationStatus | null;
    error?: string | null;
    requestId?: string | null;
  },
) {
  const metadata = {
    ...getTaskMetadata(task),
  };

  if (options.status) {
    metadata.summaryGenerationStatus = options.status;
  } else {
    delete metadata.summaryGenerationStatus;
  }

  if (options.error) {
    metadata.summaryGenerationError = options.error;
  } else {
    delete metadata.summaryGenerationError;
  }

  if (options.requestId) {
    metadata.summaryGenerationRequestId = options.requestId;
  } else {
    delete metadata.summaryGenerationRequestId;
  }

  return JSON.stringify(metadata);
}

export function getSummaryGenerationRequestId(task: Pick<TaskRow, 'metadata'>) {
  const requestId = getTaskMetadata(task).summaryGenerationRequestId;
  return typeof requestId === 'string' && requestId.trim() ? requestId : null;
}

export function normalizeSummaryGenerationError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return 'Summary generation failed. Please try again.';
}

/**
 * Validates inputs synchronously, marks the task as "generating", then runs
 * the LLM call in the background. Returns immediately so the frontend is not
 * blocked by a long-running request.
 */
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

  const previousSummary = task.summary ?? null;
  const generationRequestId = uuidv4();

  // Persist previousSummary in metadata so cancel can restore it
  const metadataWithPrevious = {
    ...parseJsonField<Record<string, unknown>>(task.metadata, {}),
    summaryPreviousValue: previousSummary,
  };

  // Mark as generating so the frontend can show a spinner
  await updateTaskRowForUser(userId, task.id, {
    summary: SUMMARY_GENERATING_SENTINEL,
    metadata: buildSummaryGenerationMetadata(
      { metadata: JSON.stringify(metadataWithPrevious) },
      {
        status: 'generating',
        error: null,
        requestId: generationRequestId,
      },
    ),
    updatedAt: Date.now(),
  });

  // Run LLM call in the background — do NOT await
  void (async () => {
    try {
      const summary = await generateTaskSummary(
        buildTaskContext(task),
        options.instructions,
        userSettings,
        resolvedPrompt,
      );
      const latest = await findTaskRowById(task.id);
      if (
        !latest
        || latest.summary !== SUMMARY_GENERATING_SENTINEL
        || getSummaryGenerationRequestId(latest) !== generationRequestId
      ) {
        return;
      }

      const successMetadata = parseJsonField<Record<string, unknown>>(latest.metadata, {});
      delete successMetadata.summaryPreviousValue;
      await updateTaskRowForUser(userId, task.id, {
        summary,
        metadata: buildSummaryGenerationMetadata(
          { metadata: JSON.stringify(successMetadata) },
          { status: null, error: null, requestId: null },
        ),
        updatedAt: Date.now(),
      });
      const updated = (await findTaskRowById(task.id)) as TaskRow;
      await reindexTask(updated);
    } catch (error) {
      log.error('Background summary generation failed', { taskId: task.id, error: error instanceof Error ? error.message : String(error) });
      const latest = await findTaskRowById(task.id);
      if (
        !latest
        || latest.summary !== SUMMARY_GENERATING_SENTINEL
        || getSummaryGenerationRequestId(latest) !== generationRequestId
      ) {
        return;
      }

      // Restore the last good summary and persist the failure for the UI.
      const failMetadata = parseJsonField<Record<string, unknown>>(latest.metadata, {});
      delete failMetadata.summaryPreviousValue;
      await updateTaskRowForUser(userId, task.id, {
        summary: previousSummary,
        metadata: buildSummaryGenerationMetadata(
          { metadata: JSON.stringify(failMetadata) },
          { status: 'failed', error: normalizeSummaryGenerationError(error), requestId: null },
        ),
        updatedAt: Date.now(),
      }).catch(() => {});
    }
  })();

  // Return immediately with the generating state
  const current = (await findTaskRowById(task.id)) as TaskRow;
  return toTaskResponse(current);
}

export async function handleCancelSummary(userId: string, taskId: string) {
  const task = await findTaskForUser(userId, taskId);
  if (!task) {
    throw new TaskNotFoundError();
  }

  // Only cancel if actually generating
  if (task.summary !== SUMMARY_GENERATING_SENTINEL) {
    return toTaskResponse(task);
  }

  // Restore previous summary from metadata
  const metadata = parseJsonField<Record<string, unknown>>(task.metadata, {});
  const previousSummary = typeof metadata.summaryPreviousValue === 'string'
    ? metadata.summaryPreviousValue
    : null;
  delete metadata.summaryPreviousValue;

  await updateTaskRowForUser(userId, task.id, {
    summary: previousSummary,
    metadata: buildSummaryGenerationMetadata(
      { metadata: JSON.stringify(metadata) },
      { status: null, error: null, requestId: null },
    ),
    updatedAt: Date.now(),
  });

  const updated = (await findTaskRowById(task.id)) as TaskRow;
  await reindexTask(updated);
  return toTaskResponse(updated);
}
