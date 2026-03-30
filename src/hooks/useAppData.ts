import { useEffect } from 'react';
import type {
  AuthUser,
} from '../types';
import { useLibraryData } from './useLibraryData';
import { useSettingsData } from './useSettingsData';
import { useTasksData } from './useTasksData';

export function useAppData(currentUser: AuthUser | null) {
  const tasksData = useTasksData();
  const libraryData = useLibraryData();
  const settingsData = useSettingsData();

  const refreshAll = async (preferredTaskId?: string | null) => {
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
    tasksData.clearTasksData();
    libraryData.clearLibraryData();
    settingsData.clearSettingsData();
  };

  // Refresh all data when user logs in
  useEffect(() => {
    if (!currentUser) {
      return;
    }

    void refreshAll();
  }, [currentUser]);

  return {
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
