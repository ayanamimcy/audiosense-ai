import React, { useEffect, useRef, useState } from 'react';
import {
  BrainCircuit,
  ChevronRight,
  FileAudio,
  FolderKanban,
  HelpCircle,
  List,
  Loader2,
  LogOut,
  Menu,
  Mic,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Square,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { format } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { apiFetch, apiJson, getCurrentUser, getPublicConfig, getStoredUser, logout } from './api';
import { KnowledgeBase } from './KnowledgeBase';
import NotebookView from './Notebook';
import { SummaryPromptPage } from './SummaryPromptPage';
import { TaskDetail } from './TaskDetail';
import { Login } from './components/Login';
import type {
  AppCapabilities,
  AuthUser,
  Notebook,
  ProviderHealth,
  PublicConfig,
  SummaryPrompt,
  TagStat,
  Task,
  UserSettings,
} from './types';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Tab = 'upload' | 'record' | 'tasks' | 'notebook' | 'knowledge' | 'prompts' | 'settings';

const DEFAULT_PUBLIC_CONFIG: PublicConfig = {
  auth: {
    allowRegistration: false,
  },
};

const LANGUAGE_OPTIONS = [
  { value: 'auto', label: 'Auto Detect' },
  { value: 'zh', label: 'Chinese' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'es', label: 'Spanish' },
];

const AUDIO_FILE_ACCEPT = 'audio/*,.m4a,.mp3,.wav,.ogg,.webm,.aac,.mp4,.flac';
const AUDIO_FILE_EXTENSIONS = ['.m4a', '.mp3', '.wav', '.ogg', '.webm', '.aac', '.mp4', '.flac'];

function getLocalSetting(key: string, fallback: string) {
  return localStorage.getItem(key) || fallback;
}

function isLikelyAudioFile(file: File) {
  const mimeType = file.type.toLowerCase();
  if (mimeType.startsWith('audio/')) {
    return true;
  }

  const lowerName = file.name.toLowerCase();
  return AUDIO_FILE_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

export default function App() {
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('notebook');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [tags, setTags] = useState<TagStat[]>([]);
  const [summaryPrompts, setSummaryPrompts] = useState<SummaryPrompt[]>([]);
  const [capabilities, setCapabilities] = useState<AppCapabilities | null>(null);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [providerHealth, setProviderHealth] = useState<ProviderHealth[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [publicConfig, setPublicConfig] = useState<PublicConfig>(DEFAULT_PUBLIC_CONFIG);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedTaskLoading, setSelectedTaskLoading] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => getStoredUser());

  const handleLogout = async () => {
    await logout();
    setCurrentUser(null);
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

  const fetchTaskDetail = async (taskId: string) => {
    const data = await apiJson<Task>(`/api/tasks/${taskId}`);
    setSelectedTask(data);
    return data;
  };

  const fetchTasks = async (preferredTaskId?: string | null) => {
    const data = await apiJson<Task[]>('/api/tasks');
    setTasks(data);
    const nextSelectedTaskId = preferredTaskId
      ? data.find((task) => task.id === preferredTaskId)?.id || data[0]?.id || null
      : selectedTaskId
        ? data.find((task) => task.id === selectedTaskId)?.id || data[0]?.id || null
        : data[0]?.id || null;

    setSelectedTaskId(nextSelectedTaskId);
    if (!nextSelectedTaskId) {
      setSelectedTask(null);
    }

    return nextSelectedTaskId;
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
    const nextSelectedTaskId = await fetchTasks(preferredTaskId);
    if (nextSelectedTaskId) {
      await fetchTaskDetail(nextSelectedTaskId);
    }
  };

  const refreshAll = async (preferredTaskId?: string | null) => {
    const [nextSelectedTaskId] = await Promise.all([
      fetchTasks(preferredTaskId),
      fetchNotebooks(),
      fetchTags(),
      fetchSummaryPrompts(),
      fetchCapabilities(),
      fetchSettings(),
      fetchProviderHealth(),
    ]);

    if (nextSelectedTaskId) {
      await fetchTaskDetail(nextSelectedTaskId);
    }
  };

  useEffect(() => {
    const bootstrap = async () => {
      const configResult = await getPublicConfig().catch((error) => {
        console.error('Failed to load public config:', error);
        return DEFAULT_PUBLIC_CONFIG;
      });
      setPublicConfig(configResult);

      try {
        const user = await getCurrentUser();
        setCurrentUser(user);
      } catch {
        setCurrentUser(null);
      } finally {
        setAuthLoading(false);
      }
    };

    void bootstrap();
  }, []);

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    void refreshAll();
  }, [currentUser]);

  const hasActiveTasks = tasks.some((task) => task.status === 'pending' || task.status === 'processing');

  useEffect(() => {
    if (!currentUser || !hasActiveTasks) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshTasksAndSelection(selectedTaskId).catch((error) => {
        console.error('Failed to poll active tasks:', error);
      });
    }, 5000);

    return () => window.clearInterval(interval);
  }, [currentUser, hasActiveTasks, selectedTaskId]);

  useEffect(() => {
    if (!currentUser || !selectedTaskId) {
      setSelectedTask(null);
      setSelectedTaskLoading(false);
      return;
    }

    let cancelled = false;
    setSelectedTask((current) => (current?.id === selectedTaskId ? current : null));
    setSelectedTaskLoading(true);

    void apiJson<Task>(`/api/tasks/${selectedTaskId}`)
      .then((task) => {
        if (!cancelled) {
          setSelectedTask(task);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to load selected task:', error);
          setSelectedTask(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSelectedTaskLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentUser, selectedTaskId]);

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
    <div className="h-[100dvh] bg-slate-50 text-slate-900 flex flex-col lg:flex-row overflow-hidden relative">
      <header className="lg:hidden bg-white border-b border-slate-200 p-4 flex items-center justify-between shrink-0 z-20 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-lg shadow-sm">
            <Mic className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-800">AudioSense AI</h1>
        </div>
        <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-sm">
          {currentUser.name.charAt(0).toUpperCase()}
        </div>
      </header>

      <aside className="hidden lg:flex w-64 bg-white border-r border-slate-200 flex-col h-full shadow-sm z-20 shrink-0">
        <div className="p-6 flex items-center gap-3 border-b border-slate-100">
          <div className="bg-indigo-600 p-2 rounded-lg shadow-sm">
            <Mic className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-800">AudioSense AI</h1>
            <p className="text-xs text-slate-500 mt-0.5">Auth, queue, search, knowledge</p>
          </div>
        </div>

        <nav className="flex-1 p-4 flex-col space-y-1 overflow-y-auto custom-scrollbar">
          <SidebarButton active={activeTab === 'notebook'} onClick={() => setActiveTab('notebook')} icon={<FolderKanban className="w-5 h-5" />}>
            Workspace
          </SidebarButton>
          <SidebarButton active={activeTab === 'knowledge'} onClick={() => setActiveTab('knowledge')} icon={<BrainCircuit className="w-5 h-5" />}>
            Knowledge
          </SidebarButton>
          <SidebarButton active={activeTab === 'upload'} onClick={() => setActiveTab('upload')} icon={<Upload className="w-5 h-5" />}>
            Upload
          </SidebarButton>
          <SidebarButton active={activeTab === 'record'} onClick={() => setActiveTab('record')} icon={<Mic className="w-5 h-5" />}>
            Record
          </SidebarButton>
          <SidebarButton active={activeTab === 'tasks'} onClick={() => setActiveTab('tasks')} icon={<List className="w-5 h-5" />}>
            Tasks
          </SidebarButton>
          <SidebarButton active={activeTab === 'prompts'} onClick={() => setActiveTab('prompts')} icon={<Sparkles className="w-5 h-5" />}>
            Prompts
          </SidebarButton>
        </nav>

        <div className="p-4 border-t border-slate-100">
          <div className="flex items-center gap-3 px-4 py-3 mb-2 rounded-xl bg-slate-50 border border-slate-100">
            <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-sm">
              {currentUser.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-900 truncate">{currentUser.name}</p>
              <p className="text-xs text-slate-500 truncate">{currentUser.email}</p>
            </div>
          </div>
          <SidebarButton active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon={<Settings className="w-5 h-5" />}>
            Settings
          </SidebarButton>
          <button
            onClick={() => void handleLogout()}
            className="w-full flex items-center gap-3 px-4 py-3 mt-1 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
          >
            <LogOut className="w-5 h-5" />
            Sign Out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden relative bg-slate-50">
        <div className="absolute inset-0 overflow-y-auto custom-scrollbar pb-[80px] lg:pb-0">
          <div className="max-w-7xl w-full mx-auto p-4 lg:p-6 h-full flex flex-col">
            {activeTab === 'notebook' ? (
              <NotebookView
                tasks={tasks}
                notebooks={notebooks}
                tags={tags}
                onSelectTask={(taskId) => {
                  setSelectedTaskId(taskId);
                  setActiveTab('tasks');
                }}
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
                onSelectTask={(taskId) => {
                  setSelectedTaskId(taskId);
                  setActiveTab('tasks');
                }}
              />
            ) : activeTab === 'settings' ? (
              <div className="h-full pb-6">
                <SettingsSection
                  onLogout={handleLogout}
                  currentUser={currentUser}
                  capabilities={capabilities}
                  userSettings={userSettings}
                  providerHealth={providerHealth}
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
                <div className="lg:col-span-1 space-y-6 lg:overflow-y-auto pr-2 custom-scrollbar shrink-0">
                  {activeTab === 'upload' && (
                    <UploadSection
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
                    <RecordSection
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
                    <TasksList
                      tasks={tasks}
                      notebooks={notebooks}
                      tags={tags}
                      onSelectTask={setSelectedTaskId}
                      selectedTaskId={selectedTaskId || undefined}
                      onRefresh={() => refreshAll(selectedTaskId)}
                    />
                  )}
                </div>

                <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col lg:h-full min-h-[500px] shrink-0">
                  {selectedTask ? (
                    <TaskDetail
                      task={selectedTask}
                      notebooks={notebooks}
                      capabilities={capabilities}
                      summaryPrompts={summaryPrompts}
                      onUpdateTask={() => refreshAll(selectedTask.id)}
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
          </div>
        </div>
      </main>

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex items-center justify-around px-2 py-2 pb-safe z-30 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
        <BottomNavButton active={activeTab === 'notebook'} onClick={() => { setActiveTab('notebook'); setIsMobileMenuOpen(false); }} icon={<FolderKanban className="w-5 h-5" />} label="Workspace" />
        <BottomNavButton active={activeTab === 'knowledge'} onClick={() => { setActiveTab('knowledge'); setIsMobileMenuOpen(false); }} icon={<BrainCircuit className="w-5 h-5" />} label="Search" />
        <div className="relative -top-5">
          <button
            onClick={() => { setActiveTab('record'); setIsMobileMenuOpen(false); }}
            className={cn(
              'w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-95',
              activeTab === 'record' ? 'bg-indigo-700 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700',
            )}
          >
            <Mic className="w-6 h-6" />
          </button>
        </div>
        <BottomNavButton active={activeTab === 'upload'} onClick={() => { setActiveTab('upload'); setIsMobileMenuOpen(false); }} icon={<Upload className="w-5 h-5" />} label="Upload" />
        <BottomNavButton active={isMobileMenuOpen} onClick={() => setIsMobileMenuOpen(true)} icon={<Menu className="w-5 h-5" />} label="More" />
      </nav>

      {isMobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm transition-opacity" onClick={() => setIsMobileMenuOpen(false)}>
          <div
            className="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl shadow-2xl transition-transform transform translate-y-0 max-h-[85vh] flex flex-col"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <h2 className="text-xl font-bold text-slate-800">More</h2>
              <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 bg-slate-100 rounded-full text-slate-500 hover:bg-slate-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto custom-scrollbar p-6 space-y-6 pb-24">
              <div className="flex items-center gap-4 p-4 bg-indigo-50 rounded-2xl border border-indigo-100/50">
                <div className="w-14 h-14 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold text-xl shadow-sm">
                  {currentUser.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-900 truncate">{currentUser.name}</p>
                  <p className="text-sm text-slate-500 truncate">{currentUser.email}</p>
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-2">Workspace</h3>
                <DrawerButton icon={<List className="w-5 h-5 text-slate-500" />} label="Tasks" onClick={() => { setActiveTab('tasks'); setIsMobileMenuOpen(false); }} />
                <DrawerButton icon={<Sparkles className="w-5 h-5 text-slate-500" />} label="Summary Prompts" onClick={() => { setActiveTab('prompts'); setIsMobileMenuOpen(false); }} />
                <DrawerButton icon={<Settings className="w-5 h-5 text-slate-500" />} label="Settings & Preferences" onClick={() => { setActiveTab('settings'); setIsMobileMenuOpen(false); }} />
              </div>

              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-2">Help</h3>
                <DrawerButton icon={<HelpCircle className="w-5 h-5 text-slate-500" />} label="How It Works" onClick={() => { alert('Use upload or record to create queued transcription jobs, then manage them by notebook, tags, summaries, and global knowledge search.'); setIsMobileMenuOpen(false); }} />
              </div>

              <button
                onClick={() => void handleLogout()}
                className="w-full flex items-center justify-center gap-2 px-4 py-3.5 mt-4 rounded-xl text-base font-medium text-red-600 bg-red-50 hover:bg-red-100 transition-colors"
              >
                <LogOut className="w-5 h-5" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SidebarButton({
  active,
  onClick,
  children,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200',
        active ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function BottomNavButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col items-center justify-center w-16 h-12 gap-1 transition-colors',
        active ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600',
      )}
    >
      {icon}
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}

function DrawerButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between p-4 bg-white border border-slate-100 rounded-xl hover:bg-slate-50 transition-colors active:scale-[0.98]"
    >
      <div className="flex items-center gap-3">
        <div className="p-2 bg-slate-50 rounded-lg">{icon}</div>
        <span className="font-medium text-slate-700">{label}</span>
      </div>
      <ChevronRight className="w-5 h-5 text-slate-300" />
    </button>
  );
}

function UploadSection({
  notebooks,
  capabilities,
  userSettings,
  onUploadSuccess,
}: {
  notebooks: Notebook[];
  capabilities: AppCapabilities | null;
  userSettings: UserSettings | null;
  onUploadSuccess: (taskId?: string) => void | Promise<void>;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedNotebookId, setSelectedNotebookId] = useState('');
  const [tags, setTags] = useState('');
  const [provider, setProvider] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!isLikelyAudioFile(file)) {
      alert('Please upload an audio file (MP3, WAV, M4A, OGG, WEBM, AAC, MP4, or FLAC).');
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append('audio', file);
    formData.append('language', getLocalSetting('parseLanguage', 'auto'));
    formData.append('diarization', getLocalSetting('enableDiarization', 'true'));
    formData.append('sourceType', 'upload');
    if (selectedNotebookId) {
      formData.append('notebookId', selectedNotebookId);
    }
    if (tags.trim()) {
      formData.append('tags', tags);
    }
    if (provider) {
      formData.append('provider', provider);
    }

    try {
      const res = await apiFetch('/api/upload', { method: 'POST', body: formData });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || 'Upload failed.');
      }

      setTags('');
      await onUploadSuccess(
        payload && typeof payload === 'object' && 'taskId' in payload
          ? String((payload as { taskId?: string }).taskId || '')
          : undefined,
      );
    } catch (error: unknown) {
      console.error('Upload error:', error);
      alert(error instanceof Error ? error.message : 'Upload failed.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
      <h2 className="text-lg font-semibold text-slate-900 mb-4">Upload Audio</h2>
      <div
        className={cn(
          'border-2 border-dashed rounded-xl p-8 text-center transition-colors duration-200 flex flex-col items-center justify-center min-h-[240px]',
          isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 hover:border-slate-400 bg-slate-50',
          isUploading && 'opacity-50 pointer-events-none',
        )}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) {
            void handleFile(file);
          }
        }}
      >
        {isUploading ? <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mb-4" /> : <Upload className="w-10 h-10 text-slate-400 mb-4" />}
        <p className="text-sm font-medium text-slate-700 mb-1">{isUploading ? 'Queuing upload...' : 'Drag your audio file here'}</p>
        <p className="text-xs text-slate-500 mb-4">Supports MP3, WAV, M4A, OGG, WEBM</p>
        <input
          type="file"
          accept={AUDIO_FILE_ACCEPT}
          className="hidden"
          ref={fileInputRef}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void handleFile(file);
            }
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
        >
          Browse Files
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 mt-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Provider</span>
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">
              Default ({userSettings?.defaultProvider || capabilities?.transcription.activeProvider || 'local-python'})
            </option>
            {capabilities?.transcription.providers.map((item) => (
              <option key={item.id} value={item.id} disabled={!item.configured}>
                {item.label}{item.configured ? '' : ' (Not configured)'}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Notebook</span>
          <select
            value={selectedNotebookId}
            onChange={(event) => setSelectedNotebookId(event.target.value)}
            className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Unassigned</option>
            {notebooks.map((notebook) => (
              <option key={notebook.id} value={notebook.id}>
                {notebook.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Tags</span>
          <input
            type="text"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="meeting, interview, sprint"
            className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>
      </div>
    </div>
  );
}

function RecordSection({
  notebooks,
  capabilities,
  userSettings,
  onUploadSuccess,
}: {
  notebooks: Notebook[];
  capabilities: AppCapabilities | null;
  userSettings: UserSettings | null;
  onUploadSuccess: (taskId?: string) => void | Promise<void>;
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [selectedNotebookId, setSelectedNotebookId] = useState('');
  const [tags, setTags] = useState('');
  const [provider, setProvider] = useState('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  const clearRecordingTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const uploadRecording = async (file: File) => {
    const formData = new FormData();
    formData.append('audio', file);
    formData.append('language', getLocalSetting('parseLanguage', 'auto'));
    formData.append('diarization', getLocalSetting('enableDiarization', 'true'));
    formData.append('sourceType', 'record');
    if (selectedNotebookId) {
      formData.append('notebookId', selectedNotebookId);
    }
    if (tags.trim()) {
      formData.append('tags', tags);
    }
    if (provider) {
      formData.append('provider', provider);
    }

    const res = await apiFetch('/api/upload', { method: 'POST', body: formData });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(payload?.error || 'Failed to queue recording.');
    }

    setTags('');
    await onUploadSuccess(
      payload && typeof payload === 'object' && 'taskId' in payload
        ? String((payload as { taskId?: string }).taskId || '')
        : undefined,
    );
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 16000,
        },
      });

      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/webm';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'audio/mp4';
        }
      }

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 128000,
      });

      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        clearRecordingTimer();
        setIsRecording(false);
        if (chunksRef.current.length === 0) {
          setIsUploading(false);
          return;
        }

        const blob = new Blob(chunksRef.current, { type: mimeType });
        const ext = mimeType.includes('mp4') ? 'm4a' : 'webm';
        const file = new File([blob], `recording-${Date.now()}.${ext}`, { type: mimeType });

        setIsUploading(true);
        try {
          await uploadRecording(file);
        } catch (error: unknown) {
          console.error('Upload error:', error);
          alert(error instanceof Error ? error.message : 'Failed to queue recording.');
        } finally {
          setIsUploading(false);
        }
      };

      mediaRecorder.start(1000);
      setIsRecording(true);
      setRecordingTime(0);
      clearRecordingTimer();
      timerRef.current = window.setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } catch (error: unknown) {
      console.error('Error accessing microphone:', error);
      alert(error instanceof Error ? error.message : 'Could not access microphone.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearRecordingTimer();
    }
  };

  useEffect(() => {
    return () => {
      clearRecordingTimer();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
      <h2 className="text-lg font-semibold text-slate-900 mb-4">Record Audio</h2>
      <div className="flex flex-col items-center justify-center p-8 bg-slate-50 rounded-xl border border-slate-200 min-h-[240px]">
        {isUploading ? (
          <div className="flex flex-col items-center">
            <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mb-4" />
            <p className="text-sm font-medium text-slate-600">Queuing recording...</p>
          </div>
        ) : (
          <>
            <div className="text-4xl font-mono font-light text-slate-700 mb-8 tracking-wider">{formatTime(recordingTime)}</div>
            {isRecording ? (
              <button
                onClick={stopRecording}
                className="w-20 h-20 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center shadow-lg shadow-red-500/30 transition-all hover:scale-105 active:scale-95"
              >
                <Square className="w-8 h-8 text-white fill-current" />
              </button>
            ) : (
              <button
                onClick={() => void startRecording()}
                className="w-20 h-20 bg-indigo-600 hover:bg-indigo-700 rounded-full flex items-center justify-center shadow-lg shadow-indigo-600/30 transition-all hover:scale-105 active:scale-95"
              >
                <Mic className="w-8 h-8 text-white" />
              </button>
            )}
            <p className="text-sm text-slate-500 mt-6">{isRecording ? 'Recording in progress...' : 'Click to start recording'}</p>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 mt-4">
        <label className="block">
          <span className="text-sm font-medium text-slate-700">Provider</span>
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">
              Default ({userSettings?.defaultProvider || capabilities?.transcription.activeProvider || 'local-python'})
            </option>
            {capabilities?.transcription.providers.map((item) => (
              <option key={item.id} value={item.id} disabled={!item.configured}>
                {item.label}{item.configured ? '' : ' (Not configured)'}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Notebook</span>
          <select
            value={selectedNotebookId}
            onChange={(event) => setSelectedNotebookId(event.target.value)}
            className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="">Unassigned</option>
            {notebooks.map((notebook) => (
              <option key={notebook.id} value={notebook.id}>
                {notebook.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-slate-700">Tags</span>
          <input
            type="text"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="customer call, weekly sync"
            className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>
      </div>
    </div>
  );
}

function TasksList({
  tasks,
  notebooks,
  tags,
  onSelectTask,
  selectedTaskId,
  onRefresh,
}: {
  tasks: Task[];
  notebooks: Notebook[];
  tags: TagStat[];
  onSelectTask: (taskId: string) => void;
  selectedTaskId?: string;
  onRefresh: () => void | Promise<void>;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('');

  const handleDelete = async (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    if (!confirm('Are you sure you want to delete this task?')) {
      return;
    }

    await apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });
    await onRefresh();
  };

  const filteredTasks = tasks.filter((task) => {
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !query ||
      task.originalName.toLowerCase().includes(query) ||
      task.tags.some((tag) => tag.toLowerCase().includes(query));

    const matchesTag = !tagFilter || task.tags.includes(tagFilter);
    return matchesSearch && matchesTag;
  });

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-col h-full min-h-[400px]">
      <div className="flex items-center justify-between mb-4 px-2">
        <h2 className="text-lg font-semibold text-slate-900">Recent Tasks</h2>
        <button onClick={() => void onRefresh()} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="mb-4 px-2 space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search task or tag..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setTagFilter('')}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
              !tagFilter ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-slate-600 border-slate-200',
            )}
          >
            All
          </button>
          {tags.slice(0, 8).map((tag) => (
            <button
              key={tag.name}
              onClick={() => setTagFilter((current) => (current === tag.name ? '' : tag.name))}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                tagFilter === tag.name ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-slate-600 border-slate-200',
              )}
            >
              #{tag.name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 space-y-2 custom-scrollbar">
        {filteredTasks.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-sm">{searchQuery || tagFilter ? 'No matching tasks found.' : 'No tasks yet.'}</div>
        ) : (
          filteredTasks.map((task) => {
            const notebook = notebooks.find((item) => item.id === task.notebookId);

            return (
              <div
                key={task.id}
                onClick={() => onSelectTask(task.id)}
                className={cn(
                  'p-3 rounded-xl border cursor-pointer transition-all flex items-start gap-3',
                  selectedTaskId === task.id ? 'border-indigo-500 bg-indigo-50/50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                )}
              >
                <div className="mt-1">
                  {task.status === 'completed' && <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />}
                  {task.status === 'processing' && <div className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />}
                  {task.status === 'pending' && <div className="w-2.5 h-2.5 rounded-full bg-slate-300" />}
                  {task.status === 'failed' && <div className="w-2.5 h-2.5 rounded-full bg-red-500" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{task.originalName}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-xs text-slate-500">{format(task.createdAt, 'MMM d, HH:mm')}</span>
                    <span className="text-xs text-slate-400 capitalize">• {task.status}</span>
                    {notebook && <span className="text-xs text-indigo-600">• {notebook.name}</span>}
                    {task.provider && <span className="text-xs text-slate-500">• {task.provider}</span>}
                  </div>
                  {task.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {task.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="text-[10px] font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={(event) => void handleDelete(event, task.id)}
                  className="p-1.5 text-slate-400 hover:text-red-500 rounded-md hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function SettingsSection({
  onLogout,
  currentUser,
  capabilities,
  userSettings,
  providerHealth,
  onSettingsSaved,
}: {
  onLogout: () => void | Promise<void>;
  currentUser: AuthUser;
  capabilities: AppCapabilities | null;
  userSettings: UserSettings | null;
  providerHealth: ProviderHealth[];
  onSettingsSaved: () => void | Promise<void>;
}) {
  const [language, setLanguage] = useState('auto');
  const [enableDiarization, setEnableDiarization] = useState(true);
  const [draft, setDraft] = useState<UserSettings | null>(userSettings);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setLanguage(getLocalSetting('parseLanguage', 'auto'));
    setEnableDiarization(getLocalSetting('enableDiarization', 'true') === 'true');
  }, []);

  useEffect(() => {
    if (!userSettings) {
      return;
    }

    setDraft(userSettings);
  }, [userSettings]);

  const updateDraft = (updater: (current: UserSettings) => UserSettings) => {
    setDraft((current) => (current ? updater(current) : current));
  };

  const providerOptions = capabilities?.transcription.providers || [];
  const providerHealthMap = new Map(providerHealth.map((item) => [item.provider, item]));
  const localRuntimeBackends = capabilities?.transcription.localRuntime.backends || [];
  const selectedLocalRuntimeBackend =
    localRuntimeBackends.find((backend) => backend.id === draft?.localRuntime.backendId) ||
    localRuntimeBackends[0] ||
    null;
  const localRuntimeModels = selectedLocalRuntimeBackend?.models || [];

  const handleSave = async () => {
    if (!draft) {
      return;
    }

    localStorage.setItem('parseLanguage', language);
    localStorage.setItem('enableDiarization', String(enableDiarization));

    setIsSaving(true);
    try {
      await apiJson('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      await onSettingsSaved();
      alert('Settings saved successfully.');
    } catch (error) {
      console.error('Failed to save settings:', error);
      alert(error instanceof Error ? error.message : 'Failed to save settings.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!draft) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm max-w-3xl">
        <h2 className="text-2xl font-bold text-slate-900 mb-4">Settings</h2>
        <p className="text-slate-500">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm max-w-3xl">
      <h2 className="text-2xl font-bold text-slate-900 mb-6">Settings</h2>

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Parsing Language</label>
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            className="w-full max-w-md px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-700"
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-start gap-3 p-4 rounded-2xl border border-slate-200 bg-slate-50">
          <input
            type="checkbox"
            checked={enableDiarization}
            onChange={(event) => setEnableDiarization(event.target.checked)}
            className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <div>
            <p className="text-sm font-medium text-slate-800">Enable speaker diarization</p>
            <p className="text-sm text-slate-500 mt-1">Providers that support diarization can split transcripts by speaker and time segments.</p>
          </div>
        </label>

        <div className="rounded-2xl border border-slate-200 p-5 space-y-5">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Provider Routing</h3>
              <p className="text-sm text-slate-500 mt-1">Configure default provider, fallback chain, and circuit breaker strategy.</p>
            </div>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Default provider</span>
            <select
              value={draft.defaultProvider}
              onChange={(event) =>
                updateDraft((current) => ({
                  ...current,
                  defaultProvider: event.target.value,
                  fallbackProviders: current.fallbackProviders.filter((item) => item !== event.target.value),
                }))
              }
              className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {providerOptions.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                  {provider.configured ? '' : ' (Missing saved config)'}
                </option>
              ))}
            </select>
          </label>

          <div>
            <span className="text-sm font-medium text-slate-700">Fallback chain</span>
            <div className="mt-2 space-y-2">
              {providerOptions
                .filter((provider) => provider.id !== draft.defaultProvider)
                .map((provider) => {
                  const checked = draft.fallbackProviders.includes(provider.id);
                  return (
                    <label key={provider.id} className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          updateDraft((current) => ({
                            ...current,
                            fallbackProviders: event.target.checked
                              ? [...current.fallbackProviders, provider.id]
                              : current.fallbackProviders.filter((item) => item !== provider.id),
                          }));
                        }}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div>
                        <p className="text-sm font-medium text-slate-800">{provider.label}</p>
                        <p className="text-xs text-slate-500 mt-1">{provider.description}</p>
                      </div>
                    </label>
                  );
                })}
            </div>
          </div>

          <label className="flex items-start gap-3 p-4 rounded-2xl border border-slate-200 bg-slate-50">
            <input
              type="checkbox"
              checked={draft.autoGenerateSummary}
              onChange={(event) =>
                updateDraft((current) => ({
                  ...current,
                  autoGenerateSummary: event.target.checked,
                }))
              }
              className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <div>
              <p className="text-sm font-medium text-slate-800">Auto generate summary after transcription</p>
              <p className="text-sm text-slate-500 mt-1">If LLM is configured, the worker will generate a summary automatically after a task completes.</p>
            </div>
          </label>

          <div className="grid md:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Circuit breaker threshold</span>
              <input
                type="number"
                min={1}
                max={10}
                value={draft.circuitBreakerThreshold}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    circuitBreakerThreshold: Number(event.target.value),
                  }))
                }
                className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Cooldown (seconds)</span>
              <input
                type="number"
                min={10}
                max={3600}
                value={Math.round(draft.circuitBreakerCooldownMs / 1000)}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    circuitBreakerCooldownMs: Number(event.target.value) * 1000,
                  }))
                }
                className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </label>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-slate-900">OpenAI Whisper API</h3>
            <p className="text-sm text-slate-500 mt-1">Configure a standard OpenAI-compatible Whisper transcription endpoint.</p>
          </div>

          <label className="flex items-start gap-3 p-4 rounded-2xl border border-slate-200 bg-slate-50">
            <input
              type="checkbox"
              checked={draft.openaiWhisper.enabled}
              onChange={(event) =>
                updateDraft((current) => ({
                  ...current,
                  openaiWhisper: {
                    ...current.openaiWhisper,
                    enabled: event.target.checked,
                  },
                }))
              }
              className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <div>
              <p className="text-sm font-medium text-slate-800">Enable OpenAI Whisper provider</p>
              <p className="text-sm text-slate-500 mt-1">After saving, this provider can be used as the default provider or a fallback provider.</p>
            </div>
          </label>

          <div className="grid md:grid-cols-2 gap-4">
            <label className="block md:col-span-2">
              <span className="text-sm font-medium text-slate-700">API base URL</span>
              <input
                type="url"
                value={draft.openaiWhisper.baseUrl}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    openaiWhisper: {
                      ...current.openaiWhisper,
                      baseUrl: event.target.value,
                    },
                  }))
                }
                className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="https://api.openai.com/v1"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Model</span>
              <input
                type="text"
                value={draft.openaiWhisper.model}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    openaiWhisper: {
                      ...current.openaiWhisper,
                      model: event.target.value,
                    },
                  }))
                }
                className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="whisper-1"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">API key</span>
              <input
                type="password"
                value={draft.openaiWhisper.apiKey}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    openaiWhisper: {
                      ...current.openaiWhisper,
                      apiKey: event.target.value,
                    },
                  }))
                }
                className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="sk-..."
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Transcription path</span>
              <input
                type="text"
                value={draft.openaiWhisper.transcriptionPath}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    openaiWhisper: {
                      ...current.openaiWhisper,
                      transcriptionPath: event.target.value,
                    },
                  }))
                }
                className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Translation path</span>
              <input
                type="text"
                value={draft.openaiWhisper.translationPath}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    openaiWhisper: {
                      ...current.openaiWhisper,
                      translationPath: event.target.value,
                    },
                  }))
                }
                className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Response format</span>
              <select
                value={draft.openaiWhisper.responseFormat}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    openaiWhisper: {
                      ...current.openaiWhisper,
                      responseFormat: event.target.value,
                    },
                  }))
                }
                className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="verbose_json">verbose_json</option>
                <option value="json">json</option>
                <option value="text">text</option>
              </select>
            </label>
          </div>

          <label className="flex items-start gap-3 p-4 rounded-2xl border border-slate-200 bg-slate-50">
            <input
              type="checkbox"
              checked={draft.openaiWhisper.disableTimestampGranularities}
              onChange={(event) =>
                updateDraft((current) => ({
                  ...current,
                  openaiWhisper: {
                    ...current.openaiWhisper,
                    disableTimestampGranularities: event.target.checked,
                  },
                }))
              }
              className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <div>
              <p className="text-sm font-medium text-slate-800">Disable timestamp granularities</p>
              <p className="text-sm text-slate-500 mt-1">Turn this on if your endpoint does not support `timestamp_granularities[]`.</p>
            </div>
          </label>
        </div>

        <div className="rounded-2xl border border-slate-200 p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Local Deployed Models</h3>
            <p className="text-sm text-slate-500 mt-1">Configure the Python runtime URL, local backend, and model size. The backend catalog comes from `python-runtime`.</p>
          </div>

          <label className="flex items-start gap-3 p-4 rounded-2xl border border-slate-200 bg-slate-50">
            <input
              type="checkbox"
              checked={draft.localRuntime.enabled}
              onChange={(event) =>
                updateDraft((current) => ({
                  ...current,
                  localRuntime: {
                    ...current.localRuntime,
                    enabled: event.target.checked,
                  },
                }))
              }
              className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <div>
              <p className="text-sm font-medium text-slate-800">Enable local Python runtime</p>
              <p className="text-sm text-slate-500 mt-1">Use the built-in `local-python` provider for locally deployed speech models.</p>
            </div>
          </label>

          <div className="grid md:grid-cols-2 gap-4">
            <label className="block md:col-span-2">
              <span className="text-sm font-medium text-slate-700">Runtime base URL</span>
              <input
                type="url"
                value={draft.localRuntime.baseUrl}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    localRuntime: {
                      ...current.localRuntime,
                      baseUrl: event.target.value,
                    },
                  }))
                }
                className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="http://127.0.0.1:8765"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Local backend</span>
              <select
                value={draft.localRuntime.backendId}
                onChange={(event) => {
                  const nextBackend =
                    localRuntimeBackends.find((backend) => backend.id === event.target.value) ||
                    localRuntimeBackends[0];
                  updateDraft((current) => ({
                    ...current,
                    localRuntime: {
                      ...current.localRuntime,
                      backendId: nextBackend?.id || current.localRuntime.backendId,
                      modelName: nextBackend?.defaultModel || current.localRuntime.modelName,
                    },
                  }));
                }}
                className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {localRuntimeBackends.map((backend) => (
                  <option key={backend.id} value={backend.id}>
                    {backend.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Model size</span>
              <select
                value={draft.localRuntime.modelName}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    localRuntime: {
                      ...current.localRuntime,
                      modelName: event.target.value,
                    },
                  }))
                }
                className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {localRuntimeModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
              {selectedLocalRuntimeBackend && (
                <p className="text-xs text-slate-500 mt-2">{selectedLocalRuntimeBackend.description}</p>
              )}
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Diarization strategy</span>
              <select
                value={draft.localRuntime.diarizationStrategy}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    localRuntime: {
                      ...current.localRuntime,
                      diarizationStrategy: event.target.value as UserSettings['localRuntime']['diarizationStrategy'],
                    },
                  }))
                }
                className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="auto">auto</option>
                <option value="parallel">parallel</option>
                <option value="sequential">sequential</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Request timeout (seconds)</span>
              <input
                type="number"
                min={60}
                max={14400}
                value={Math.round(draft.localRuntime.requestTimeoutMs / 1000)}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    localRuntime: {
                      ...current.localRuntime,
                      requestTimeoutMs: Number(event.target.value) * 1000,
                    },
                  }))
                }
                className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-sm font-medium text-slate-700">Hugging Face token</span>
              <input
                type="password"
                value={draft.localRuntime.hfToken}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    localRuntime: {
                      ...current.localRuntime,
                      hfToken: event.target.value,
                    },
                  }))
                }
                className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Required for gated diarization models"
              />
            </label>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-slate-900">LLM API</h3>
            <p className="text-sm text-slate-500 mt-1">Used for summary generation and transcript chat.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <label className="block md:col-span-2">
              <span className="text-sm font-medium text-slate-700">Base URL</span>
              <input
                type="url"
                value={draft.llm.baseUrl}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    llm: {
                      ...current.llm,
                      baseUrl: event.target.value,
                    },
                  }))
                }
                className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="https://api.openai.com/v1"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Model</span>
              <input
                type="text"
                value={draft.llm.model}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    llm: {
                      ...current.llm,
                      model: event.target.value,
                    },
                  }))
                }
                className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="gpt-4o-mini"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">API key</span>
              <input
                type="password"
                value={draft.llm.apiKey}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    llm: {
                      ...current.llm,
                      apiKey: event.target.value,
                    },
                  }))
                }
                className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="sk-..."
              />
            </label>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Retrieval Settings</h3>
            <p className="text-sm text-slate-500 mt-1">Tune how global search and cross-recording Q&A rank transcript chunks.</p>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Retrieval mode</span>
            <select
              value={draft.retrievalMode}
              onChange={(event) =>
                updateDraft((current) => ({
                  ...current,
                  retrievalMode: event.target.value as UserSettings['retrievalMode'],
                }))
              }
              className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="hybrid">Hybrid (FTS + vector)</option>
              <option value="fts">Full-text only</option>
              <option value="vector">Vector only</option>
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Max knowledge chunks</span>
            <input
              type="number"
              min={3}
              max={20}
              value={draft.maxKnowledgeChunks}
              onChange={(event) =>
                updateDraft((current) => ({
                  ...current,
                  maxKnowledgeChunks: Number(event.target.value),
                }))
              }
              className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>
        </div>

        <div className="rounded-2xl border border-slate-200 p-5">
          <h3 className="text-base font-semibold text-slate-900">Backend Capabilities</h3>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-400">Queue</p>
              <p className="text-sm font-medium text-slate-800 mt-2">{capabilities?.queue.workerMode || 'separate-process'}</p>
              <p className="text-xs text-slate-500 mt-1">{capabilities?.queue.recommendedCommand || 'npm run worker'}</p>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-400">LLM</p>
              <p className="text-sm font-medium text-slate-800 mt-2">{capabilities?.llm.configured ? capabilities.llm.model : 'Not configured'}</p>
              <p className="text-xs text-slate-500 mt-1 break-all">{capabilities?.llm.baseUrl || 'Set LLM API config in settings'}</p>
            </div>
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
              <p className="text-xs uppercase tracking-wider text-slate-400">Embeddings</p>
              <p className="text-sm font-medium text-slate-800 mt-2">{capabilities?.embeddings.configured ? capabilities.embeddings.model : 'Not configured'}</p>
              <p className="text-xs text-slate-500 mt-1 break-all">{capabilities?.embeddings.baseUrl || 'Set EMBEDDING_API_BASE_URL and EMBEDDING_API_KEY'}</p>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {providerOptions.map((provider) => (
              <div key={provider.id} className="rounded-xl border border-slate-200 p-4 flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-900">{provider.label}</p>
                  <p className="text-xs text-slate-500 mt-1">{provider.description}</p>
                  {providerHealthMap.get(provider.id)?.lastError && (
                    <p className="text-xs text-red-600 mt-2">
                      {providerHealthMap.get(provider.id)?.lastError}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={cn('text-xs font-medium px-2.5 py-1 rounded-full border', provider.configured ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200')}>
                    {provider.configured ? 'Configured' : 'Missing config'}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    failures {providerHealthMap.get(provider.id)?.failureCount || 0}
                    {' • '}
                    success {providerHealthMap.get(provider.id)?.successCount || 0}
                  </span>
                  <button
                    onClick={async () => {
                      await apiJson(`/api/provider-health/${provider.id}/reset`, { method: 'POST' });
                      await onSettingsSaved();
                    }}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                  >
                    Reset Circuit
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100">
          <button
            onClick={() => void handleSave()}
            disabled={isSaving}
            className="px-6 py-2.5 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-60"
          >
            {isSaving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>

        <div className="pt-8 mt-8 border-t border-slate-100">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Account</h3>
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-xl">
              {currentUser.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="font-medium text-slate-900">{currentUser.name}</p>
              <p className="text-sm text-slate-500">{currentUser.email}</p>
            </div>
          </div>
          <button
            onClick={() => void onLogout()}
            className="w-full sm:w-auto px-6 py-2.5 bg-red-50 text-red-600 font-medium rounded-xl hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
