import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import logger from '../../lib/shared/logger.js';

const log = logger.child('settings-service');
import {
  clearDefaultSummaryPromptRowsByWorkspace,
  deleteSummaryPromptRowByWorkspace,
  insertSummaryPromptRow,
  updateSummaryPromptRowByWorkspace,
} from '../../database/repositories/summary-prompts-repository.js';
import { getEmbeddingsInfo } from '../../lib/ai/embeddings.js';
import { getLlmInfo } from '../../lib/ai/llm.js';
import { resetProviderCircuit } from '../../lib/audio-engine/routing.js';
import { getAvailableTranscriptionProviders } from '../../lib/audio-engine/providers/index.js';
import {
  getProviderHealth,
  getUserSettings,
  getUserSettingsForClient,
  saveUserSettings,
} from '../../lib/settings/settings.js';
import {
  findSummaryPrompt,
  listSummaryPrompts,
} from '../../lib/tasks/summary-prompts.js';
import { getLocalRuntimeCatalogSnapshot } from '../../lib/settings/user-settings-schema.js';
import { getValidatedNotebookIdsForWorkspace } from '../../lib/tasks/task-helpers.js';
import { resolveCurrentWorkspaceForUser } from '../../lib/workspaces/workspaces.js';

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export async function getCapabilities(userId: string) {
  const userSettings = await getUserSettings(userId);
  return {
    auth: {
      type: 'session-cookie',
      userId,
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
  };
}

// ---------------------------------------------------------------------------
// User settings
// ---------------------------------------------------------------------------

export async function getSettingsForUser(userId: string) {
  await resolveCurrentWorkspaceForUser(userId);
  return getUserSettingsForClient(userId);
}

export async function updateSettingsForUser(userId: string, input: Record<string, unknown>) {
  await saveUserSettings(userId, input);
  await resolveCurrentWorkspaceForUser(userId);
  return getUserSettingsForClient(userId);
}

// ---------------------------------------------------------------------------
// Provider health
// ---------------------------------------------------------------------------

export async function getProviderHealthForUser(userId: string) {
  const userSettings = await getUserSettings(userId);
  return getProviderHealth(userSettings);
}

export async function resetProviderCircuitForUser(provider: string) {
  await resetProviderCircuit(provider);
}

// ---------------------------------------------------------------------------
// Summary prompts
// ---------------------------------------------------------------------------

export async function listSummaryPromptsForUser(userId: string) {
  const { currentWorkspaceId } = await resolveCurrentWorkspaceForUser(userId);
  return listSummaryPrompts(userId, currentWorkspaceId);
}

export class SummaryPromptNotFoundError extends Error {
  constructor() {
    super('Summary prompt not found.');
  }
}

export async function createSummaryPromptForUser(
  userId: string,
  input: { name: string; prompt: string; notebookIds?: unknown; isDefault?: boolean },
) {
  const { currentWorkspaceId } = await resolveCurrentWorkspaceForUser(userId);
  const notebookIds = await getValidatedNotebookIdsForWorkspace(
    userId,
    currentWorkspaceId,
    input.notebookIds,
  );
  const isDefault = input.isDefault === true;
  const now = Date.now();
  const record = {
    id: uuidv4(),
    userId,
    workspaceId: currentWorkspaceId,
    name: input.name,
    prompt: input.prompt,
    notebookIds: JSON.stringify(notebookIds),
    isDefault,
    createdAt: now,
    updatedAt: now,
  };

  if (isDefault) {
    await clearDefaultSummaryPromptRowsByWorkspace(userId, currentWorkspaceId);
  }

  await insertSummaryPromptRow(record);
  return findSummaryPrompt(userId, record.id, currentWorkspaceId);
}

export async function updateSummaryPromptForUser(
  userId: string,
  promptId: string,
  input: { name?: string; prompt?: string; notebookIds?: unknown; isDefault?: boolean },
) {
  const { currentWorkspaceId } = await resolveCurrentWorkspaceForUser(userId);
  const current = await findSummaryPrompt(userId, promptId, currentWorkspaceId);
  if (!current) {
    throw new SummaryPromptNotFoundError();
  }

  const nextName = input.name !== undefined ? String(input.name || '').trim() : current.name;
  const nextPrompt = input.prompt !== undefined ? String(input.prompt || '').trim() : current.prompt;

  const notebookIds =
    input.notebookIds !== undefined
      ? await getValidatedNotebookIdsForWorkspace(userId, currentWorkspaceId, input.notebookIds)
      : current.notebookIds;

  const isDefault = input.isDefault !== undefined ? input.isDefault === true : current.isDefault;
  if (isDefault) {
    await clearDefaultSummaryPromptRowsByWorkspace(userId, currentWorkspaceId, current.id);
  }

  await updateSummaryPromptRowByWorkspace(userId, currentWorkspaceId, current.id, {
    name: nextName,
    prompt: nextPrompt,
    notebookIds: JSON.stringify(notebookIds),
    isDefault,
    updatedAt: Date.now(),
  });

  return findSummaryPrompt(userId, current.id, currentWorkspaceId);
}

export async function deleteSummaryPromptForUser(userId: string, promptId: string) {
  const { currentWorkspaceId } = await resolveCurrentWorkspaceForUser(userId);
  const deleted = await deleteSummaryPromptRowByWorkspace(userId, currentWorkspaceId, promptId);
  if (!deleted) {
    throw new SummaryPromptNotFoundError();
  }
}

// ---------------------------------------------------------------------------
// LLM models listing
// ---------------------------------------------------------------------------

export async function listLlmModelsForUser(userId: string) {
  const userSettings = await getUserSettings(userId);
  const info = getLlmInfo(userSettings);

  if (!info.configured || !info.baseUrl) {
    return [];
  }

  try {
    const response = await axios.get(`${info.baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${userSettings.llm.apiKey}`,
      },
      timeout: 10_000,
    });

    return Array.isArray(response.data?.data)
      ? response.data.data
          .map((m: { id?: string }) => ({ id: String(m.id || '') }))
          .filter((m: { id: string }) => m.id)
      : [];
  } catch (error) {
    log.error('Failed to fetch LLM models', { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}
