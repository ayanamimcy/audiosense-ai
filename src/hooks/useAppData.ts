import { useEffect, useState } from 'react';
import { apiJson } from '../api';
import type {
  AppCapabilities,
  AuthUser,
  Notebook,
  ProviderHealth,
  SummaryPrompt,
  TagStat,
  Task,
  UserSettings,
} from '../types';

export function useAppData(currentUser: AuthUser | null) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [tags, setTags] = useState<TagStat[]>([]);
  const [summaryPrompts, setSummaryPrompts] = useState<SummaryPrompt[]>([]);
  const [capabilities, setCapabilities] = useState<AppCapabilities | null>(null);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [providerHealth, setProviderHealth] = useState<ProviderHealth[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedTaskLoading, setSelectedTaskLoading] = useState(false);

  const fetchTaskDetail = async (taskId: string) => {
    const data = await apiJson<Task>(`/api/tasks/${taskId}`);
    setSelectedTask(data);
    return data;
  };

  const fetchTasks = async () => {
    const data = await apiJson<Task[]>('/api/tasks');
    setTasks(data);
    return data;
  };

  const resolveSelectedTaskId = (
    tasks: Task[],
    preferredId?: string | null,
  ): string | null => {
    if (preferredId) {
      return tasks.find((task) => task.id === preferredId)?.id || tasks[0]?.id || null;
    }
    if (selectedTaskId) {
      return tasks.find((task) => task.id === selectedTaskId)?.id || tasks[0]?.id || null;
    }
    return tasks[0]?.id || null;
  };

  const applySelection = async (tasks: Task[], preferredId?: string | null) => {
    const nextId = resolveSelectedTaskId(tasks, preferredId);
    await selectTask(nextId);
  };

  const fetchNotebooks = async () => {
    setNotebooks(await apiJson<Notebook[]>('/api/notebooks'));
  };

  const fetchTags = async () => {
    setTags(await apiJson<TagStat[]>('/api/tags'));
  };

  const fetchSummaryPrompts = async () => {
    setSummaryPrompts(await apiJson<SummaryPrompt[]>('/api/summary-prompts'));
  };

  const fetchCapabilities = async () => {
    setCapabilities(await apiJson<AppCapabilities>('/api/capabilities'));
  };

  const fetchSettings = async () => {
    const payload = await apiJson<{ settings: UserSettings }>('/api/settings');
    setUserSettings(payload.settings);
  };

  const fetchProviderHealth = async () => {
    setProviderHealth(await apiJson<ProviderHealth[]>('/api/provider-health'));
  };

  const refreshTasksAndSelection = async (preferredTaskId?: string | null) => {
    const data = await fetchTasks();
    await applySelection(data, preferredTaskId);
  };

  const refreshAll = async (preferredTaskId?: string | null) => {
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
  };

  const clearAll = () => {
    setTasks([]);
    setNotebooks([]);
    setTags([]);
    setSummaryPrompts([]);
    setCapabilities(null);
    setUserSettings(null);
    setProviderHealth([]);
    setSelectedTaskId(null);
    setSelectedTask(null);
  };

  const selectTaskRequestRef = { current: 0 };

  const selectTask = async (taskId: string | null) => {
    const requestId = ++selectTaskRequestRef.current;

    setSelectedTaskId(taskId);

    if (!taskId) {
      setSelectedTask(null);
      setSelectedTaskLoading(false);
      return;
    }

    setSelectedTask((current) => (current?.id === taskId ? current : null));
    setSelectedTaskLoading(true);

    try {
      const task = await apiJson<Task>(`/api/tasks/${taskId}`);
      if (requestId === selectTaskRequestRef.current) {
        setSelectedTask(task);
      }
    } catch (error) {
      if (requestId === selectTaskRequestRef.current) {
        console.error('Failed to load selected task:', error);
        setSelectedTask(null);
      }
    } finally {
      if (requestId === selectTaskRequestRef.current) {
        setSelectedTaskLoading(false);
      }
    }
  };

  // Refresh all data when user logs in
  useEffect(() => {
    if (!currentUser) {
      return;
    }

    void refreshAll();
  }, [currentUser]);

  return {
    tasks,
    notebooks,
    tags,
    summaryPrompts,
    capabilities,
    userSettings,
    providerHealth,
    selectedTaskId,
    selectTask,
    selectedTask,
    selectedTaskLoading,
    fetchTasks,
    fetchTaskDetail,
    fetchNotebooks,
    fetchTags,
    fetchSummaryPrompts,
    fetchCapabilities,
    fetchSettings,
    fetchProviderHealth,
    refreshTasksAndSelection,
    refreshAll,
    clearAll,
  };
}
