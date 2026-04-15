import { useCallback, useMemo, useState } from 'react';
import { apiJson } from '@/shared/api/base';
import type { Workspace } from './types';

interface WorkspaceListResponse {
  workspaces: Workspace[];
  currentWorkspaceId: string;
}

function sortWorkspaces(items: Workspace[]) {
  return [...items].sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt);
}

export function useWorkspacesData() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null);

  const fetchWorkspaces = useCallback(async () => {
    const payload = await apiJson<WorkspaceListResponse>('/api/workspaces');
    setWorkspaces(sortWorkspaces(payload.workspaces));
    setCurrentWorkspaceId(payload.currentWorkspaceId || null);
    return payload;
  }, []);

  const selectWorkspace = useCallback(async (workspaceId: string) => {
    const payload = await apiJson<WorkspaceListResponse>('/api/workspaces/current', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId }),
    });
    setWorkspaces(sortWorkspaces(payload.workspaces));
    setCurrentWorkspaceId(payload.currentWorkspaceId || null);
    return payload;
  }, []);

  const createWorkspace = useCallback(async (input: {
    name: string;
    description?: string | null;
    color?: string | null;
  }) => {
    const workspace = await apiJson<Workspace>('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    setWorkspaces((current) => sortWorkspaces([workspace, ...current.filter((item) => item.id !== workspace.id)]));
    return workspace;
  }, []);

  const updateWorkspace = useCallback(async (
    workspaceId: string,
    input: { name?: string; description?: string | null; color?: string | null },
  ) => {
    const workspace = await apiJson<Workspace>(`/api/workspaces/${workspaceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    setWorkspaces((current) =>
      sortWorkspaces(current.map((item) => (item.id === workspace.id ? workspace : item))),
    );
    return workspace;
  }, []);

  const deleteWorkspace = useCallback(async (workspaceId: string) => {
    const payload = await apiJson<{ ok: boolean; currentWorkspaceId: string | null }>(
      `/api/workspaces/${workspaceId}`,
      { method: 'DELETE' },
    );
    setWorkspaces((current) => current.filter((item) => item.id !== workspaceId));
    setCurrentWorkspaceId(payload.currentWorkspaceId || null);
    return payload;
  }, []);

  const currentWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === currentWorkspaceId) || null,
    [workspaces, currentWorkspaceId],
  );

  const clearWorkspacesData = useCallback(() => {
    setWorkspaces([]);
    setCurrentWorkspaceId(null);
  }, []);

  return {
    workspaces,
    currentWorkspaceId,
    currentWorkspace,
    fetchWorkspaces,
    selectWorkspace,
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,
    clearWorkspacesData,
  };
}
