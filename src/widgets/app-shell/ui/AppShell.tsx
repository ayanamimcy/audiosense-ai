import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowUp, AudioLines, Loader2, LogOut, MessageSquare, Mic, Plus, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { useAppDataContext } from '@/app/providers/app-data-context';
import { INBOX_FILTER, NOTEBOOK_FILTER_PARAM } from '@/entities/notebook';
import type { AuthUser } from '@/entities/user';
import { useNewRecording } from '@/features/new-recording';
import { RECORDING_NAVIGATION_EVENT, useRecordingDraft } from '@/features/recording-draft/model/recording-draft-context';
import { NotebookNav } from '@/features/notebook-nav';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

type Section = 'recordings' | 'ask' | 'settings';

function useActiveSection(): Section {
  const { pathname } = useLocation();
  if (pathname.startsWith('/knowledge')) return 'ask';
  if (pathname.startsWith('/settings')) return 'settings';
  return 'recordings';
}

/** Lets an in-progress recording veto navigation (it listens for this event). */
export function canLeaveCurrentPage(destination: string) {
  return window.dispatchEvent(new CustomEvent(RECORDING_NAVIGATION_EVENT, {
    cancelable: true,
    detail: { destination },
  }));
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

function RailLink({
  to,
  active,
  icon,
  children,
}: {
  to: string;
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors',
        active
          ? 'bg-white font-medium text-stone-900 shadow-[0_0_0_1px_var(--color-stone-200)]'
          : 'text-stone-700 hover:bg-stone-200/50',
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

function BottomNavLink({
  to,
  active,
  icon,
  label,
}: {
  to: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-w-16 flex-col items-center gap-0.5 py-1 text-[11px]',
        active ? 'font-semibold text-stone-900' : 'font-medium text-stone-500',
      )}
    >
      {icon}
      {label}
    </Link>
  );
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
  const activeSection = useActiveSection();
  const { openNewRecording } = useNewRecording();
  const { pendingRecording } = useRecordingDraft();
  const { refreshAll, currentWorkspaceId, selectWorkspace } = useAppDataContext();
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pullStartY = useRef(0);
  const isPulling = useRef(false);

  // Recording detail is a full-screen view on mobile: no header, no bottom nav.
  const isMobileChromeHidden = pathname.startsWith('/notebook/');
  // Pages that manage their own scrolling (split panes) should not scroll the shell.
  const isFixedHeightPage = pathname.startsWith('/notebook/') || pathname.startsWith('/knowledge');

  const PULL_THRESHOLD = 60;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const el = mainScrollRef.current;
    if (!el || isRefreshing || isFixedHeightPage || !isTouchAtTopOfScrollableChain(e.target, el)) return;
    pullStartY.current = e.touches[0].clientY;
    isPulling.current = true;
  }, [mainScrollRef, isRefreshing, isFixedHeightPage]);

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

  useEffect(() => {
    const el = mainScrollRef.current;
    if (!el) return;
    const handleScroll = () => setShowScrollTop(el.scrollTop > 300);
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [mainScrollRef]);

  const handleWorkspaceChange = async (workspaceId: string) => {
    if (!workspaceId || workspaceId === currentWorkspaceId) {
      return;
    }
    if (!canLeaveCurrentPage('workspace')) {
      return;
    }

    try {
      // Notebook filters and the open recording belong to the old workspace.
      if (pathname.startsWith('/notebook') && (pathname !== '/notebook' || search)) {
        navigate({ pathname: '/notebook', search: '' }, { replace: true });
      }
      await selectWorkspace(workspaceId);
    } catch (error) {
      console.error('Failed to switch workspace:', error);
      window.alert(error instanceof Error ? error.message : 'Failed to switch workspace.');
    }
  };

  const handleNewRecording = () => {
    const notebookParam = new URLSearchParams(search).get(NOTEBOOK_FILTER_PARAM);
    openNewRecording('record', {
      notebookId: notebookParam && notebookParam !== INBOX_FILTER ? notebookParam : null,
    });
  };

  const newRecordingHint = pendingRecording ? 'A recording is waiting to upload' : undefined;

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-canvas text-stone-900 lg:flex-row">
      {/* Mobile header */}
      {!isMobileChromeHidden ? (
        <header
          className="flex shrink-0 items-center gap-3 px-4 pb-1 lg:hidden"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
        >
          <div className="min-w-0 flex-1">
            <WorkspaceSwitcher variant="title" onSwitch={(id) => void handleWorkspaceChange(id)} />
          </div>
          <Link
            to="/settings"
            aria-label="Settings"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-800"
          >
            {currentUser.name.charAt(0).toUpperCase()}
          </Link>
        </header>
      ) : null}

      {/* Desktop rail */}
      <nav
        aria-label="Main"
        className="hidden h-full w-60 shrink-0 flex-col gap-1 border-r border-stone-200 px-3 py-4 lg:flex"
      >
        <WorkspaceSwitcher variant="rail" onSwitch={(id) => void handleWorkspaceChange(id)} />

        <button
          type="button"
          onClick={handleNewRecording}
          title={newRecordingHint}
          className="relative my-3 flex min-h-10 items-center justify-center gap-2 rounded-xl bg-stone-900 text-sm font-medium text-white hover:bg-stone-800"
        >
          <Plus className="h-4 w-4" />
          New recording
          {pendingRecording ? (
            <span className="absolute top-2 right-2.5 h-2 w-2 rounded-full bg-amber-400" aria-label={newRecordingHint} />
          ) : null}
        </button>

        <RailLink to="/notebook" active={activeSection === 'recordings'} icon={<AudioLines className="h-4 w-4" />}>
          Recordings
        </RailLink>
        <RailLink to="/knowledge" active={activeSection === 'ask'} icon={<MessageSquare className="h-4 w-4" />}>
          Ask AI
        </RailLink>

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto custom-scrollbar">
          <NotebookNav />
        </div>

        <div className="mt-2 flex flex-col gap-1 border-t border-stone-200 pt-2">
          <RailLink to="/settings" active={activeSection === 'settings'} icon={<SlidersHorizontal className="h-4 w-4" />}>
            Settings
          </RailLink>
          <div className="flex items-center gap-2.5 px-2.5 py-1.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-800">
              {currentUser.name.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-stone-700" title={currentUser.email}>
              {currentUser.name}
            </span>
            <button
              type="button"
              onClick={onLogout}
              aria-label="Sign out"
              title="Sign out"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-200/60 hover:text-stone-800"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </nav>

      <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <div
          ref={mainScrollRef}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={() => void handleTouchEnd()}
          className={cn(
            'absolute inset-x-0 top-0 bottom-0 custom-scrollbar',
            isFixedHeightPage ? 'overflow-hidden' : 'overflow-y-auto',
            !isMobileChromeHidden && 'mobile-main-scroll-region',
          )}
        >
          {(pullDistance > 0 || isRefreshing) && (
            <div
              className="flex items-center justify-center py-2 text-stone-500 lg:hidden"
              style={pullDistance > 0 ? { height: pullDistance } : undefined}
            >
              <Loader2
                className={cn('h-5 w-5', isRefreshing && 'animate-spin')}
                style={!isRefreshing ? { opacity: Math.min(pullDistance / 60, 1) } : undefined}
              />
            </div>
          )}
          <div className="flex h-full w-full flex-col">{children}</div>
        </div>
      </main>

      {showScrollTop && !isMobileChromeHidden && (
        <button
          type="button"
          onClick={() => mainScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-[calc(var(--mobile-bottom-nav-height)+env(safe-area-inset-bottom)+0.75rem)] left-4 z-30 flex h-10 w-10 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 shadow-lg lg:hidden"
          aria-label="Back to top"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      )}

      {/* Mobile bottom nav */}
      {!isMobileChromeHidden ? (
        <nav
          aria-label="Main"
          className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-stone-200 bg-white px-6 pt-2 lg:hidden"
        >
          <BottomNavLink
            to="/notebook"
            active={activeSection === 'recordings'}
            icon={<AudioLines className="h-[22px] w-[22px]" />}
            label="Recordings"
          />
          <button
            type="button"
            onClick={handleNewRecording}
            aria-label="New recording"
            className="relative -mt-1 flex h-14 w-14 items-center justify-center rounded-full bg-stone-900 text-white shadow-[0_8px_20px_rgba(28,25,23,0.22)] active:scale-95"
          >
            <Mic className="h-6 w-6" />
            {pendingRecording ? (
              <span className="absolute top-1 right-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-amber-400" />
            ) : null}
          </button>
          <BottomNavLink
            to="/knowledge"
            active={activeSection === 'ask'}
            icon={<MessageSquare className="h-[22px] w-[22px]" />}
            label="Ask AI"
          />
        </nav>
      ) : null}
    </div>
  );
}
