import React, { Component, lazy, Suspense, useCallback, useMemo, useRef } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { BrowserRouter, Navigate, Routes, Route, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, FileAudio, Loader2, RefreshCw } from 'lucide-react';
import { cn } from './lib/utils';
import { storeUser } from './api';
import { useAuth } from './hooks/useAuth';
import { useAppData } from './hooks/useAppData';
import { useTaskPolling } from './hooks/useTaskPolling';
import { AuthProvider, useAuthContext } from './contexts/AuthContext';
import { AppDataProvider, useAppDataContext, type AppDataContextValue } from './contexts/AppDataContext';
import { AppShell } from './layouts/AppShell';
import { TaskDetail } from './components/TaskDetail';
import { Login } from './components/Login';

// --- Route-level code splitting: each page is loaded on demand ---
// This reduces the initial JS bundle significantly. Each lazy-loaded page becomes its own chunk.
const NotebookView = lazy(() => import('@/pages/notebook/ui/NotebookPage'));
const KnowledgeBase = lazy(() =>
  import('@/pages/knowledge/ui/KnowledgePage').then((m) => ({ default: m.KnowledgeBase })),
);
const UploadPage = lazy(() =>
  import('@/pages/upload/ui/UploadPage').then((m) => ({ default: m.UploadPage })),
);
const RecordPage = lazy(() =>
  import('@/pages/record/ui/RecordPage').then((m) => ({ default: m.RecordPage })),
);
const SettingsPage = lazy(() =>
  import('@/pages/settings/ui/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const SummaryPromptPage = lazy(() =>
  import('@/pages/prompts/ui/SummaryPromptPage').then((m) => ({ default: m.SummaryPromptPage })),
);

function RouteFallback() {
  return (
    <div className="flex-1 flex items-center justify-center text-slate-400">
      <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
    </div>
  );
}

// Backstop for chunk load failures that slip past the `vite:preloadError` auto-reload
// in main.tsx (e.g. offline, reload-loop guard triggered). Presents a recovery UI
// instead of letting the app blank out.
function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /ChunkLoadError/i.test(message)
  );
}

interface RouteErrorBoundaryState {
  error: unknown;
}

class RouteErrorBoundary extends Component<{ children: ReactNode }, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): RouteErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Route boundary caught error:', error, info.componentStack);
  }

  private handleRefresh = () => {
    window.location.reload();
  };

  private handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error == null) {
      return this.props.children;
    }

    const isChunkError = isChunkLoadError(this.state.error);
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-slate-500 p-8 text-center">
        <AlertTriangle className="w-10 h-10 mb-4 text-amber-500" />
        <h3 className="text-lg font-semibold text-slate-800">
          {isChunkError ? 'Update available' : 'Something went wrong'}
        </h3>
        <p className="text-sm mt-1 max-w-md">
          {isChunkError
            ? 'This page failed to load, likely because the app was updated since you opened it. Refresh to get the latest version.'
            : 'An unexpected error interrupted this view. You can retry, or refresh the page if the problem persists.'}
        </p>
        <div className="mt-6 flex gap-3">
          {!isChunkError && (
            <button
              type="button"
              onClick={this.handleRetry}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Retry
            </button>
          )}
          <button
            type="button"
            onClick={this.handleRefresh}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>
    );
  }
}

// --- Task panel layout (upload/record/tasks tabs share this) ---
// Mobile: Master-Detail — list hides when task selected, detail goes full-width with back button.
// Desktop: side-by-side grid (1/3 list + 2/3 detail).

