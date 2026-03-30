import express from 'express';
import {
  handleChatMessage,
  handleGenerateSummary,
  handleStreamChat,
  LlmNotConfiguredError,
  SummaryPromptNotAvailableError,
  SummaryPromptNotFoundError,
  TaskNotFoundError,
  TranscriptNotReadyError,
} from '../lib/chat-service.js';
import { asyncRoute, requireAuthUser } from './middleware.js';

const router = express.Router();

function mapServiceError(error: unknown, res: express.Response) {
  if (error instanceof TaskNotFoundError) {
    return res.status(404).json({ error: error.message });
  }
  if (error instanceof TranscriptNotReadyError || error instanceof LlmNotConfiguredError) {
    return res.status(400).json({ error: error.message });
  }
  if (error instanceof SummaryPromptNotFoundError) {
    return res.status(404).json({ error: error.message });
  }
  if (error instanceof SummaryPromptNotAvailableError) {
    return res.status(400).json({ error: error.message });
  }
  return null;
}

router.post('/tasks/:id/summary', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  try {
    const result = await handleGenerateSummary(user.id, req.params.id, {
      summaryPromptId:
        typeof req.body.summaryPromptId === 'string' && req.body.summaryPromptId.trim()
          ? req.body.summaryPromptId.trim()
          : null,
      skipConfiguredPrompt: req.body.skipConfiguredPrompt === true,
      instructions: req.body.instructions,
    });
    return res.json(result);
  } catch (error: unknown) {
    const mapped = mapServiceError(error, res);
    if (mapped) return mapped;
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to generate summary.',
    });
  }
}));

router.post('/tasks/:id/chat', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  const message = String(req.body.message || '').trim();
  if (!message) {
    return res.status(400).json({ error: 'Message is required.' });
  }

  try {
    const messages = await handleChatMessage(user.id, req.params.id, message);
    return res.json(messages);
  } catch (error: unknown) {
    const mapped = mapServiceError(error, res);
    if (mapped) return mapped;
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to send message.',
    });
  }
}));

router.post('/tasks/:id/chat/stream', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  const message = String(req.body.message || '').trim();
  if (!message) {
    return res.status(400).json({ error: 'Message is required.' });
  }

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
    writeEvent('start', { taskId: req.params.id });

    const { messages } = await handleStreamChat(
      user.id,
      req.params.id,
      message,
      (text) => { writeEvent('delta', { text }); },
      abortController.signal,
    );

    if (clientClosed) return;
    writeEvent('done', { messages });
    res.end();
  } catch (error: unknown) {
    if (clientClosed) return;
    writeEvent('error', {
      error: error instanceof Error ? error.message : 'Failed to stream message.',
    });
    res.end();
  }
}));

export const chatRouter = router;
