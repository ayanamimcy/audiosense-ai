import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, FileAudio, Loader2 } from 'lucide-react';
import { storeUser } from './api';
import { cn } from './lib/utils';
import { useAuth } from './hooks/useAuth';
import { useAppData } from './hooks/useAppData';
import { useTaskPolling } from './hooks/useTaskPolling';
import { AuthProvider } from './contexts/AuthContext';
import { AppDataProvider } from './contexts/AppDataContext';
import { AppShell, type Tab } from './layouts/AppShell';
import { UploadPage } from './pages/UploadPage';
import { RecordPage } from './pages/RecordPage';
import { TasksPage } from './pages/TasksPage';
import { SettingsPage } from './pages/SettingsPage';
import { KnowledgeBase } from './KnowledgeBase';
import NotebookView from './Notebook';
import { SummaryPromptPage } from './SummaryPromptPage';
import { TaskDetail } from './components/TaskDetail';
import { Login } from './components/Login';

export default function App() {
  const { authLoading, currentUser, publicConfig, setCurrentUser, handleLogout: authLogout } = useAuth();
  const appData = useAppData(currentUser);
  const {
    tasks, notebooks, tags, summaryPrompts, capabilities, userSettings, providerHealth,
    selectedTaskId, selectTask, selectedTask, selectedTaskLoading,
    fetchTasks, fetchNotebooks, fetchTags, fetchSummaryPrompts,
    fetchCapabilities, fetchSettings, fetchProviderHealth,
    refreshTasksAndSelection, refreshAll, clearAll,
  } = appData;
  useTaskPolling(currentUser, tasks, selectedTaskId, refreshTasksAndSelection);

  const [activeTab, setActiveTab] = useState<Tab>('notebook');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [mobileTaskView, setMobileTaskView] = useState<'list' | 'detail'>('list');
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const mobileTaskListScrollTopRef = useRef(0);
  const pendingMobileTaskScrollRestoreRef = useRef<number | null>(null);

  const openTaskDetail = (taskId: string) => {
    if (activeTab === 'tasks' && mobileTaskView === 'list') {
      mobileTaskListScrollTopRef.current = mainScrollRef.current?.scrollTop ?? 0;
    } else if (activeTab !== 'tasks') {
      mobileTaskListScrollTopRef.current = 0;
    }

    void selectTask(taskId);
    setActiveTab('tasks');
    setMobileTaskView('detail');
    setIsMobileMenuOpen(false);
  };

  const showTasksList = () => {
    pendingMobileTaskScrollRestoreRef.current = mobileTaskListScrollTopRef.current;
    setMobileTaskView('list');
  };

  const openTasksTab = () => {
    pendingMobileTaskScrollRestoreRef.current = mobileTaskListScrollTopRef.current;
    setMobileTaskView('list');
    setActiveTab('tasks');
    setIsMobileMenuOpen(false);
  };

  const handleLogout = async () => {
    await authLogout();
    clearAll();
  };

  useEffect(() => {
    if (activeTab !== 'tasks') {
      return;
    }

    const container = mainScrollRef.current;
    if (!container) {
      return;
    }

    if (mobileTaskView === 'detail') {
      container.scrollTop = 0;
      return;
    }

    if (pendingMobileTaskScrollRestoreRef.current !== null) {
      container.scrollTop = pendingMobileTaskScrollRestoreRef.current;
      pendingMobileTaskScrollRestoreRef.current = null;
    }
  }, [activeTab, mobileTaskView]);

  useEffect(() => {
    if (activeTab === 'tasks' && mobileTaskView === 'detail' && !selectedTaskId) {
      setMobileTaskView('list');
    }
  }, [activeTab, mobileTaskView, selectedTaskId]);

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
  const appDataContextValue = {
    tasks, notebooks, tags, summaryPrompts, capabilities, userSettings, providerHealth,
    selectedTaskId, selectTask, selectedTask, selectedTaskLoading,
    fetchTasks, fetchTaskDetail: appData.fetchTaskDetail, fetchNotebooks, fetchTags,
    fetchSummaryPrompts, fetchCapabilities, fetchSettings, fetchProviderHealth,
    refreshTasksAndSelection, refreshAll,
  };

  return (
    <AuthProvider value={authContextValue}>
    <AppDataProvider value={appDataContextValue}>
    <AppShell
      currentUser={currentUser}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onLogout={() => void handleLogout()}
      isMobileMenuOpen={isMobileMenuOpen}
      onMobileMenuChange={setIsMobileMenuOpen}
      onOpenTasksTab={openTasksTab}
      mainScrollRef={mainScrollRef}
    >
      {activeTab === 'notebook' ? (
        <NotebookView
          tasks={tasks}
          notebooks={notebooks}
          tags={tags}
          onSelectTask={openTaskDetail}
          onUpdateNotebooks={fetchNotebooks}
          onUpdateTasks={async () => {
            await fetchTasks();
            await fetchTags();
          }}
        />
      ) : activeTab === 'knowledge' ? (
        <KnowledgeBase
          tasks={tasks}
          notebooks={notebooks}
          userSettings={userSettings}
          onSelectTask={openTaskDetail}
        />
      ) : activeTab === 'settings' ? (
        <div className="h-full pb-6">
          <SettingsPage
            onLogout={handleLogout}
            currentUser={currentUser}
            capabilities={capabilities}
            userSettings={userSettings}
            providerHealth={providerHealth}
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
      ) : activeTab === 'prompts' ? (
        <div className="h-full pb-6">
          <SummaryPromptPage
            prompts={summaryPrompts}
            notebooks={notebooks}
            onRefresh={fetchSummaryPrompts}
          />
        </div>
      ) : (
        <div className="flex flex-col lg:grid lg:grid-cols-3 gap-6 h-full lg:overflow-hidden">
          <div
            className={cn(
              'lg:col-span-1 space-y-6 lg:overflow-y-auto pr-2 custom-scrollbar shrink-0',
              activeTab === 'tasks' && mobileTaskView === 'detail' ? 'hidden lg:block' : '',
            )}
          >
            {activeTab === 'upload' && (
              <UploadPage
                notebooks={notebooks}
                capabilities={capabilities}
                userSettings={userSettings}
                onUploadSuccess={async (taskId) => {
                  await refreshTasksAndSelection(taskId);
                  await fetchTags();
                }}
              />
            )}
            {activeTab === 'record' && (
              <RecordPage
                notebooks={notebooks}
                capabilities={capabilities}
                userSettings={userSettings}
                onUploadSuccess={async (taskId) => {
                  await refreshTasksAndSelection(taskId);
                  await fetchTags();
                }}
              />
            )}
            {activeTab === 'tasks' && (
              <TasksPage
                tasks={tasks}
                notebooks={notebooks}
                tags={tags}
                onSelectTask={openTaskDetail}
                selectedTaskId={selectedTaskId || undefined}
                onRefresh={() => refreshTasksAndSelection(selectedTaskId)}
              />
            )}
          </div>

          <div
            className={cn(
              'lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col lg:h-full min-h-[500px] shrink-0',
              activeTab === 'tasks' && mobileTaskView === 'list' ? 'hidden lg:flex' : 'flex',
            )}
          >
            {activeTab === 'tasks' && (
              <div className="lg:hidden flex items-center gap-3 px-4 py-3 border-b border-slate-200 bg-white shrink-0">
                <button
                  type="button"
                  onClick={showTasksList}
                  className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back to tasks
                </button>
                {selectedTask && (
                  <div className="min-w-0 text-sm font-semibold text-slate-900 truncate">
                    {selectedTask.originalName || selectedTask.filename}
                  </div>
                )}
              </div>
            )}
            {selectedTask ? (
              <TaskDetail
                task={selectedTask}
                notebooks={notebooks}
                capabilities={capabilities}
                summaryPrompts={summaryPrompts}
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
      )}
    </AppShell>
    </AppDataProvider>
    </AuthProvider>
  );
}
