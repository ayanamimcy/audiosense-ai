import axios from 'axios';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  clearDefaultSummaryPromptRows,
  deleteSummaryPromptRow,
  insertSummaryPromptRow,
  updateSummaryPromptRow,
} from '../database/repositories/summary-prompts-repository.js';
import {
  authenticateUser,
  changeUserPassword,
  createSession,
  updateUserProfile,
} from '../lib/auth.js';
import { getEmbeddingsInfo } from '../lib/embeddings.js';
import {
  getLlmInfo,
} from '../lib/llm.js';
import { resetProviderCircuit } from '../lib/provider-routing.js';
import {
  getProviderHealth,
  getUserSettings,
  getUserSettingsForClient,
  saveUserSettings,
} from '../lib/settings.js';
import {
  clearDefaultSummaryPrompts,
  findSummaryPrompt,
  listSummaryPrompts,
} from '../lib/summary-prompts.js';
import { getAvailableTranscriptionProviders } from '../lib/transcription.js';
import { getLocalRuntimeCatalogSnapshot } from '../lib/user-settings-schema.js';
import { getValidatedNotebookIdsForUser } from '../lib/task-helpers.js';
import { asyncRoute, requireAuthUser, setSessionCookie } from './middleware.js';

const router = express.Router();

router.get('/capabilities', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  const userSettings = await getUserSettings(user.id);

  res.json({
    auth: {
      type: 'session-cookie',
      userId: user.id,
    },
    transcription: {
      activeProvider: userSettings.defaultProvider,
      providers: getAvailableTranscriptionProviders(userSettings),
      diarizationSupported: true,
      localRuntime: getLocalRuntimeCatalogSnapshot(),
    },
    queue: {
      workerMode: 'separate-process',
      recommendedCommand: 'npm run worker',
    },
    llm: getLlmInfo(userSettings),
    embeddings: getEmbeddingsInfo(),
  });
}));

router.get('/settings', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  return res.json({
    settings: await getUserSettingsForClient(user.id),
  });
}));

router.patch('/settings', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  const settings = await saveUserSettings(user.id, req.body || {});
  return res.json({ settings });
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
  const userSettings = await getUserSettings(user.id);
  return res.json(await getProviderHealth(userSettings));
}));

router.get('/summary-prompts', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  return res.json(await listSummaryPrompts(user.id));
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

  const notebookIds = await getValidatedNotebookIdsForUser(user.id, req.body.notebookIds);
  const isDefault = req.body.isDefault === true;
  const now = Date.now();
  const record = {
    id: uuidv4(),
    userId: user.id,
    name,
    prompt,
    notebookIds: JSON.stringify(notebookIds),
    isDefault,
    createdAt: now,
    updatedAt: now,
  };

  if (isDefault) {
    await clearDefaultSummaryPromptRows(user.id);
  }

  await insertSummaryPromptRow(record);
  return res.json(await findSummaryPrompt(user.id, record.id));
}));

router.patch('/summary-prompts/:id', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  const current = await findSummaryPrompt(user.id, req.params.id);
  if (!current) {
    return res.status(404).json({ error: 'Summary prompt not found.' });
  }

  const nextName = req.body.name !== undefined ? String(req.body.name || '').trim() : current.name;
  const nextPrompt = req.body.prompt !== undefined ? String(req.body.prompt || '').trim() : current.prompt;
  if (!nextName) {
    return res.status(400).json({ error: 'Prompt name is required.' });
  }
  if (!nextPrompt) {
    return res.status(400).json({ error: 'Prompt content is required.' });
  }

  const notebookIds =
    req.body.notebookIds !== undefined
      ? await getValidatedNotebookIdsForUser(user.id, req.body.notebookIds)
      : current.notebookIds;
  const isDefault = req.body.isDefault !== undefined ? req.body.isDefault === true : current.isDefault;
  if (isDefault) {
    await clearDefaultSummaryPromptRows(user.id, current.id);
  }

  await updateSummaryPromptRow(user.id, current.id, {
    name: nextName,
    prompt: nextPrompt,
    notebookIds: JSON.stringify(notebookIds),
    isDefault,
    updatedAt: Date.now(),
  });

  return res.json(await findSummaryPrompt(user.id, current.id));
}));

router.delete('/summary-prompts/:id', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  const deleted = await deleteSummaryPromptRow(user.id, req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Summary prompt not found.' });
  }

  return res.json({ success: true });
}));

router.post('/provider-health/:provider/reset', asyncRoute(async (req, res) => {
  await resetProviderCircuit(String(req.params.provider));
  return res.json({ success: true });
}));

router.get('/llm/models', asyncRoute(async (req, res) => {
  const user = requireAuthUser(req);
  const userSettings = await getUserSettings(user.id);
  const info = getLlmInfo(userSettings);

  if (!info.configured || !info.baseUrl) {
    return res.json({ data: [] });
  }

  try {
    const response = await axios.get(`${info.baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${userSettings.llm.apiKey}`,
      },
      timeout: 10_000,
    });

    const models = Array.isArray(response.data?.data)
      ? response.data.data.map((m: { id?: string }) => ({ id: String(m.id || '') })).filter((m: { id: string }) => m.id)
      : [];

    return res.json({ data: models });
  } catch (error) {
    console.error('Failed to fetch LLM models:', error instanceof Error ? error.message : error);
    return res.json({ data: [] });
  }
}));

export const settingsRouter = router;
