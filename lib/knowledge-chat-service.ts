import { v4 as uuidv4 } from 'uuid';
import { listNotebookRowsByUserAndWorkspace } from '../database/repositories/notebooks-repository.js';
import { listTaskRowsByUserAndWorkspace } from '../database/repositories/tasks-repository.js';
import {
  findConversationById,
  insertConversation,
  insertMessage,
  listMessagesByConversation,
  updateConversation,
  countMessagesByConversation,
} from '../database/repositories/knowledge-conversations-repository.js';
import { streamAnswerAcrossKnowledgeBase, isLlmConfigured, type LlmMessage } from './llm.js';
import { searchChunksHybrid } from './search-index.js';
import { getUserSettings } from './settings.js';
import { repairPossiblyMojibakeText } from './text-encoding.js';
import { toTaskResponse, type KnowledgeMessageRow, type TaskRow } from './task-types.js';

export interface MentionRef {
  type: 'notebook' | 'task';
  id: string;
  name: string;
}

export interface KnowledgeChatResult {
  conversationId: string;
  messageId: string;
  content: string;
  sources: Array<{
    id: string;
    originalName: string;
    notebookName?: string | null;
    tags: string[];
    snippet: string;
  }>;
  retrieval: {
    mode: string;
    chunkCount: number;
  };
}

function buildHistoryMessages(rows: KnowledgeMessageRow[]): LlmMessage[] {
  return rows.map((row) => ({
    role: row.role as 'user' | 'assistant',
    content: row.content,
  }));
}

function resolveMentionTaskIds(
  mentions: MentionRef[],
  allTasks: ReturnType<typeof toTaskResponse>[],
): string[] {
  const taskIds = new Set<string>();

  for (const mention of mentions) {
    if (mention.type === 'task') {
      taskIds.add(mention.id);
    } else if (mention.type === 'notebook') {
      for (const task of allTasks) {
        if (task.notebookId === mention.id) {
          taskIds.add(task.id);
        }
      }
    }
  }

  return [...taskIds];
}

