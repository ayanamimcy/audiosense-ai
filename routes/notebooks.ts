import express from 'express';
import {
  UserNotebookNotFoundError,
  createNotebookForUser,
  deleteNotebookForUser,
  listNotebooksForUser,
  listTagStatsForUser,
  updateNotebookForUser,
} from '../application/services/notebooks-service.js';
import { asyncRoute, requireAuthUser } from './middleware.js';

const router = express.Router();

router.get('/notebooks', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  return res.json(await listNotebooksForUser(user.id));
}));

router.post('/notebooks', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  try {
    return res.json(await createNotebookForUser(user.id, req.body || {}));
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to create notebook.',
    });
  }
}));

router.patch('/notebooks/:id', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  try {
    return res.json(await updateNotebookForUser(user.id, req.params.id, req.body || {}));
  } catch (error) {
    if (error instanceof UserNotebookNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to update notebook.',
    });
  }
}));

router.delete('/notebooks/:id', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  try {
    await deleteNotebookForUser(user.id, req.params.id);
    return res.json({ success: true });
  } catch (error) {
    if (error instanceof UserNotebookNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    throw error;
  }
}));

router.get('/tags', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  return res.json(await listTagStatsForUser(user.id));
}));

export const notebooksRouter = router;
