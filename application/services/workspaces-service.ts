import { v4 as uuidv4 } from 'uuid';
import { db } from '../../database/client.js';
import {
  deleteWorkspaceRowByUserAndId,
  findWorkspaceRowByUserAndId,
  insertWorkspaceRow,
  listWorkspaceRowsByUser,
  updateWorkspaceRowByUserAndId,
} from '../../database/repositories/workspaces-repository.js';
import { saveUserSettings } from '../../lib/settings/settings.js';
import { resolveCurrentWorkspaceForUser, toWorkspaceResponse } from '../../lib/workspaces/workspaces.js';

export class WorkspaceNotFoundError extends Error {
  constructor() {
    super('Workspace not found.');
  }
}

export class WorkspaceDeleteConstraintError extends Error {
  constructor(message: string) {
    super(message);
  }
}

async function countWorkspaceContent(workspaceId: string) {
  const [taskRow, notebookRow, conversationRow, promptRow] = await Promise.all([
    db('tasks').where({ workspaceId }).count('* as count').first(),
    db('notebooks').where({ workspaceId }).count('* as count').first(),
    db('knowledge_conversations').where({ workspaceId }).count('* as count').first(),
    db('summary_prompts').where({ workspaceId }).count('* as count').first(),
  ]);

  return (
    Number(taskRow?.count || 0) +
    Number(notebookRow?.count || 0) +
    Number(conversationRow?.count || 0) +
    Number(promptRow?.count || 0)
  );
}

export async function listWorkspacesForUser(userId: string) {
  const { workspaces, currentWorkspaceId } = await resolveCurrentWorkspaceForUser(userId);
  return {
    workspaces: workspaces.map(toWorkspaceResponse),
    currentWorkspaceId,
  };
}

export async function createWorkspaceForUser(
  userId: string,
  input: { name?: unknown; description?: unknown; color?: unknown },
) {
  const name = String(input.name || '').trim();
  if (!name) {
    throw new Error('Workspace name is required.');
  }

  const now = Date.now();
  const workspace = {
    id: uuidv4(),
    userId,
    name,
    description: input.description !== undefined ? String(input.description || '').trim() || null : null,
    color: input.color !== undefined ? String(input.color || '').trim() || null : '#4f46e5',
    createdAt: now,
    updatedAt: now,
  };

  await insertWorkspaceRow(workspace);
  const current = await resolveCurrentWorkspaceForUser(userId);
  if (!current.currentWorkspaceId) {
    await saveUserSettings(userId, { currentWorkspaceId: workspace.id });
  }

  return toWorkspaceResponse(workspace);
}

export async function updateWorkspaceForUser(
  userId: string,
  workspaceId: string,
  input: { name?: unknown; description?: unknown; color?: unknown },
) {
  const current = await findWorkspaceRowByUserAndId(userId, workspaceId);
  if (!current) {
    throw new WorkspaceNotFoundError();
  }

  const nextName = input.name !== undefined ? String(input.name || '').trim() : current.name;
  if (!nextName) {
    throw new Error('Workspace name is required.');
  }

  await updateWorkspaceRowByUserAndId(userId, workspaceId, {
    name: nextName,
    description: input.description !== undefined ? String(input.description || '').trim() || null : current.description,
    color: input.color !== undefined ? String(input.color || '').trim() || null : current.color,
    updatedAt: Date.now(),
  });

  const updated = await findWorkspaceRowByUserAndId(userId, workspaceId);
  if (!updated) {
    throw new WorkspaceNotFoundError();
  }

  return toWorkspaceResponse(updated);
}

export async function selectCurrentWorkspaceForUser(userId: string, workspaceId: string) {
  const workspace = await findWorkspaceRowByUserAndId(userId, workspaceId);
  if (!workspace) {
    throw new WorkspaceNotFoundError();
  }

  await saveUserSettings(userId, { currentWorkspaceId: workspaceId });
  return listWorkspacesForUser(userId);
}

export async function deleteWorkspaceForUser(userId: string, workspaceId: string) {
  const workspace = await findWorkspaceRowByUserAndId(userId, workspaceId);
  if (!workspace) {
    throw new WorkspaceNotFoundError();
  }

  const workspaces = await listWorkspaceRowsByUser(userId);
  if (workspaces.length <= 1) {
    throw new WorkspaceDeleteConstraintError('You must keep at least one workspace.');
  }

  const contentCount = await countWorkspaceContent(workspaceId);
  if (contentCount > 0) {
    throw new WorkspaceDeleteConstraintError('Workspace must be empty before deletion.');
  }

  await deleteWorkspaceRowByUserAndId(userId, workspaceId);

  const remaining = await listWorkspaceRowsByUser(userId);
  const fallback = remaining[0];
  if (fallback) {
    await saveUserSettings(userId, { currentWorkspaceId: fallback.id });
  }

  return {
    ok: true,
    currentWorkspaceId: fallback?.id || null,
  };
}
