import express from 'express';
import {
  answerKnowledgeForUser,
  KnowledgeLlmNotConfiguredError,
  KnowledgeNoMatchesError,
  KnowledgeQueryRequiredError,
  searchTasksForUser,
} from '../application/services/search-service.js';
import { asyncRoute, requireAuthUser } from './middleware.js';

const router = express.Router();

router.get('/search/tasks', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  const query = String(req.query.q || '').trim();
  const results = await searchTasksForUser(user.id, query);
  return res.json(results);
}));

router.post('/knowledge/ask', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  try {
    const selectedIds = Array.isArray(req.body.taskIds)
      ? req.body.taskIds.map((value: unknown) => String(value))
      : [];
    const result = await answerKnowledgeForUser(
      user.id,
      String(req.body.query || ''),
      selectedIds.length ? selectedIds : undefined,
    );
    return res.json(result);
  } catch (error: unknown) {
    if (error instanceof KnowledgeQueryRequiredError || error instanceof KnowledgeLlmNotConfiguredError) {
      return res.status(400).json({ error: error.message });
    }
    if (error instanceof KnowledgeNoMatchesError) {
      return res.status(404).json({ error: error.message });
    }
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to answer question.',
    });
  }
}));

export const searchRouter = router;
