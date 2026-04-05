import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  BrainCircuit,
  ChevronsLeft,
  ChevronsRight,
  FolderKanban,
  HelpCircle,
  LogOut,
  Menu,
  Mic,
  Plus,
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

export type Tab = 'upload' | 'record' | 'notebook' | 'knowledge' | 'prompts' | 'settings';

const TAB_TO_PATH: Record<Tab, string> = {
  notebook: '/notebook',
  knowledge: '/knowledge',
  upload: '/upload',
  record: '/record',
  prompts: '/prompts',
  settings: '/settings',
};

const PATH_TO_TAB: Record<string, Tab> = {
  '/': 'notebook',
  '/notebook': 'notebook',
  '/knowledge': 'knowledge',
  '/upload': 'upload',
  '/record': 'record',
  '/prompts': 'prompts',
  '/settings': 'settings',
};

function useActiveTab(): Tab {
  const { pathname } = useLocation();
  if (pathname.startsWith('/notebook')) return 'notebook';
  return PATH_TO_TAB[pathname] || 'notebook';
}

export function AppShell({
  currentUser,
  onLogout,
  mainScrollRef,
  children,
}: {
  currentUser: AuthUser;
  onLogout: () => void;
  mainScrollRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activeTab = useActiveTab();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isNewMenuOpen, setIsNewMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const isMobileDetailChromeHidden =
    pathname.startsWith('/notebook/');

  const goTo = (tab: Tab) => {
    navigate(TAB_TO_PATH[tab]);
    setIsMobileMenuOpen(false);
  };

  return (
    <div className="h-[100dvh] bg-slate-50 text-slate-900 flex flex-col lg:flex-row overflow-hidden relative">
      {!isMobileDetailChromeHidden ? (
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
      ) : null}

      <aside className={cn(
        'hidden lg:flex bg-white border-r border-slate-200 flex-col h-full shadow-sm z-20 shrink-0 transition-[width] duration-200',
        isSidebarCollapsed ? 'w-16' : 'w-64',
      )}>
        <div className={cn(
          'flex items-center border-b border-slate-100 shrink-0',
          isSidebarCollapsed ? 'justify-center p-3' : 'gap-3 p-6',
        )}>
          <div className="bg-indigo-600 p-2 rounded-lg shadow-sm shrink-0">
            <Mic className="w-5 h-5 text-white" />
          </div>
          {!isSidebarCollapsed && (
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight text-slate-800">AudioSense AI</h1>
              <p className="text-xs text-slate-500 mt-0.5">Auth, queue, search, knowledge</p>
            </div>
          )}
        </div>

        <nav className={cn(
          'flex-1 flex-col space-y-1 custom-scrollbar',
          isSidebarCollapsed ? 'p-2 overflow-visible' : 'p-4 overflow-y-auto',
        )}>
          <SidebarButton collapsed={isSidebarCollapsed} active={activeTab === 'notebook'} onClick={() => goTo('notebook')} icon={<FolderKanban className="w-5 h-5" />}>
            Workspace
          </SidebarButton>
          <SidebarButton collapsed={isSidebarCollapsed} active={activeTab === 'knowledge'} onClick={() => goTo('knowledge')} icon={<BrainCircuit className="w-5 h-5" />}>
            Knowledge
          </SidebarButton>
          <div className="relative">
            <SidebarButton collapsed={isSidebarCollapsed} active={activeTab === 'upload' || activeTab === 'record'} onClick={() => setIsNewMenuOpen((v) => !v)} icon={<Plus className="w-5 h-5" />}>
              New
            </SidebarButton>
            {isNewMenuOpen && (
              <div className={cn(
                'absolute z-50 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden min-w-[160px]',
                isSidebarCollapsed ? 'left-full ml-2 top-0' : 'left-0 w-full',
              )}>
                <button onClick={() => { goTo('record'); setIsNewMenuOpen(false); }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                  <Mic className="w-4 h-4 text-indigo-500" /> Record
                </button>
                <button onClick={() => { goTo('upload'); setIsNewMenuOpen(false); }} className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 border-t border-slate-100">
                  <Upload className="w-4 h-4 text-slate-500" /> Upload file
                </button>
              </div>
            )}
          </div>
          <SidebarButton collapsed={isSidebarCollapsed} active={activeTab === 'prompts'} onClick={() => goTo('prompts')} icon={<Sparkles className="w-5 h-5" />}>
            Prompts
          </SidebarButton>
        </nav>

        <div className={cn('border-t border-slate-100', isSidebarCollapsed ? 'p-2' : 'p-4')}>
          {isSidebarCollapsed ? (
            <div className="flex justify-center mb-2">
              <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-sm" title={currentUser.name}>
                {currentUser.name.charAt(0).toUpperCase()}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 px-4 py-3 mb-2 rounded-xl bg-slate-50 border border-slate-100">
              <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-sm">
                {currentUser.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">{currentUser.name}</p>
                <p className="text-xs text-slate-500 truncate">{currentUser.email}</p>
              </div>
            </div>
          )}
          <SidebarButton collapsed={isSidebarCollapsed} active={activeTab === 'settings'} onClick={() => goTo('settings')} icon={<Settings className="w-5 h-5" />}>
            Settings
          </SidebarButton>
          <SidebarButton collapsed={isSidebarCollapsed} active={false} onClick={onLogout} icon={<LogOut className="w-5 h-5" />} variant="danger">
            Sign Out
          </SidebarButton>

          <button
            onClick={() => setIsSidebarCollapsed((v) => !v)}
            className="w-full flex items-center justify-center gap-2 mt-2 py-2 rounded-lg text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors"
            title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isSidebarCollapsed ? <ChevronsRight className="w-4 h-4" /> : <ChevronsLeft className="w-4 h-4" />}
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden relative bg-slate-50">
        <div
          ref={mainScrollRef}
          className="absolute inset-x-0 top-0 bottom-0 overflow-y-auto custom-scrollbar mobile-main-scroll-region"
        >
          <div className="w-full px-2 py-3 sm:px-4 sm:py-4 lg:px-6 lg:py-6 h-full flex flex-col">
            {children}
          </div>
        </div>
      </main>

      {!isMobileDetailChromeHidden ? (
        <>
          <nav className="lg:hidden mobile-bottom-nav fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex items-center justify-around px-2 py-2 z-30 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
            <BottomNavButton active={activeTab === 'notebook'} onClick={() => goTo('notebook')} icon={<FolderKanban className="w-5 h-5" />} label="Home" />
            <BottomNavButton active={activeTab === 'knowledge'} onClick={() => goTo('knowledge')} icon={<BrainCircuit className="w-5 h-5" />} label="Search" />
            <div className="relative -top-5">
              <button
                onClick={() => setIsNewMenuOpen((v) => !v)}
                className={cn(
                  'w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-95',
                  isNewMenuOpen ? 'bg-slate-800 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700',
                )}
              >
                {isNewMenuOpen ? <X className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
              </button>
            </div>
            <BottomNavButton active={activeTab === 'prompts'} onClick={() => goTo('prompts')} icon={<Sparkles className="w-5 h-5" />} label="Prompts" />
            <BottomNavButton active={isMobileMenuOpen} onClick={() => setIsMobileMenuOpen(true)} icon={<Menu className="w-5 h-5" />} label="More" />
          </nav>

          {isNewMenuOpen && (
            <div className="lg:hidden fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm" onClick={() => setIsNewMenuOpen(false)}>
              <div
                className="absolute bottom-28 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => { goTo('upload'); setIsNewMenuOpen(false); }}
                  className="flex items-center gap-3 bg-white rounded-full pl-4 pr-5 py-3 shadow-xl border border-slate-200"
                >
                  <Upload className="w-5 h-5 text-slate-600" />
                  <span className="text-sm font-medium text-slate-800">Upload file</span>
                </button>
                <button
                  onClick={() => { goTo('record'); setIsNewMenuOpen(false); }}
                  className="flex items-center gap-3 bg-white rounded-full pl-4 pr-5 py-3 shadow-xl border border-slate-200"
                >
                  <Mic className="w-5 h-5 text-indigo-600" />
                  <span className="text-sm font-medium text-slate-800">Quick record</span>
                </button>
              </div>
            </div>
          )}
        </>
      ) : null}

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
                <DrawerButton icon={<Settings className="w-5 h-5 text-slate-500" />} label="Settings & Preferences" onClick={() => goTo('settings')} />
              </div>

              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-2">Help</h3>
                <DrawerButton icon={<HelpCircle className="w-5 h-5 text-slate-500" />} label="How It Works" onClick={() => { alert('Use upload or record to create queued transcription jobs, then manage them by notebook, tags, summaries, and global knowledge search.'); setIsMobileMenuOpen(false); }} />
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
