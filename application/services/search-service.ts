import { answerFromKnowledgeBase, searchTasks } from '../../lib/knowledge-service.js';
import { isLlmConfigured } from '../../lib/llm.js';
import { getUserSettings } from '../../lib/settings.js';
import { resolveCurrentWorkspaceForUser } from '../../lib/workspaces.js';

export class KnowledgeQueryRequiredError extends Error {
  constructor() {
    super('Query is required.');
  }
}

export class KnowledgeLlmNotConfiguredError extends Error {
  constructor() {
    super('LLM API is not configured.');
  }
}

export class KnowledgeNoMatchesError extends Error {
  constructor() {
    super('No matching transcripts found.');
  }
}

export async function searchTasksForUser(userId: string, query: string) {
  const { currentWorkspaceId } = await resolveCurrentWorkspaceForUser(userId);
  return searchTasks(userId, currentWorkspaceId, query.trim());
}

export async function answerKnowledgeForUser(
  userId: string,
  query: string,
  taskIds?: string[],
) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    throw new KnowledgeQueryRequiredError();
  }

  const userSettings = await getUserSettings(userId);
  if (!isLlmConfigured(userSettings)) {
    throw new KnowledgeLlmNotConfiguredError();
  }

  try {
    const { currentWorkspaceId } = await resolveCurrentWorkspaceForUser(userId);
    return await answerFromKnowledgeBase(
      userId,
      currentWorkspaceId,
      normalizedQuery,
      taskIds?.length ? taskIds : undefined,
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'No matching transcripts found.') {
      throw new KnowledgeNoMatchesError();
    }
    throw error;
  }
}
