import { useRef, useState } from 'react';
import { apiJson } from '../api';
import type { Task } from '../types';

export function useTasksData() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedTaskLoading, setSelectedTaskLoading] = useState(false);
  const selectTaskRequestRef = useRef(0);

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
    nextTasks: Task[],
    preferredId?: string | null,
  ): string | null => {
    if (preferredId) {
      return nextTasks.find((task) => task.id === preferredId)?.id || nextTasks[0]?.id || null;
    }
    if (selectedTaskId) {
      return nextTasks.find((task) => task.id === selectedTaskId)?.id || nextTasks[0]?.id || null;
    }
    return nextTasks[0]?.id || null;
  };

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

  const applySelection = async (nextTasks: Task[], preferredId?: string | null) => {
    const nextId = resolveSelectedTaskId(nextTasks, preferredId);
    await selectTask(nextId);
  };

  const refreshTasksAndSelection = async (preferredTaskId?: string | null) => {
    const data = await fetchTasks();
    await applySelection(data, preferredTaskId);
  };

  const clearTasksData = () => {
    setTasks([]);
    setSelectedTaskId(null);
    setSelectedTask(null);
    setSelectedTaskLoading(false);
  };

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
