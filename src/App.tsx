import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { BrowserRouter, Navigate, Routes, Route, useLocation, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { AppDataProvider, useAppDataContext, type AppDataContextValue } from '@/app/providers/app-data-context';
import { useAppData } from '@/app/providers/useAppData';
import { AuthProvider, LoginForm, storeUser, useAuth, useAuthContext } from '@/features/auth';
import { NewRecordingProvider, useNewRecording, type NewRecordingMode } from '@/features/new-recording';
import { LOGOUT_DESTINATION, RecordingDraftProvider } from '@/features/recording-draft/model/recording-draft-context';
import { useTaskPolling } from '@/features/task-polling';
import { AppShell, canLeaveCurrentPage } from '@/widgets/app-shell/ui';

// --- Route-level code splitting: each page is loaded on demand ---
// This reduces the initial JS bundle significantly. Each lazy-loaded page becomes its own chunk.
const NotebookView = lazy(() => import('@/pages/notebook/ui/NotebookPage'));
const KnowledgeBase = lazy(() =>
  import('@/pages/knowledge/ui/KnowledgePage').then((m) => ({ default: m.KnowledgeBase })),
);
const SettingsPage = lazy(() =>
  import('@/pages/settings/ui/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);

function RouteFallback() {
  return (
    <div className="flex-1 flex items-center justify-center text-stone-400">
      <Loader2 className="w-6 h-6 animate-spin text-stone-400" />
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
      <div className="flex-1 flex flex-col items-center justify-center text-stone-500 p-8 text-center">
        <AlertTriangle className="w-10 h-10 mb-4 text-amber-500" />
        <h3 className="text-lg font-semibold text-stone-800">
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
              className="px-4 py-2 text-sm font-medium text-stone-700 bg-white border border-stone-200 rounded-lg hover:bg-stone-50 transition-colors"
            >
              Retry
            </button>
          )}
          <button
            type="button"
            onClick={this.handleRefresh}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-stone-900 rounded-lg hover:bg-stone-800 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>
    );
  }
}

// Old /upload and /record links open the New recording dialog over the recordings list.
function OpenNewRecordingRoute({ mode }: { mode: NewRecordingMode }) {
  const { openNewRecording } = useNewRecording();
  useEffect(() => {
    openNewRecording(mode);
  }, [mode, openNewRecording]);
  return <Navigate to="/notebook" replace />;
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

  // A recording waiting to upload lives only in this tab; let it warn before signing out.
  const guardedLogout = useCallback(() => {
    if (canLeaveCurrentPage(LOGOUT_DESTINATION)) {
      void handleLogout();
    }
  }, [handleLogout]);

  const handleSettingsSaved = useCallback(async () => {
    await fetchSettings();
    await fetchCapabilities();
    await fetchProviderHealth();
  }, [fetchSettings, fetchCapabilities, fetchProviderHealth]);

  return (
    <AppShell
      currentUser={currentUser}
      onLogout={guardedLogout}
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
            <Route path="/upload" element={<OpenNewRecordingRoute mode="upload" />} />
            <Route path="/record" element={<OpenNewRecordingRoute mode="record" />} />
            <Route path="/tasks" element={<Navigate to="/notebook" replace />} />
            <Route path="/tasks/:id" element={<TasksRedirect />} />
            <Route path="/prompts" element={<Navigate to="/settings?section=templates" replace />} />
            <Route
              path="/settings"
              element={(
                <SettingsPage
                  onLogout={guardedLogout}
                  onUserUpdated={handleUserUpdated}
                  onSettingsSaved={handleSettingsSaved}
                />
              )}
            />
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
  // The list stays visible next to the detail on desktop, so poll it on every /notebook route.
  const isNotebookListRoute = pathname.startsWith('/notebook');
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
      <div className="min-h-[100dvh] flex items-center justify-center bg-canvas text-stone-500">
        <div className="flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-stone-500" />
          Loading workspace...
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <LoginForm onLogin={setCurrentUser} allowRegistration={publicConfig.auth.allowRegistration} />;
  }

  return (
    <AuthProvider value={authContextValue}>
      <AppDataProvider value={appDataContextValue}>
        <RecordingDraftProvider>
          <NewRecordingProvider>
            <AuthenticatedApp />
          </NewRecordingProvider>
        </RecordingDraftProvider>
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
