import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowUp,
  BrainCircuit,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  FolderKanban,
  HelpCircle,
  Loader2,
  LogOut,
  Menu,
  Mic,
  Plus,
  Settings,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { SidebarButton } from './SidebarButton';
import { BottomNavButton } from './BottomNavButton';
import { DrawerButton } from './DrawerButton';
import { useAppDataContext } from '@/contexts/AppDataContext';
import type { AuthUser } from '@/types';

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

function isScrollableElement(node: HTMLElement) {
  const style = window.getComputedStyle(node);
  const overflowY = style.overflowY;
  return (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') && node.scrollHeight > node.clientHeight;
}

function isTouchAtTopOfScrollableChain(target: EventTarget | null, boundary: HTMLElement | null) {
  if (!(target instanceof HTMLElement) || !boundary) {
    return true;
  }

  let current: HTMLElement | null = target;
  while (current && current !== boundary) {
    if (isScrollableElement(current) && current.scrollTop > 0) {
      return false;
    }
    current = current.parentElement;
  }

  return boundary.scrollTop <= 0;
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
  const { pathname, search } = useLocation();
  const activeTab = useActiveTab();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isNewMenuOpen, setIsNewMenuOpen] = useState(false);
  const [isWorkspaceSheetOpen, setIsWorkspaceSheetOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pullStartY = useRef(0);
  const isPulling = useRef(false);
  const desktopNewMenuRef = useRef<HTMLDivElement | null>(null);
  const { refreshAll, workspaces, currentWorkspace, currentWorkspaceId, selectWorkspace } = useAppDataContext();
  const isMobileDetailChromeHidden =
    pathname.startsWith('/notebook/');

  const PULL_THRESHOLD = 60;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const el = mainScrollRef.current;
    if (!el || isRefreshing || !isTouchAtTopOfScrollableChain(e.target, el)) return;
    pullStartY.current = e.touches[0].clientY;
    isPulling.current = true;
  }, [mainScrollRef, isRefreshing]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling.current) return;
    const dy = e.touches[0].clientY - pullStartY.current;
    if (dy > 0) {
      setPullDistance(Math.min(dy * 0.4, 80));
    } else {
      isPulling.current = false;
      setPullDistance(0);
    }
  }, []);

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling.current) return;
    isPulling.current = false;
    if (pullDistance >= PULL_THRESHOLD) {
      setIsRefreshing(true);
      setPullDistance(0);
      try {
        await refreshAll();
      } finally {
        setIsRefreshing(false);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, refreshAll]);

  const handleMainScroll = useCallback(() => {
    const el = mainScrollRef.current;
    if (!el) return;
    setShowScrollTop(el.scrollTop > 300);
  }, [mainScrollRef]);

  useEffect(() => {
    const el = mainScrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleMainScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleMainScroll);
  }, [mainScrollRef, handleMainScroll]);

  useEffect(() => {
    if (!isNewMenuOpen || typeof window === 'undefined' || window.innerWidth < 1024) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) {
        return;
      }

      if (desktopNewMenuRef.current?.contains(event.target)) {
        return;
      }

      setIsNewMenuOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isNewMenuOpen]);

  const goTo = (tab: Tab) => {
    navigate(TAB_TO_PATH[tab]);
    setIsMobileMenuOpen(false);
  };

  const handleWorkspaceChange = async (workspaceId: string) => {
    if (!workspaceId || workspaceId === currentWorkspaceId) {
      return;
    }

    try {
      const nextPathname = pathname.startsWith('/notebook/') ? '/notebook' : pathname;
      if (nextPathname !== pathname || search) {
        navigate({ pathname: nextPathname, search: '' }, { replace: true });
      }

      await selectWorkspace(workspaceId);
      setIsMobileMenuOpen(false);
      setIsNewMenuOpen(false);
      setIsWorkspaceSheetOpen(false);
    } catch (error) {
      console.error('Failed to switch workspace:', error);
      window.alert(error instanceof Error ? error.message : 'Failed to switch workspace.');
    }
  };

  return (
    <div className="h-[100dvh] bg-slate-50 text-slate-900 flex flex-col lg:flex-row overflow-hidden relative">
      {!isMobileDetailChromeHidden ? (
        <header
          className="lg:hidden bg-white border-b border-slate-200 px-4 pb-2 pt-3 flex items-center justify-between shrink-0 z-20 shadow-sm"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
        >
          <button
            type="button"
            onClick={() => setIsWorkspaceSheetOpen(true)}
            className="flex min-w-0 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-left shadow-sm transition-colors active:scale-[0.99]"
          >
            <div className="bg-indigo-600 p-1.5 rounded-lg shadow-sm shrink-0">
              <Mic className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold tracking-tight text-slate-800">
                {currentWorkspace?.name || 'Select workspace'}
              </p>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">
                Current workspace
              </p>
            </div>
            <ChevronDown className="w-4 h-4 shrink-0 text-slate-400" />
          </button>
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
          {!isSidebarCollapsed && workspaces.length > 0 ? (
            <div className="px-2 pb-3">
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Current workspace
              </label>
              <select
                value={currentWorkspaceId || ''}
                onChange={(event) => void handleWorkspaceChange(event.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <SidebarButton collapsed={isSidebarCollapsed} active={activeTab === 'notebook'} onClick={() => goTo('notebook')} icon={<FolderKanban className="w-5 h-5" />}>
            Recordings
          </SidebarButton>
          <SidebarButton collapsed={isSidebarCollapsed} active={activeTab === 'knowledge'} onClick={() => goTo('knowledge')} icon={<BrainCircuit className="w-5 h-5" />}>
            Knowledge
          </SidebarButton>
          <div ref={desktopNewMenuRef} className="relative">
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
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={() => void handleTouchEnd()}
          className="absolute inset-x-0 top-0 bottom-0 overflow-y-auto custom-scrollbar mobile-main-scroll-region"
        >
          {(pullDistance > 0 || isRefreshing) && (
            <div className="flex items-center justify-center py-2 text-indigo-500 lg:hidden" style={pullDistance > 0 ? { height: pullDistance } : undefined}>
              <Loader2 className={cn('w-5 h-5', isRefreshing && 'animate-spin')} style={!isRefreshing ? { opacity: Math.min(pullDistance / 60, 1) } : undefined} />
            </div>
          )}
          <div className="w-full px-2 py-2 sm:px-4 sm:py-3 lg:px-6 lg:py-6 h-full flex flex-col">
            {children}
          </div>
        </div>
      </main>

      {showScrollTop && !isMobileDetailChromeHidden && (
        <button
          type="button"
          onClick={() => mainScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          className="lg:hidden fixed z-30 left-4 bottom-[calc(var(--mobile-bottom-nav-height)+env(safe-area-inset-bottom)+0.75rem)] flex h-9 w-9 items-center justify-center rounded-full bg-white border border-slate-200 text-slate-500 shadow-lg active:scale-95 transition-transform"
          aria-label="Back to top"
        >
          <ArrowUp className="w-4 h-4" />
        </button>
      )}

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
                {workspaces.length > 0 ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      Current workspace
                    </label>
                    <select
                      value={currentWorkspaceId || ''}
                      onChange={(event) => void handleWorkspaceChange(event.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                    >
                      {workspaces.map((workspace) => (
                        <option key={workspace.id} value={workspace.id}>
                          {workspace.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
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

      {isWorkspaceSheetOpen && !isMobileDetailChromeHidden && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm"
          onClick={() => setIsWorkspaceSheetOpen(false)}
        >
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-[28px] bg-white px-5 pb-[calc(env(safe-area-inset-bottom,0px)+1.25rem)] pt-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-200" />
            <div className="mb-4 text-center">
              <h2 className="text-base font-semibold text-slate-900">Switch Workspace</h2>
              <p className="mt-1 text-sm text-slate-500">Choose where you want to browse, search, and chat.</p>
            </div>

            <div className="space-y-2">
              {workspaces.map((workspace) => {
                const isCurrent = workspace.id === currentWorkspaceId;
                return (
                  <button
                    key={workspace.id}
                    type="button"
                    onClick={() => void handleWorkspaceChange(workspace.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors',
                      isCurrent
                        ? 'border-indigo-200 bg-indigo-50'
                        : 'border-slate-200 bg-white hover:bg-slate-50',
                    )}
                  >
                    <div
                      className={cn(
                        'flex h-11 w-11 items-center justify-center rounded-2xl text-base font-semibold',
                        isCurrent ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600',
                      )}
                    >
                      {workspace.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{workspace.name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {workspace.description || (isCurrent ? 'Current workspace' : 'Tap to switch')}
                      </p>
                    </div>
                    {isCurrent ? (
                      <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                        Current
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