export async function streamKnowledgeChatMessage(
  userId: string,
  workspaceId: string,
  conversationId: string | null,
  message: string,
  mentions: MentionRef[],
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<KnowledgeChatResult> {
  const userSettings = await getUserSettings(userId);
  if (!isLlmConfigured(userSettings)) {
    throw new Error('LLM API is not configured.');
  }

  const now = Date.now();
  let convId = conversationId;

  if (!convId) {
    convId = uuidv4();
    const title = message.length > 60 ? message.slice(0, 57) + '...' : message;
    await insertConversation({
      id: convId,
      userId,
      workspaceId,
      title,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    const existing = await findConversationById(convId);
    if (!existing || existing.userId !== userId || existing.workspaceId !== workspaceId) {
      throw new Error('Conversation not found.');
    }
  }

  const userMsgId = uuidv4();
  await insertMessage({
    id: userMsgId,
    conversationId: convId,
    role: 'user',
    content: message,
    mentions: mentions.length ? JSON.stringify(mentions) : null,
    metadata: null,
    createdAt: now,
  });



  // Use only the current message's mentions for retrieval scope.
  // The frontend persists mentions across messages in the UI,
  // so the user controls scope by adding/removing chips.
  // If mentions are empty, search across all recordings.
  const allTasks = ((await listTaskRowsByUserAndWorkspace(userId, workspaceId)) as TaskRow[]).map(
    toTaskResponse,
  );
  const mentionTaskIds = resolveMentionTaskIds(mentions, allTasks);

  // If user explicitly mentioned something but it resolved to no tasks (e.g. empty notebook),
  // return early — don't fall back to searching everything.
  if (mentions.length > 0 && mentionTaskIds.length === 0) {
    const responseText = 'The selected notebook or recording has no content to search.';
    onDelta(responseText);
    const assistantMsgId = uuidv4();
    await insertMessage({
      id: assistantMsgId, conversationId: convId, role: 'assistant',
      content: responseText, mentions: null, metadata: null, createdAt: Date.now(),
    });
    await updateConversation(convId, { updatedAt: Date.now() });
    return { conversationId: convId, messageId: assistantMsgId, content: responseText, sources: [], retrieval: { mode: 'empty', chunkCount: 0 } };
  }

  const retrieval = await searchChunksHybrid(userId, workspaceId, message, {
    taskIds: mentionTaskIds.length ? mentionTaskIds : undefined,
    retrievalMode: userSettings.retrievalMode,
    maxChunks: userSettings.maxKnowledgeChunks,
    settings: userSettings,
  });

  // Always use ranked results for candidate selection, even with mentions.
  // Mentions narrow the search scope (passed to searchChunksHybrid above),
  // but we still only include tasks that ranked well — never dump an entire notebook.
  const MAX_SOURCE_TASKS = 8;
  const taskRanking = retrieval.taskRanking;
  const candidateTasks = taskRanking
    .map((item) => allTasks.find((task) => task.id === item.taskId))
    .filter(Boolean)
    .slice(0, MAX_SOURCE_TASKS) as typeof allTasks;

  const notebooks = await listNotebookRowsByUserAndWorkspace(userId, workspaceId);
  const notebookMap = new Map(notebooks.map((item) => [item.id, item.name]));

  const sources = candidateTasks.map((task) => {
    const taskChunks = retrieval.chunkRanking.filter((chunk) => chunk.taskId === task.id);
    // Only use retrieved chunks — never fall back to full transcript
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
  });

  const historyRows = await listMessagesByConversation(convId);
  const priorMessages = historyRows.filter((m) => m.id !== userMsgId);
  const history = buildHistoryMessages(priorMessages);

  let fullContent = '';
  const content = await streamAnswerAcrossKnowledgeBase(
    message,
    sources,
    history,
    userSettings,
    (delta) => {
      fullContent += delta;
      onDelta(delta);
    },
    signal,
  );
  fullContent = content || fullContent;

  const assistantMsgId = uuidv4();
  const sourcesMetadata = candidateTasks.map((task, sourceIndex) => {
    const taskChunks = retrieval.chunkRanking.filter((chunk) => chunk.taskId === task.id);
    return {
      id: task.id,
      sourceIndex: sourceIndex + 1,
      originalName: repairPossiblyMojibakeText(task.originalName),
      notebookName: task.notebookId ? notebookMap.get(task.notebookId) || null : null,
      tags: task.tags,
      snippet:
        taskChunks[0]?.content ||
        taskRanking.find((item) => item.taskId === task.id)?.snippet ||
        '',
      citations: taskChunks.map((chunk) => ({
        content: chunk.content.slice(0, 100),
        startTime: chunk.startTime ?? null,
        endTime: chunk.endTime ?? null,
      })),
    };
  });

  // Skip saving if the request was aborted (client disconnected)
  if (signal?.aborted) {
    return {
      conversationId: convId,
      messageId: assistantMsgId,
      content: fullContent,
      sources: [],
      retrieval: { mode: userSettings.retrievalMode, chunkCount: 0 },
    };
  }

  await insertMessage({
    id: assistantMsgId,
    conversationId: convId,
    role: 'assistant',
    content: fullContent,
    mentions: null,
    metadata: JSON.stringify({
      sources: sourcesMetadata,
      retrieval: {
        mode: userSettings.retrievalMode,
        chunkCount: retrieval.chunkRanking.length,
      },
    }),
    createdAt: Date.now(),
  });

  await updateConversation(convId, { updatedAt: Date.now() });

  const isFirstExchange = (await countMessagesByConversation(convId)) <= 2;
  if (isFirstExchange) {
    const title = message.length > 60 ? message.slice(0, 57) + '...' : message;
    await updateConversation(convId, { title, updatedAt: Date.now() });
  }

  return {
    conversationId: convId,
    messageId: assistantMsgId,
    content: fullContent,
    sources: sourcesMetadata,
    retrieval: {
      mode: userSettings.retrievalMode,
      chunkCount: retrieval.chunkRanking.length,
    },
  };
}
