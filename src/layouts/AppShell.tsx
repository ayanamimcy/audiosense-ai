import React from 'react';
import {
  BrainCircuit,
  FolderKanban,
  HelpCircle,
  List,
  LogOut,
  Menu,
  Mic,
  Settings,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { SidebarButton } from './nav/SidebarButton';
import { BottomNavButton } from './nav/BottomNavButton';
import { DrawerButton } from './nav/DrawerButton';
import type { AuthUser } from '../types';

export type Tab = 'upload' | 'record' | 'tasks' | 'notebook' | 'knowledge' | 'prompts' | 'settings';

export function AppShell({
  currentUser,
  activeTab,
  onTabChange,
  onLogout,
  isMobileMenuOpen,
  onMobileMenuChange,
  onOpenTasksTab,
  mainScrollRef,
  children,
}: {
  currentUser: AuthUser;
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  onLogout: () => void;
  isMobileMenuOpen: boolean;
  onMobileMenuChange: (open: boolean) => void;
  onOpenTasksTab: () => void;
  mainScrollRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}) {
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
          <SidebarButton active={activeTab === 'notebook'} onClick={() => onTabChange('notebook')} icon={<FolderKanban className="w-5 h-5" />}>
            Workspace
          </SidebarButton>
          <SidebarButton active={activeTab === 'knowledge'} onClick={() => onTabChange('knowledge')} icon={<BrainCircuit className="w-5 h-5" />}>
            Knowledge
          </SidebarButton>
          <SidebarButton active={activeTab === 'upload'} onClick={() => onTabChange('upload')} icon={<Upload className="w-5 h-5" />}>
            Upload
          </SidebarButton>
          <SidebarButton active={activeTab === 'record'} onClick={() => onTabChange('record')} icon={<Mic className="w-5 h-5" />}>
            Record
          </SidebarButton>
          <SidebarButton active={activeTab === 'tasks'} onClick={() => onTabChange('tasks')} icon={<List className="w-5 h-5" />}>
            Tasks
          </SidebarButton>
          <SidebarButton active={activeTab === 'prompts'} onClick={() => onTabChange('prompts')} icon={<Sparkles className="w-5 h-5" />}>
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
          <SidebarButton active={activeTab === 'settings'} onClick={() => onTabChange('settings')} icon={<Settings className="w-5 h-5" />}>
            Settings
          </SidebarButton>
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-4 py-3 mt-1 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
          >
            <LogOut className="w-5 h-5" />
            Sign Out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden relative bg-slate-50">
        <div
          ref={mainScrollRef}
          className="absolute inset-x-0 top-0 bottom-0 overflow-y-auto custom-scrollbar mobile-main-scroll-region"
        >
          <div className="max-w-7xl w-full mx-auto px-2 py-3 sm:px-4 sm:py-4 lg:p-6 h-full flex flex-col">
            {children}
          </div>
        </div>
      </main>

      <nav className="lg:hidden mobile-bottom-nav fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex items-center justify-around px-2 py-2 z-30 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
        <BottomNavButton active={activeTab === 'notebook'} onClick={() => { onTabChange('notebook'); onMobileMenuChange(false); }} icon={<FolderKanban className="w-5 h-5" />} label="Workspace" />
        <BottomNavButton active={activeTab === 'knowledge'} onClick={() => { onTabChange('knowledge'); onMobileMenuChange(false); }} icon={<BrainCircuit className="w-5 h-5" />} label="Search" />
        <div className="relative -top-5">
          <button
            onClick={() => { onTabChange('record'); onMobileMenuChange(false); }}
            className={cn(
              'w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-95',
              activeTab === 'record' ? 'bg-indigo-700 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700',
            )}
          >
            <Mic className="w-6 h-6" />
          </button>
        </div>
        <BottomNavButton active={activeTab === 'upload'} onClick={() => { onTabChange('upload'); onMobileMenuChange(false); }} icon={<Upload className="w-5 h-5" />} label="Upload" />
        <BottomNavButton active={isMobileMenuOpen} onClick={() => onMobileMenuChange(true)} icon={<Menu className="w-5 h-5" />} label="More" />
      </nav>

      {isMobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm transition-opacity" onClick={() => onMobileMenuChange(false)}>
          <div
            className="absolute bottom-0 left-0 right-0 bg-white rounded-t-3xl shadow-2xl transition-transform transform translate-y-0 max-h-[85vh] flex flex-col"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <h2 className="text-xl font-bold text-slate-800">More</h2>
              <button onClick={() => onMobileMenuChange(false)} className="p-2 bg-slate-100 rounded-full text-slate-500 hover:bg-slate-200">
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
                <DrawerButton icon={<List className="w-5 h-5 text-slate-500" />} label="Tasks" onClick={onOpenTasksTab} />
                <DrawerButton icon={<Sparkles className="w-5 h-5 text-slate-500" />} label="Summary Prompts" onClick={() => { onTabChange('prompts'); onMobileMenuChange(false); }} />
                <DrawerButton icon={<Settings className="w-5 h-5 text-slate-500" />} label="Settings & Preferences" onClick={() => { onTabChange('settings'); onMobileMenuChange(false); }} />
              </div>

              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-2">Help</h3>
                <DrawerButton icon={<HelpCircle className="w-5 h-5 text-slate-500" />} label="How It Works" onClick={() => { alert('Use upload or record to create queued transcription jobs, then manage them by notebook, tags, summaries, and global knowledge search.'); onMobileMenuChange(false); }} />
              </div>

              <button
                onClick={onLogout}
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
