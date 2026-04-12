import { useEffect } from 'react';
import type {
  AuthUser,
} from '../types';
import { useLibraryData } from './useLibraryData';
import { useSettingsData } from './useSettingsData';
import { useTasksData } from './useTasksData';
import { useWorkspacesData } from './useWorkspacesData';

export function useAppData(currentUser: AuthUser | null) {
  const workspacesData = useWorkspacesData();
  const tasksData = useTasksData();
  const libraryData = useLibraryData();
  const settingsData = useSettingsData();

  const refreshAll = async (preferredTaskId?: string | null) => {
    await workspacesData.fetchWorkspaces();
    const [data] = await Promise.all([
      tasksData.fetchTasks(),
      libraryData.fetchNotebooks(),
      libraryData.fetchTags(),
      libraryData.fetchSummaryPrompts(),
      settingsData.fetchCapabilities(),
      settingsData.fetchSettings(),
      settingsData.fetchProviderHealth(),
    ]);

    await tasksData.applySelection(data, preferredTaskId);
  };

  const clearAll = () => {
    workspacesData.clearWorkspacesData();
    tasksData.clearTasksData();
    libraryData.clearLibraryData();
    settingsData.clearSettingsData();
  };

  const selectWorkspace = async (workspaceId: string, preferredTaskId?: string | null) => {
    await workspacesData.selectWorkspace(workspaceId);
    await refreshAll(preferredTaskId);
  };

  // Refresh all data when user logs in
  useEffect(() => {
    if (!currentUser) {
      return;
    }

    void refreshAll();
  }, [currentUser]);

  return {
    workspaces: workspacesData.workspaces,
    currentWorkspaceId: workspacesData.currentWorkspaceId,
    currentWorkspace: workspacesData.currentWorkspace,
    tasks: tasksData.tasks,
    notebooks: libraryData.notebooks,
    tags: libraryData.tags,
    summaryPrompts: libraryData.summaryPrompts,
    capabilities: settingsData.capabilities,
    userSettings: settingsData.userSettings,
    providerHealth: settingsData.providerHealth,
    selectedTaskId: tasksData.selectedTaskId,
    selectTask: tasksData.selectTask,
    selectedTask: tasksData.selectedTask,
    selectedTaskLoading: tasksData.selectedTaskLoading,
    fetchWorkspaces: workspacesData.fetchWorkspaces,
    selectWorkspace,
    fetchTasks: tasksData.fetchTasks,
    fetchTaskDetail: tasksData.fetchTaskDetail,
    fetchNotebooks: libraryData.fetchNotebooks,
    fetchTags: libraryData.fetchTags,
    fetchSummaryPrompts: libraryData.fetchSummaryPrompts,
    fetchCapabilities: settingsData.fetchCapabilities,
    fetchSettings: settingsData.fetchSettings,
    fetchProviderHealth: settingsData.fetchProviderHealth,
    refreshTasksAndSelection: tasksData.refreshTasksAndSelection,
    refreshAll,
    clearAll,
  };
}
