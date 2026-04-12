import { createContext, useContext } from 'react';
import type {
  AppCapabilities,
  Notebook,
  ProviderHealth,
  SummaryPrompt,
  TagStat,
  Task,
  UserSettings,
  Workspace,
} from '../types';

export interface AppDataContextValue {
  workspaces: Workspace[];
  currentWorkspaceId: string | null;
  currentWorkspace: Workspace | null;
  tasks: Task[];
  notebooks: Notebook[];
  tags: TagStat[];
  summaryPrompts: SummaryPrompt[];
  capabilities: AppCapabilities | null;
  userSettings: UserSettings | null;
  providerHealth: ProviderHealth[];
  selectedTaskId: string | null;
  selectTask: (taskId: string | null) => Promise<Task | null>;
  selectedTask: Task | null;
  selectedTaskLoading: boolean;
  fetchWorkspaces: () => Promise<{ workspaces: Workspace[]; currentWorkspaceId: string }>;
  selectWorkspace: (workspaceId: string, preferredTaskId?: string | null) => Promise<void>;
  fetchTasks: () => Promise<Task[]>;
  fetchTaskDetail: (taskId: string) => Promise<Task>;
  fetchNotebooks: () => Promise<void>;
  fetchTags: () => Promise<void>;
  fetchSummaryPrompts: () => Promise<void>;
  fetchCapabilities: () => Promise<void>;
  fetchSettings: () => Promise<void>;
  fetchProviderHealth: () => Promise<void>;
  refreshTasksAndSelection: (preferredTaskId?: string | null) => Promise<void>;
  refreshAll: (preferredTaskId?: string | null) => Promise<void>;
  clearAll: () => void;
}

const AppDataContext = createContext<AppDataContextValue | null>(null);

export function AppDataProvider({ value, children }: { value: AppDataContextValue; children: React.ReactNode }) {
  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppDataContext() {
  const ctx = useContext(AppDataContext);
  if (!ctx) {
    throw new Error('useAppDataContext must be used within an AppDataProvider');
  }
  return ctx;
}
