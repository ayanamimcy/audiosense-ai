import { db } from '../client.js';
import type { KnowledgeConversationRow, KnowledgeMessageRow } from '../../lib/tasks/task-types.js';

export async function listConversationsByUser(userId: string) {
  return (await db('knowledge_conversations')
    .where({ userId })
    .orderBy('updatedAt', 'desc')) as KnowledgeConversationRow[];
}

export async function listConversationsByUserAndWorkspace(userId: string, workspaceId: string) {
  return (await db('knowledge_conversations')
    .where({ userId, workspaceId })
    .orderBy('updatedAt', 'desc')) as KnowledgeConversationRow[];
}

export async function findConversationById(id: string) {
  return (await db('knowledge_conversations').where({ id }).first()) as KnowledgeConversationRow | undefined;
}

export async function insertConversation(row: KnowledgeConversationRow) {
  await db('knowledge_conversations').insert(row);
}

export async function updateConversation(id: string, updates: Partial<Pick<KnowledgeConversationRow, 'title' | 'updatedAt'>>) {
  await db('knowledge_conversations').where({ id }).update(updates);
}

export async function deleteConversation(id: string) {
  await db('knowledge_conversations').where({ id }).delete();
}

export async function listMessagesByConversation(conversationId: string) {
  return (await db('knowledge_messages')
    .where({ conversationId })
    .orderBy('createdAt', 'asc')) as KnowledgeMessageRow[];
}

export async function insertMessage(row: KnowledgeMessageRow) {
  await db('knowledge_messages').insert(row);
}

export async function updateMessageMetadata(messageId: string, metadata: string) {
  await db('knowledge_messages').where({ id: messageId }).update({ metadata });
}

export async function countMessagesByConversation(conversationId: string) {
  const result = await db('knowledge_messages').where({ conversationId }).count('* as count').first();
  return Number(result?.count || 0);
}
