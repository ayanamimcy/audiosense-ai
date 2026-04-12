import { v4 as uuidv4 } from 'uuid';
import {
  findWorkspaceRowByUserAndId,
  insertWorkspaceRow,
  listWorkspaceRowsByUser,
  type WorkspaceRow,
} from '../database/repositories/workspaces-repository.js';
import { getUserSettings, saveUserSettings } from './settings.js';

const DEFAULT_WORKSPACE_COLOR = '#4f46e5';

export function toWorkspaceResponse(workspace: WorkspaceRow) {
  return {
    id: workspace.id,
    userId: workspace.userId,
    name: workspace.name,
    description: workspace.description || null,
    color: workspace.color || null,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  };
}

export async function createDefaultWorkspaceForUser(userId: string) {
  const now = Date.now();
  const workspace: WorkspaceRow = {
    id: uuidv4(),
    userId,
    name: 'Default Workspace',
    description: null,
    color: DEFAULT_WORKSPACE_COLOR,
    createdAt: now,
    updatedAt: now,
  };
  await insertWorkspaceRow(workspace);
  return workspace;
}

export async function ensureUserHasWorkspace(userId: string) {
  const existing = await listWorkspaceRowsByUser(userId);
  if (existing.length > 0) {
    return existing;
  }

  const created = await createDefaultWorkspaceForUser(userId);
  return [created];
}

export async function resolveCurrentWorkspaceForUser(userId: string) {
  const workspaces = await ensureUserHasWorkspace(userId);
  const settings = await getUserSettings(userId);
  const currentWorkspace =
    (settings.currentWorkspaceId
      ? workspaces.find((workspace) => workspace.id === settings.currentWorkspaceId)
      : null) || workspaces[0];

  if (!currentWorkspace) {
    throw new Error('Failed to resolve current workspace.');
  }

  if (settings.currentWorkspaceId !== currentWorkspace.id) {
    await saveUserSettings(userId, { currentWorkspaceId: currentWorkspace.id });
  }

  return {
    currentWorkspace,
    currentWorkspaceId: currentWorkspace.id,
    workspaces,
  };
}

export async function assertWorkspaceBelongsToUser(userId: string, workspaceId: string) {
  const workspace = await findWorkspaceRowByUserAndId(userId, workspaceId);
  if (!workspace) {
    throw new Error('Workspace not found.');
  }
  return workspace;
}
