import { useCallback, useEffect } from 'react';
import type { AuthUser } from '@/entities/user';
import { useTasksData } from '@/entities/task';
import { useWorkspacesData } from '@/entities/workspace';
import { useSettingsData } from '@/entities/settings';
import { useLibraryData } from './useLibraryData';

export function useAppData(currentUser: AuthUser | null) {
  const workspacesData = useWorkspacesData();
  const tasksData = useTasksData();
  const libraryData = useLibraryData();
  const settingsData = useSettingsData();

  const {
    fetchWorkspaces: fetchWorkspacesHook,
    selectWorkspace: selectWorkspaceHook,
    clearWorkspacesData,
  } = workspacesData;
  const { fetchTasks, applySelection, clearTasksData } = tasksData;
  const {
    fetchNotebooks, fetchTags, fetchSummaryPrompts, clearLibraryData,
  } = libraryData;
  const {
    fetchCapabilities, fetchSettings, fetchProviderHealth, clearSettingsData,
  } = settingsData;

  const refreshAll = useCallback(async (preferredTaskId?: string | null) => {
    await fetchWorkspacesHook();
    const [data] = await Promise.all([
      fetchTasks(),
      fetchNotebooks(),
      fetchTags(),
      fetchSummaryPrompts(),
      fetchCapabilities(),
      fetchSettings(),
      fetchProviderHealth(),
    ]);

    await applySelection(data, preferredTaskId);
  }, [
    fetchWorkspacesHook, fetchTasks, fetchNotebooks, fetchTags, fetchSummaryPrompts,
    fetchCapabilities, fetchSettings, fetchProviderHealth, applySelection,
  ]);

  const clearAll = useCallback(() => {
    clearWorkspacesData();
    clearTasksData();
    clearLibraryData();
    clearSettingsData();
  }, [clearWorkspacesData, clearTasksData, clearLibraryData, clearSettingsData]);

  const selectWorkspace = useCallback(async (workspaceId: string, preferredTaskId?: string | null) => {
    await selectWorkspaceHook(workspaceId);
    await refreshAll(preferredTaskId);
  }, [selectWorkspaceHook, refreshAll]);

  // Refresh all data when user logs in
  useEffect(() => {
    if (!currentUser) {
      return;
    }

    void refreshAll();
  }, [currentUser, refreshAll]);

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
    fetchWorkspaces: fetchWorkspacesHook,
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
