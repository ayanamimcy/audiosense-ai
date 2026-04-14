import express from 'express';
import { createApiToken } from '../lib/auth/auth.js';
import { validateScopes } from '../lib/auth/api-token-scopes.js';
import {
  deleteApiTokenRowById,
  listApiTokenRowsByUserId,
} from '../database/repositories/api-tokens-repository.js';
import { asyncRoute, requireAuthUser } from './middleware.js';

const router = express.Router();

router.post('/api-tokens', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  if (!req.authSessionId) {
    return res.status(403).json({ error: 'API tokens cannot manage other tokens.' });
  }
  const name = String(req.body.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'Token name is required.' });
  }

  let scopes: string[];
  try {
    scopes = validateScopes(req.body.scopes);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid scopes.' });
  }

  const expiresAt = req.body.expiresAt ? Number(req.body.expiresAt) : null;

  const { rawToken, tokenRecord } = await createApiToken({
    userId: user.id,
    name,
    scopes,
    expiresAt,
  });

  return res.json({
    token: rawToken,
    id: tokenRecord.id,
    name: tokenRecord.name,
    scopes,
    expiresAt: tokenRecord.expiresAt,
    createdAt: tokenRecord.createdAt,
  });
}));

router.get('/api-tokens', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  if (!req.authSessionId) {
    return res.status(403).json({ error: 'API tokens cannot manage other tokens.' });
  }
  const tokens = await listApiTokenRowsByUserId(user.id);
  return res.json({
    tokens: tokens.map((t) => ({
      ...t,
      scopes: JSON.parse(t.scopes),
    })),
  });
}));

router.delete('/api-tokens/:id', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  if (!req.authSessionId) {
    return res.status(403).json({ error: 'API tokens cannot manage other tokens.' });
  }
  const deleted = await deleteApiTokenRowById(user.id, req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'API token not found.' });
  }
  return res.json({ success: true });
}));

export const apiTokensRouter = router;
