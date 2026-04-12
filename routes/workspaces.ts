import express from 'express';
import {
  createWorkspaceForUser,
  deleteWorkspaceForUser,
  listWorkspacesForUser,
  selectCurrentWorkspaceForUser,
  updateWorkspaceForUser,
  WorkspaceDeleteConstraintError,
  WorkspaceNotFoundError,
} from '../application/services/workspaces-service.js';
import { asyncRoute, requireAuthUser } from './middleware.js';

const router = express.Router();

router.get('/workspaces', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  return res.json(await listWorkspacesForUser(user.id));
}));

router.post('/workspaces', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  try {
    return res.json(await createWorkspaceForUser(user.id, req.body || {}));
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to create workspace.',
    });
  }
}));

router.patch('/workspaces/current', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  try {
    return res.json(
      await selectCurrentWorkspaceForUser(user.id, String(req.body.workspaceId || '').trim()),
    );
  } catch (error) {
    if (error instanceof WorkspaceNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to switch workspace.',
    });
  }
}));

router.patch('/workspaces/:id', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  try {
    return res.json(await updateWorkspaceForUser(user.id, req.params.id, req.body || {}));
  } catch (error) {
    if (error instanceof WorkspaceNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to update workspace.',
    });
  }
}));

router.delete('/workspaces/:id', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  try {
    return res.json(await deleteWorkspaceForUser(user.id, req.params.id));
  } catch (error) {
    if (error instanceof WorkspaceNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    if (error instanceof WorkspaceDeleteConstraintError) {
      return res.status(400).json({ error: error.message });
    }
    throw error;
  }
}));

export const workspacesRouter = router;
