import { useCallback, useRef, useState } from 'react';
import { apiJson } from '@/shared/api/base';
import type { Task } from './types';

export function useTasksData() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedTaskLoading, setSelectedTaskLoading] = useState(false);
  const selectTaskRequestRef = useRef(0);
  const selectedTaskIdRef = useRef<string | null>(null);

  selectedTaskIdRef.current = selectedTaskId;

  const fetchTaskDetail = useCallback(async (taskId: string) => {
    const data = await apiJson<Task>(`/api/tasks/${taskId}`);
    setSelectedTask(data);
    return data;
  }, []);

  const fetchTasks = useCallback(async () => {
    const data = await apiJson<Task[]>('/api/tasks');
    setTasks(data);
    return data;
  }, []);

  const selectTask = useCallback(async (taskId: string | null) => {
    const requestId = ++selectTaskRequestRef.current;

    setSelectedTaskId(taskId);
    if (!taskId) {
      setSelectedTask(null);
      setSelectedTaskLoading(false);
      return null;
    }

    setSelectedTask((current) => (current?.id === taskId ? current : null));
    setSelectedTaskLoading(true);

    try {
      const task = await apiJson<Task>(`/api/tasks/${taskId}`);
      if (requestId === selectTaskRequestRef.current) {
        setSelectedTask(task);
      }
      return task;
    } catch (error) {
      if (requestId === selectTaskRequestRef.current) {
        console.error('Failed to load selected task:', error);
        setSelectedTask(null);
      }
      return null;
    } finally {
      if (requestId === selectTaskRequestRef.current) {
        setSelectedTaskLoading(false);
      }
    }
  }, []);

  const applySelection = useCallback(async (nextTasks: Task[], preferredId?: string | null) => {
    // During initial app bootstrap we may refresh the task list before route-driven
    // selection has been restored. In that case, avoid issuing selectTask(null),
    // which would erase the route's in-flight selection.
    if (preferredId == null && selectedTaskIdRef.current == null) {
      return;
    }

    // Explicitly requested a specific task (e.g. after upload)
    let nextId: string | null;
    if (preferredId) {
      nextId = nextTasks.find((task) => task.id === preferredId)?.id || null;
    } else if (selectedTaskIdRef.current) {
      nextId = nextTasks.find((task) => task.id === selectedTaskIdRef.current)?.id || null;
    } else {
      nextId = null;
    }

    await selectTask(nextId);
  }, [selectTask]);

  const refreshTasksAndSelection = useCallback(async (preferredTaskId?: string | null) => {
    const data = await fetchTasks();
    await applySelection(data, preferredTaskId);
  }, [fetchTasks, applySelection]);

  const clearTasksData = useCallback(() => {
    setTasks([]);
    setSelectedTaskId(null);
    setSelectedTask(null);
    setSelectedTaskLoading(false);
  }, []);

  return {
    tasks,
    selectedTaskId,
    selectedTask,
    selectedTaskLoading,
    fetchTaskDetail,
    fetchTasks,
    selectTask,
    applySelection,
    refreshTasksAndSelection,
    clearTasksData,
  };
}
