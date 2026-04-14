import express from 'express';
import {
  ConversationNotFoundError,
  deleteConversationForUser,
  renameConversationForUser,
  getConversationMessages,
  getMentionCandidates,
  listConversationsForUser,
  LlmNotConfiguredError,
  MessageRequiredError,
  streamMessageForUser,
} from '../application/services/knowledge-chat-service.js';
import type { MentionRef } from '../lib/search/knowledge-chat-service.js';
import { asyncRoute, requireAuthUser } from './middleware.js';

const router = express.Router();

router.get('/knowledge/conversations', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  const conversations = await listConversationsForUser(user.id);
  return res.json(conversations);
}));

router.get('/knowledge/conversations/:id/messages', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  try {
    const result = await getConversationMessages(user.id, req.params.id);
    return res.json(result);
  } catch (error) {
    if (error instanceof ConversationNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    throw error;
  }
}));

router.patch('/knowledge/conversations/:id', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  const title = String(req.body.title || '').trim();
  if (!title) {
    return res.status(400).json({ error: 'Title is required.' });
  }
  try {
    await renameConversationForUser(user.id, req.params.id, title);
    return res.json({ ok: true });
  } catch (error) {
    if (error instanceof ConversationNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    throw error;
  }
}));

router.delete('/knowledge/conversations/:id', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  try {
    await deleteConversationForUser(user.id, req.params.id);
    return res.json({ ok: true });
  } catch (error) {
    if (error instanceof ConversationNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    throw error;
  }
}));

router.post('/knowledge/chat/stream', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  const message = String(req.body.message || '').trim();
  const conversationId = req.body.conversationId || null;
  const mentions: MentionRef[] = Array.isArray(req.body.mentions) ? req.body.mentions : [];

  const abortController = new AbortController();
  let clientClosed = false;
  req.on('close', () => {
    clientClosed = true;
    abortController.abort();
  });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const writeEvent = (event: string, payload: Record<string, unknown>) => {
    if (clientClosed || res.writableEnded) {
      return;
    }
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    writeEvent('start', { conversationId });

    const result = await streamMessageForUser(
      user.id,
      conversationId,
      message,
      mentions,
      (text) => { writeEvent('delta', { text }); },
      abortController.signal,
    );

    if (clientClosed) return;
    writeEvent('done', {
      conversationId: result.conversationId,
      messageId: result.messageId,
      sources: result.sources,
      retrieval: result.retrieval,
    });
    res.end();
  } catch (error: unknown) {
    if (clientClosed) return;
    if (error instanceof MessageRequiredError || error instanceof LlmNotConfiguredError) {
      writeEvent('error', { error: error.message });
    } else {
      writeEvent('error', {
        error: error instanceof Error ? error.message : 'Failed to stream message.',
      });
    }
    res.end();
  }
}));

router.get('/knowledge/mentions', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  const query = String(req.query.q || '').trim();
  const candidates = await getMentionCandidates(user.id, query || undefined);
  return res.json(candidates);
}));

export const knowledgeRouter = router;
