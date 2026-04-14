import express from 'express';
import {
  changeUserPassword,
  createSession,
  updateUserProfile,
} from '../lib/auth/auth.js';
import {
  getCapabilities,
  getProviderHealthForUser,
  getSettingsForUser,
  updateSettingsForUser,
  listSummaryPromptsForUser,
  createSummaryPromptForUser,
  updateSummaryPromptForUser,
  deleteSummaryPromptForUser,
  SummaryPromptNotFoundError,
  resetProviderCircuitForUser,
  listLlmModelsForUser,
} from '../application/services/settings-service.js';
import { asyncRoute, requireAuthUser, setSessionCookie } from './middleware.js';

const router = express.Router();

router.get('/capabilities', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  res.json(await getCapabilities(user.id));
}));

router.get('/settings', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  return res.json({ settings: await getSettingsForUser(user.id) });
}));

router.patch('/settings', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  return res.json({ settings: await updateSettingsForUser(user.id, req.body || {}) });
}));

router.patch('/account/profile', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  const name = String(req.body.name || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'Display name is required.' });
  }

  try {
    const updatedUser = await updateUserProfile({ userId: user.id, name });
    return res.json({ user: updatedUser });
  } catch (error: unknown) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to update profile.',
    });
  }
}));

router.post('/account/password', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');
  const confirmPassword = String(req.body.confirmPassword || '');

  if (!currentPassword) {
    return res.status(400).json({ error: 'Current password is required.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'New password and confirmation do not match.' });
  }

  try {
    await changeUserPassword({ userId: user.id, currentPassword, newPassword });
    const token = await createSession(user.id);
    setSessionCookie(res, token);
    return res.json({ success: true });
  } catch (error: unknown) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to update password.',
    });
  }
}));

router.get('/provider-health', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  return res.json(await getProviderHealthForUser(user.id));
}));

router.get('/summary-prompts', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  return res.json(await listSummaryPromptsForUser(user.id));
}));

router.post('/summary-prompts', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  const name = String(req.body.name || '').trim();
  const prompt = String(req.body.prompt || '').trim();
  if (!name) {
    return res.status(400).json({ error: 'Prompt name is required.' });
  }
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt content is required.' });
  }

  return res.json(await createSummaryPromptForUser(user.id, {
    name,
    prompt,
    notebookIds: req.body.notebookIds,
    isDefault: req.body.isDefault,
  }));
}));

router.patch('/summary-prompts/:id', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  const nextName = req.body.name !== undefined ? String(req.body.name || '').trim() : undefined;
  const nextPrompt = req.body.prompt !== undefined ? String(req.body.prompt || '').trim() : undefined;
  if (nextName !== undefined && !nextName) {
    return res.status(400).json({ error: 'Prompt name is required.' });
  }
  if (nextPrompt !== undefined && !nextPrompt) {
    return res.status(400).json({ error: 'Prompt content is required.' });
  }

  try {
    return res.json(await updateSummaryPromptForUser(user.id, req.params.id, {
      name: nextName,
      prompt: nextPrompt,
      notebookIds: req.body.notebookIds,
      isDefault: req.body.isDefault,
    }));
  } catch (error: unknown) {
    if (error instanceof SummaryPromptNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    throw error;
  }
}));

router.delete('/summary-prompts/:id', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  try {
    await deleteSummaryPromptForUser(user.id, req.params.id);
    return res.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof SummaryPromptNotFoundError) {
      return res.status(404).json({ error: error.message });
    }
    throw error;
  }
}));

router.post('/provider-health/:provider/reset', asyncRoute(async (req, res) => {
  await resetProviderCircuitForUser(String(req.params.provider));
  return res.json({ success: true });
}));

router.get('/llm/models', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  return res.json({ data: await listLlmModelsForUser(user.id) });
}));

export const settingsRouter = router;
