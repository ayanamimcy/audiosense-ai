import React, { useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useParams } from 'react-router-dom';
import { FileAudio, Loader2 } from 'lucide-react';
import { storeUser } from './api';
import { useAuth } from './hooks/useAuth';
import { useAppData } from './hooks/useAppData';
import { useTaskPolling } from './hooks/useTaskPolling';
import { AuthProvider, useAuthContext } from './contexts/AuthContext';
import { AppDataProvider, useAppDataContext, type AppDataContextValue } from './contexts/AppDataContext';
import { AppShell } from './layouts/AppShell';
import { UploadPage } from './pages/UploadPage';
import { RecordPage } from './pages/RecordPage';
import { TasksPage } from './pages/TasksPage';
import { SettingsPage } from './pages/SettingsPage';
import { KnowledgeBase } from './KnowledgeBase';
import NotebookView from './Notebook';
import { SummaryPromptPage } from './SummaryPromptPage';
import { TaskDetail } from './components/TaskDetail';
import { Login } from './components/Login';

// --- Task panel layout (upload/record/tasks tabs share this) ---

function TaskPanelLayout({ left }: { left: React.ReactNode }) {
  const navigate = useNavigate();
  const { selectedTask, selectedTaskLoading, refreshTasksAndSelection, fetchTags } = useAppDataContext();

  return (
    <div className="flex flex-col lg:grid lg:grid-cols-3 gap-6 h-full lg:overflow-hidden">
      <div className="lg:col-span-1 space-y-6 lg:overflow-y-auto pr-2 custom-scrollbar shrink-0">
        {left}
      </div>

      <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col lg:h-full min-h-[500px] shrink-0">
        {selectedTask ? (
          <TaskDetail
            task={selectedTask}
            onUpdateTask={async () => {
              await refreshTasksAndSelection(selectedTask.id);
              await fetchTags();
            }}
          />
        ) : selectedTaskLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center bg-slate-50/50">
            <Loader2 className="w-10 h-10 mb-4 animate-spin text-indigo-500" />
            <h3 className="text-lg font-medium text-slate-600">Loading task</h3>
            <p className="text-sm mt-1">Fetching transcript, segments, and summary details.</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center bg-slate-50/50">
            <FileAudio className="w-16 h-16 mb-4 opacity-20 text-indigo-500" />
            <h3 className="text-lg font-medium text-slate-600">No task selected</h3>
            <p className="text-sm mt-1">Choose an audio task to review transcript, speakers, summary, and chat.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Route-aware task detail page for /tasks/:id ---

function TasksRouteSync() {
  const { id } = useParams<{ id: string }>();
  const { selectTask } = useAppDataContext();

  useEffect(() => {
    if (id) {
      void selectTask(id);
    }
  }, [id]);

  return null;
}

// --- Upload success handler ---

function UploadTabContent() {
  const navigate = useNavigate();
  const { refreshTasksAndSelection, fetchTags } = useAppDataContext();

  return (
    <TaskPanelLayout
      left={
        <UploadPage
          onUploadSuccess={async (taskId) => {
            await refreshTasksAndSelection(taskId);
            await fetchTags();
            if (taskId) navigate(`/tasks/${taskId}`);
          }}
        />
      }
    />
  );
}

function RecordTabContent() {
  const navigate = useNavigate();
  const { refreshTasksAndSelection, fetchTags } = useAppDataContext();

  return (
    <TaskPanelLayout
      left={
        <RecordPage
          onUploadSuccess={async (taskId) => {
            await refreshTasksAndSelection(taskId);
            await fetchTags();
            if (taskId) navigate(`/tasks/${taskId}`);
          }}
        />
      }
    />
  );
}

function TasksTabContent() {
  const navigate = useNavigate();
  const { refreshTasksAndSelection, selectedTaskId } = useAppDataContext();

  return (
    <>
      <TasksRouteSync />
      <TaskPanelLayout
        left={
          <TasksPage
            onSelectTask={(taskId) => navigate(`/tasks/${taskId}`)}
            onRefresh={() => refreshTasksAndSelection(selectedTaskId)}
          />
        }
      />
    </>
  );
}

// --- Main app shell with routes ---

function AuthenticatedApp() {
  const { currentUser, handleLogout, setCurrentUser } = useAuthContext();
  const navigate = useNavigate();
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const { fetchSettings, fetchCapabilities, fetchProviderHealth } = useAppDataContext();

  return (
    <AppShell
      currentUser={currentUser}
      onLogout={() => void handleLogout()}
      mainScrollRef={mainScrollRef}
    >
      <Routes>
        <Route path="/" element={
          <NotebookView onSelectTask={(taskId) => navigate(`/tasks/${taskId}`)} />
        } />
        <Route path="/notebook" element={
          <NotebookView onSelectTask={(taskId) => navigate(`/tasks/${taskId}`)} />
        } />
        <Route path="/knowledge" element={
          <KnowledgeBase onSelectTask={(taskId) => navigate(`/tasks/${taskId}`)} />
        } />
        <Route path="/upload" element={<UploadTabContent />} />
        <Route path="/record" element={<RecordTabContent />} />
        <Route path="/tasks" element={<TasksTabContent />} />
        <Route path="/tasks/:id" element={<TasksTabContent />} />
        <Route path="/prompts" element={
          <div className="h-full pb-6"><SummaryPromptPage /></div>
        } />
        <Route path="/settings" element={
          <div className="h-full pb-6">
            <SettingsPage
              onLogout={() => void handleLogout()}
              onUserUpdated={(user) => {
                storeUser(user);
                setCurrentUser(user);
              }}
              onSettingsSaved={async () => {
                await fetchSettings();
                await fetchCapabilities();
                await fetchProviderHealth();
              }}
            />
          </div>
        } />
      </Routes>
    </AppShell>
  );
}

// --- Root: handles auth loading, login, then delegates to routes ---

function AppRoot() {
  const auth = useAuth();
  const { authLoading, currentUser, publicConfig, setCurrentUser, handleLogout: authLogout } = auth;
  const appData = useAppData(currentUser);
  const {
    tasks, notebooks, tags, summaryPrompts, capabilities, userSettings, providerHealth,
    selectedTaskId, selectTask, selectedTask, selectedTaskLoading,
    fetchTasks, fetchNotebooks, fetchTags, fetchSummaryPrompts,
    fetchCapabilities, fetchSettings, fetchProviderHealth,
    refreshTasksAndSelection, refreshAll, clearAll,
  } = appData;
  useTaskPolling(currentUser, tasks, selectedTaskId, refreshTasksAndSelection);

  const handleLogout = async () => {
    await authLogout();
    clearAll();
  };

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

  const authContextValue = { currentUser, handleLogout, setCurrentUser };
  const appDataContextValue: AppDataContextValue = {
    tasks, notebooks, tags, summaryPrompts, capabilities, userSettings, providerHealth,
    selectedTaskId, selectTask, selectedTask, selectedTaskLoading,
    fetchTasks, fetchTaskDetail: appData.fetchTaskDetail, fetchNotebooks, fetchTags,
    fetchSummaryPrompts, fetchCapabilities, fetchSettings, fetchProviderHealth,
    refreshTasksAndSelection, refreshAll,
  };

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
