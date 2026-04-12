import {
  listConversationsByUserAndWorkspace,
  findConversationById,
  deleteConversation,
  updateConversation,
  listMessagesByConversation,
} from '../../database/repositories/knowledge-conversations-repository.js';
import { listNotebookRowsByUserAndWorkspace } from '../../database/repositories/notebooks-repository.js';
import { listTaskRowsByUserAndWorkspace } from '../../database/repositories/tasks-repository.js';
import { streamKnowledgeChatMessage, type MentionRef } from '../../lib/knowledge-chat-service.js';
import { isLlmConfigured } from '../../lib/llm.js';
import { getUserSettings } from '../../lib/settings.js';
import type { TaskRow } from '../../lib/task-types.js';
import { repairPossiblyMojibakeText } from '../../lib/text-encoding.js';
import { resolveCurrentWorkspaceForUser } from '../../lib/workspaces.js';

export class ConversationNotFoundError extends Error {
  constructor() { super('Conversation not found.'); }
}

export class LlmNotConfiguredError extends Error {
  constructor() { super('LLM API is not configured.'); }
}

export class MessageRequiredError extends Error {
  constructor() { super('Message is required.'); }
}

export async function listConversationsForUser(userId: string) {
  const { currentWorkspaceId } = await resolveCurrentWorkspaceForUser(userId);
  return listConversationsByUserAndWorkspace(userId, currentWorkspaceId);
}

export async function getConversationMessages(userId: string, conversationId: string) {
  const { currentWorkspaceId } = await resolveCurrentWorkspaceForUser(userId);
  const conversation = await findConversationById(conversationId);
  if (
    !conversation ||
    conversation.userId !== userId ||
    conversation.workspaceId !== currentWorkspaceId
  ) {
    throw new ConversationNotFoundError();
  }

  const messages = await listMessagesByConversation(conversationId);
  return {
    conversation,
    messages: messages.map((m) => ({
      ...m,
      mentions: m.mentions ? JSON.parse(m.mentions) : [],
      metadata: m.metadata ? JSON.parse(m.metadata) : null,
    })),
  };
}

export async function renameConversationForUser(userId: string, conversationId: string, title: string) {
  const { currentWorkspaceId } = await resolveCurrentWorkspaceForUser(userId);
  const conversation = await findConversationById(conversationId);
  if (
    !conversation ||
    conversation.userId !== userId ||
    conversation.workspaceId !== currentWorkspaceId
  ) {
    throw new ConversationNotFoundError();
  }

  await updateConversation(conversationId, { title, updatedAt: Date.now() });
}

export async function deleteConversationForUser(userId: string, conversationId: string) {
  const { currentWorkspaceId } = await resolveCurrentWorkspaceForUser(userId);
  const conversation = await findConversationById(conversationId);
  if (
    !conversation ||
    conversation.userId !== userId ||
    conversation.workspaceId !== currentWorkspaceId
  ) {
    throw new ConversationNotFoundError();
  }

  await deleteConversation(conversationId);
}

export async function streamMessageForUser(
  userId: string,
  conversationId: string | null,
  message: string,
  mentions: MentionRef[],
  onDelta: (text: string) => void,
  signal?: AbortSignal,
) {
  if (!message.trim()) {
    throw new MessageRequiredError();
  }

  const userSettings = await getUserSettings(userId);
  if (!isLlmConfigured(userSettings)) {
    throw new LlmNotConfiguredError();
  }

  const { currentWorkspaceId } = await resolveCurrentWorkspaceForUser(userId);
  return streamKnowledgeChatMessage(
    userId,
    currentWorkspaceId,
    conversationId,
    message.trim(),
    mentions,
    onDelta,
    signal,
  );
}

export async function getMentionCandidates(userId: string, query?: string) {
  const { currentWorkspaceId } = await resolveCurrentWorkspaceForUser(userId);
  const [notebooks, taskRows] = await Promise.all([
    listNotebookRowsByUserAndWorkspace(userId, currentWorkspaceId),
    listTaskRowsByUserAndWorkspace(userId, currentWorkspaceId) as Promise<TaskRow[]>,
  ]);

  const lowerQuery = query?.toLowerCase().trim() || '';

  const notebookResults = notebooks
    .filter((n) => !lowerQuery || n.name.toLowerCase().includes(lowerQuery))
    .map((n) => ({
      type: 'notebook' as const,
      id: n.id,
      name: n.name,
      description: n.description || null,
      color: n.color || null,
    }));

  const taskResults = taskRows
    .filter((t) => t.status === 'completed')
    .filter((t) => !lowerQuery || repairPossiblyMojibakeText(t.originalName).toLowerCase().includes(lowerQuery))
    .slice(0, 50)
    .map((t) => ({
      type: 'task' as const,
      id: t.id,
      name: repairPossiblyMojibakeText(t.originalName),
      notebookId: t.notebookId || null,
    }));

  return { notebooks: notebookResults, tasks: taskResults };
}
