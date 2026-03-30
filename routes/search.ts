import express from 'express';
import {
  searchTasks,
  answerFromKnowledgeBase,
} from '../lib/knowledge-service.js';
import { isLlmConfigured } from '../lib/llm.js';
import { getUserSettings } from '../lib/settings.js';
import { asyncRoute, requireAuthUser } from './middleware.js';

const router = express.Router();

router.get('/search/tasks', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  const query = String(req.query.q || '').trim();
  const results = await searchTasks(user.id, query);
  return res.json(results);
}));

router.post('/knowledge/ask', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  const query = String(req.body.query || '').trim();
  if (!query) {
    return res.status(400).json({ error: 'Query is required.' });
  }
  const userSettings = await getUserSettings(user.id);
  if (!isLlmConfigured(userSettings)) {
    return res.status(400).json({ error: 'LLM API is not configured.' });
  }

  try {
    const selectedIds = Array.isArray(req.body.taskIds)
      ? req.body.taskIds.map((value: unknown) => String(value))
      : [];
    const result = await answerFromKnowledgeBase(
      user.id,
      query,
      selectedIds.length ? selectedIds : undefined,
    );
    return res.json(result);
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'No matching transcripts found.') {
      return res.status(404).json({ error: error.message });
    }
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to answer question.',
    });
  }
}));

export const searchRouter = router;