function TaskPanelLayout({
  left,
  onMobileBack,
}: {
  left: React.ReactNode;
  onMobileBack?: () => void;
}) {
  const { selectedTask, selectedTaskLoading, selectTask, refreshTasksAndSelection, fetchTasks, fetchTags } = useAppDataContext();

  const handleMobileBack = () => {
    void selectTask(null);
    onMobileBack?.();
  };

  const handleUpdateTask = useCallback(async () => {
    if (!selectedTask) return;
    await refreshTasksAndSelection(selectedTask.id);
    await fetchTags();
  }, [selectedTask, refreshTasksAndSelection, fetchTags]);

  const handleDeleteTask = useCallback(async () => {
    await selectTask(null);
    await fetchTasks();
    await fetchTags();
  }, [selectTask, fetchTasks, fetchTags]);

  return (
    <div className="flex flex-col lg:grid lg:grid-cols-3 gap-6 h-full lg:overflow-hidden">
      {/* List panel — hidden on mobile when a task is selected */}
      <div className={cn(
        "lg:col-span-1 space-y-6 lg:overflow-y-auto pr-2 custom-scrollbar shrink-0",
        selectedTask ? "hidden lg:block" : "block"
      )}>
        {left}
      </div>

      {/* Detail panel — full-width on mobile when task selected */}
      <div className={cn(
        "lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full min-h-0 shrink-0",
        selectedTask ? "flex" : "hidden lg:flex"
      )}>
        {selectedTask ? (
          <>
            {/* Mobile back button */}
            <div className="lg:hidden flex items-center gap-3 px-4 py-3 border-b border-slate-200 bg-white shrink-0">
              <button
                onClick={handleMobileBack}
                className="p-1.5 -ml-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h2 className="text-sm font-semibold text-slate-900 truncate flex-1">
                {selectedTask.originalName}
              </h2>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <TaskDetail
                task={selectedTask}
                onUpdateTask={handleUpdateTask}
                onDeleteTask={handleDeleteTask}
              />
            </div>
          </>
        ) : selectedTaskLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center bg-slate-50/50">
            <Loader2 className="w-10 h-10 mb-4 animate-spin text-indigo-500" />
            <h3 className="text-lg font-medium text-slate-600">Loading task</h3>
            <p className="text-sm mt-1">Fetching transcript, segments, and summary details.</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center bg-slate-50/50">
            <FileAudio className="w-16 h-16 mb-4 opacity-20 text-indigo-500" />
            <h3 className="text-lg font-medium text-slate-600">No recording selected</h3>
            <p className="text-sm mt-1">Choose a recording to review transcript, speakers, summary, and chat.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Upload success handler ---

function UploadTabContent() {
  const navigate = useNavigate();
  const { refreshTasksAndSelection, fetchTags } = useAppDataContext();

  const handleUploadSuccess = useCallback(async (taskId?: string) => {
    await refreshTasksAndSelection(taskId);
    await fetchTags();
    if (taskId) navigate(`/notebook/${taskId}`);
  }, [refreshTasksAndSelection, fetchTags, navigate]);

  return (
    <TaskPanelLayout
      left={<UploadPage onUploadSuccess={handleUploadSuccess} />}
    />
  );
}

function RecordTabContent() {
  const navigate = useNavigate();
  const { refreshTasksAndSelection, fetchTags } = useAppDataContext();

  const handleUploadSuccess = useCallback(async (taskId?: string) => {
    await refreshTasksAndSelection(taskId);
    await fetchTags();
    if (taskId) navigate(`/notebook/${taskId}`);
  }, [refreshTasksAndSelection, fetchTags, navigate]);

  return (
    <TaskPanelLayout
      left={<RecordPage onUploadSuccess={handleUploadSuccess} />}
    />
  );
}

// --- Main app shell with routes ---

function AuthenticatedApp() {
  const { currentUser, handleLogout, setCurrentUser } = useAuthContext();
  const navigate = useNavigate();
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const { fetchSettings, fetchCapabilities, fetchProviderHealth } = useAppDataContext();

  const handleSelectKnowledgeTask = useCallback(
    (taskId: string, seekTo?: number) => {
      navigate(`/notebook/${taskId}${seekTo != null ? `?seekTo=${seekTo}` : ''}`);
    },
    [navigate],
  );

  const handleUserUpdated = useCallback(
    (user: Parameters<typeof setCurrentUser>[0]) => {
      if (user) storeUser(user);
      setCurrentUser(user);
    },
    [setCurrentUser],
  );

  const handleSettingsSaved = useCallback(async () => {
    await fetchSettings();
    await fetchCapabilities();
    await fetchProviderHealth();
  }, [fetchSettings, fetchCapabilities, fetchProviderHealth]);

  return (
    <AppShell
      currentUser={currentUser}
      onLogout={() => void handleLogout()}
      mainScrollRef={mainScrollRef}
    >
      <RouteErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Navigate to="/notebook" replace />} />
            <Route path="/notebook/:id?" element={<NotebookView />} />
            <Route
              path="/knowledge"
              element={<KnowledgeBase onSelectTask={handleSelectKnowledgeTask} />}
            />
            <Route path="/upload" element={<UploadTabContent />} />
            <Route path="/record" element={<RecordTabContent />} />
            <Route path="/tasks" element={<Navigate to="/notebook" replace />} />
            <Route path="/tasks/:id" element={<TasksRedirect />} />
            <Route path="/prompts" element={
              <div className="h-full pb-6"><SummaryPromptPage /></div>
            } />
            <Route path="/settings" element={
              <div className="h-full pb-6">
                <SettingsPage
                  onLogout={() => void handleLogout()}
                  onUserUpdated={handleUserUpdated}
                  onSettingsSaved={handleSettingsSaved}
                />
              </div>
            } />
          </Routes>
        </Suspense>
      </RouteErrorBoundary>
    </AppShell>
  );
}

function TasksRedirect() {
  const { id } = useParams<{ id?: string }>();

  return <Navigate to={id ? `/notebook/${id}` : '/notebook'} replace />;
}

// --- Root: handles auth loading, login, then delegates to routes ---

function AppRoot() {
  const { pathname } = useLocation();
  const auth = useAuth();
  const { authLoading, currentUser, publicConfig, setCurrentUser, handleLogout: authLogout } = auth;
  const appData = useAppData(currentUser);
  const {
    workspaces, currentWorkspaceId, currentWorkspace,
    tasks, notebooks, tags, summaryPrompts, capabilities, userSettings, providerHealth,
    selectedTaskId, selectTask, selectedTask, selectedTaskLoading,
    fetchWorkspaces, selectWorkspace, fetchTasks, fetchNotebooks, fetchTags, fetchSummaryPrompts,
    fetchCapabilities, fetchSettings, fetchProviderHealth,
    refreshTasksAndSelection, refreshAll, clearAll,
  } = appData;
  const isNotebookDetailRoute = pathname.startsWith('/notebook/');
  const isNotebookListRoute = pathname === '/notebook';
  useTaskPolling(
    currentUser,
    tasks,
    selectedTaskId,
    selectedTask,
    {
      pollList: isNotebookListRoute,
      pollDetail: isNotebookDetailRoute,
    },
    fetchTasks,
    appData.fetchTaskDetail,
  );

  const handleLogout = useCallback(async () => {
    await authLogout();
    clearAll();
  }, [authLogout, clearAll]);

  const authContextValue = useMemo(
    () => ({ currentUser: currentUser!, handleLogout, setCurrentUser }),
    [currentUser, handleLogout, setCurrentUser],
  );

  const appDataContextValue = useMemo<AppDataContextValue>(
    () => ({
      workspaces, currentWorkspaceId, currentWorkspace,
      tasks, notebooks, tags, summaryPrompts, capabilities, userSettings, providerHealth,
      selectedTaskId, selectTask, selectedTask, selectedTaskLoading,
      fetchWorkspaces, selectWorkspace, fetchTasks, fetchTaskDetail: appData.fetchTaskDetail,
      fetchNotebooks, fetchTags, fetchSummaryPrompts, fetchCapabilities, fetchSettings,
      fetchProviderHealth, refreshTasksAndSelection, refreshAll, clearAll,
    }),
    [
      workspaces, currentWorkspaceId, currentWorkspace,
      tasks, notebooks, tags, summaryPrompts, capabilities, userSettings, providerHealth,
      selectedTaskId, selectTask, selectedTask, selectedTaskLoading,
      fetchWorkspaces, selectWorkspace, fetchTasks, appData.fetchTaskDetail,
      fetchNotebooks, fetchTags, fetchSummaryPrompts, fetchCapabilities, fetchSettings,
      fetchProviderHealth, refreshTasksAndSelection, refreshAll, clearAll,
    ],
  );

  if (authLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-slate-50 text-slate-500">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
          Loading workspace...
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <Login onLogin={setCurrentUser} allowRegistration={publicConfig.auth.allowRegistration} />;
  }

  return (
    <AuthProvider value={authContextValue}>
    <AppDataProvider value={appDataContextValue}>
      <AuthenticatedApp />
    </AppDataProvider>
    </AuthProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoot />
    </BrowserRouter>
  );
}
