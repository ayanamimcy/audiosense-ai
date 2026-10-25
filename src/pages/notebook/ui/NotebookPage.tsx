import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { AudioLines, ChevronDown, Loader2, MoreHorizontal, Plus, Search, X } from 'lucide-react';
import { apiFetch, apiJson } from '@/shared/api/base';
import { cn } from '@/shared/lib/cn';
import { Dialog } from '@/shared/ui/Dialog';
import { DropdownMenu } from '@/shared/ui/DropdownMenu';
import { useAppDataContext } from '@/app/providers/app-data-context';
import { INBOX_FILTER, matchesNotebookFilter, useNotebookFilter } from '@/entities/notebook';
import { isTaskActive, type Task } from '@/entities/task';
import { useNewRecording } from '@/features/new-recording';
import { NotebookNav } from '@/features/notebook-nav';
import { BatchActionBar, RecordingList } from '@/widgets/recording-list/ui';
import { TaskDetail } from '@/widgets/task-detail/ui';

type StatusFilter = 'all' | 'active' | 'failed';

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-[13px] font-medium transition-colors',
        active ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-50',
      )}
    >
      {children}
    </button>
  );
}

export default function NotebookView() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const { id } = useParams<{ id?: string }>();
  const {
    tasks, notebooks, tags, workspaces, currentWorkspaceId, selectWorkspace,
    fetchTasks, fetchTags,
    selectTask, selectedTask, selectedTaskLoading, selectedTaskId,
    refreshTasksAndSelection,
  } = useAppDataContext();
  const { openNewRecording } = useNewRecording();
  const [notebookFilter, setNotebookFilter] = useNotebookFilter();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [isNotebookSheetOpen, setIsNotebookSheetOpen] = useState(false);

  // Server-side search state
  const [serverResults, setServerResults] = useState<Task[] | null>(null);
  const [searchError, setSearchError] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimerRef = useRef<number | null>(null);

  const refreshList = useCallback(async () => {
    await fetchTasks();
    await fetchTags();
  }, [fetchTasks, fetchTags]);

  const runServerSearch = useCallback((q: string) => {
    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
    if (!q.trim()) {
      setServerResults(null);
      setSearchError(false);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    setSearchError(false);
    searchTimerRef.current = window.setTimeout(async () => {
      try {
        setServerResults(await apiJson<Task[]>(`/api/search/tasks?q=${encodeURIComponent(q.trim())}`));
        setSearchError(false);
      } catch {
        setServerResults([]);
        setSearchError(true);
      } finally {
        setIsSearching(false);
      }
    }, 350);
  }, []);

  useEffect(() => {
    runServerSearch(searchQuery);
    return () => { if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current); };
  }, [searchQuery, runServerSearch, currentWorkspaceId]);

  // Filters and selections belong to a workspace.
  useEffect(() => {
    setSearchQuery('');
    setStatusFilter('all');
    setTagFilter(null);
    setServerResults(null);
    setSearchError(false);
    setIsSearching(false);
    setCheckedIds(new Set());
  }, [currentWorkspaceId]);

  useEffect(() => {
    if (id) {
      void (async () => {
        const task = await selectTask(id);
        if (task?.workspaceId && currentWorkspaceId && task.workspaceId !== currentWorkspaceId) {
          await selectWorkspace(task.workspaceId, task.id);
        }
      })();
      return;
    }
    void selectTask(null);
  }, [id, currentWorkspaceId, selectTask, selectWorkspace]);

  const hasActiveSearch = Boolean(searchQuery.trim());

  const scopedTasks = useMemo(() => {
    const base = hasActiveSearch ? (serverResults ?? []) : tasks;
    return base.filter((task) => matchesNotebookFilter(task, notebookFilter));
  }, [hasActiveSearch, serverResults, tasks, notebookFilter]);

  const activeCount = scopedTasks.filter(isTaskActive).length;
  const failedCount = scopedTasks.filter((task) => task.status === 'failed').length;

  const filteredTasks = useMemo(() => {
    let result = scopedTasks;
    if (statusFilter === 'active') result = result.filter(isTaskActive);
    if (statusFilter === 'failed') result = result.filter((task) => task.status === 'failed');
    if (tagFilter) result = result.filter((task) => task.tags.includes(tagFilter));
    if (!hasActiveSearch) result = [...result].sort((a, b) => b.createdAt - a.createdAt);
    return result;
  }, [scopedTasks, statusFilter, tagFilter, hasActiveSearch]);

  // Drop selections that are no longer visible after a filter change.
  useEffect(() => {
    setCheckedIds((current) => {
      if (current.size === 0) return current;
      const visible = new Set(filteredTasks.map((task) => task.id));
      const next = new Set([...current].filter((taskId) => visible.has(taskId)));
      return next.size === current.size ? current : next;
    });
  }, [filteredTasks]);

  const notebookName = !notebookFilter
    ? 'All recordings'
    : notebookFilter === INBOX_FILTER
      ? 'Inbox'
      : notebooks.find((notebook) => notebook.id === notebookFilter)?.name || 'Notebook';

  const toggleChecked = (taskId: string) => {
    setCheckedIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
      return next;
    });
  };

  const allChecked = filteredTasks.length > 0 && checkedIds.size === filteredTasks.length;

  const runBatch = async (operation: (taskId: string) => Promise<unknown>, label: string) => {
    const ids = [...checkedIds];
    setIsProcessingBatch(true);
    try {
      const results = await Promise.allSettled(ids.map(async (taskId) => {
        const res = await operation(taskId);
        if (res instanceof Response && !res.ok) throw new Error(`HTTP ${res.status}`);
        return res;
      }));
      const failedIds = ids.filter((_, index) => results[index].status === 'rejected');
      await refreshList();
      if (selectedTaskId && ids.includes(selectedTaskId)) {
        await refreshTasksAndSelection(selectedTaskId);
      }
      setCheckedIds(new Set(failedIds));
      if (failedIds.length > 0) {
        alert(`${label}: ${ids.length - failedIds.length} succeeded, ${failedIds.length} failed. Failed items stay selected.`);
      }
    } finally {
      setIsProcessingBatch(false);
    }
  };

  const handleBatchDelete = async () => {
    if (!confirm(`Delete ${checkedIds.size} recordings? This cannot be undone.`)) return;
    const deletingOpenTask = Boolean(id && checkedIds.has(id));
    await runBatch((taskId) => apiFetch(`/api/tasks/${taskId}`, { method: 'DELETE' }), 'Delete');
    if (deletingOpenTask) navigate({ pathname: '/notebook', search }, { replace: true });
  };

  const handleBatchNotebook = (notebookId: string | null) => runBatch(
    (taskId) => apiFetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notebookId }),
    }),
    'Move',
  );

  const handleBatchTags = (value: string) => runBatch(
    (taskId) => apiFetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: value }),
    }),
    'Tags',
  );

  const handleBatchWorkspace = async (workspaceId: string) => {
    const workspaceName = workspaces.find((workspace) => workspace.id === workspaceId)?.name || 'the workspace';
    if (!confirm(`Move ${checkedIds.size} recordings to ${workspaceName}?`)) return;
    setIsProcessingBatch(true);
    try {
      await apiJson('/api/tasks/batch/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskIds: [...checkedIds], workspaceId }),
      });
      if (id && checkedIds.has(id)) navigate({ pathname: '/notebook', search }, { replace: true });
      setCheckedIds(new Set());
      await refreshList();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to move recordings.');
    } finally {
      setIsProcessingBatch(false);
    }
  };

  const activeTask = selectedTask?.id === id ? selectedTask : null;

  const tagMenu = (
    <DropdownMenu
      align="left"
      items={[
        ...(tagFilter ? [{ key: '__clear', label: 'Any tag', onSelect: () => setTagFilter(null) }] : []),
        ...tags.slice(0, 30).map((tag) => ({
          key: tag.name,
          label: <span className="flex justify-between gap-3"><span className="truncate">#{tag.name}</span><span className="text-stone-500">{tag.count}</span></span>,
          onSelect: () => setTagFilter(tag.name),
        })),
      ]}
      trigger={({ onClick, open }) => (
        tagFilter ? (
          <span className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-stone-900 bg-stone-900 pr-1 pl-3 text-[13px] font-medium text-white">
            <button type="button" onClick={onClick} aria-expanded={open}>#{tagFilter}</button>
            <button
              type="button"
              onClick={() => setTagFilter(null)}
              aria-label="Clear tag filter"
              className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-white/15"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={onClick}
            aria-expanded={open}
            disabled={tags.length === 0}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-dashed border-stone-300 px-3 text-[13px] font-medium text-stone-700 hover:bg-white disabled:opacity-50"
          >
            Tag
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        )
      )}
    />
  );

  return (
    <div className={cn('flex lg:h-full', id ? 'h-full' : 'min-h-full')}>
      {/* List column */}
      <section
        aria-label="Recordings"
        className={cn(
          'w-full flex-col gap-3 px-4 pt-2 pb-6 lg:flex lg:h-full lg:w-[380px] lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-stone-200 lg:px-3 lg:pt-4 custom-scrollbar',
          id ? 'hidden' : 'flex',
        )}
      >
        <div className="hidden items-baseline justify-between px-1.5 lg:flex">
          <h1 className="text-lg font-semibold text-stone-900">{notebookName}</h1>
          <span className="text-xs text-stone-500">{filteredTasks.length} recordings</span>
        </div>

        <label className="relative block">
          <span className="sr-only">Search recordings</span>
          {isSearching ? (
            <Loader2 className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 animate-spin text-stone-500" />
          ) : (
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-stone-500" />
          )}
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search titles, tags, transcripts"
            className="h-11 w-full rounded-xl border border-stone-200 bg-white pr-3 pl-9 text-base text-stone-900 placeholder:text-stone-500 focus:border-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10 lg:h-10 lg:text-sm"
          />
        </label>

        {/* Mobile: notebooks as chips (the desktop rail lists them) */}
        <div className="-mx-4 flex shrink-0 gap-1.5 overflow-x-auto px-4 pb-0.5 lg:hidden">
          <Chip active={!notebookFilter} onClick={() => setNotebookFilter(null)}>All</Chip>
          <Chip active={notebookFilter === INBOX_FILTER} onClick={() => setNotebookFilter(INBOX_FILTER)}>Inbox</Chip>
          {notebooks.map((notebook) => (
            <Chip key={notebook.id} active={notebookFilter === notebook.id} onClick={() => setNotebookFilter(notebook.id)}>
              {notebook.name}
            </Chip>
          ))}
          <button
            type="button"
            onClick={() => setIsNotebookSheetOpen(true)}
            aria-label="Manage notebooks"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-stone-300 text-stone-600"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>

        {checkedIds.size > 0 ? (
          <BatchActionBar
            count={checkedIds.size}
            allChecked={allChecked}
            isProcessing={isProcessingBatch}
            onToggleAll={() => setCheckedIds(allChecked ? new Set() : new Set(filteredTasks.map((task) => task.id)))}
            onClear={() => setCheckedIds(new Set())}
            onMoveToNotebook={(notebookId) => void handleBatchNotebook(notebookId)}
            onSetTags={(value) => void handleBatchTags(value)}
            onMoveToWorkspace={(workspaceId) => void handleBatchWorkspace(workspaceId)}
            onDelete={() => void handleBatchDelete()}
          />
        ) : (
          <div className="-mx-4 flex shrink-0 gap-1.5 overflow-x-auto px-4 lg:mx-0 lg:flex-wrap lg:px-0">
            <Chip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>All</Chip>
            {activeCount > 0 || statusFilter === 'active' ? (
              <Chip active={statusFilter === 'active'} onClick={() => setStatusFilter('active')}>
                Processing {activeCount}
              </Chip>
            ) : null}
            {failedCount > 0 || statusFilter === 'failed' ? (
              <Chip active={statusFilter === 'failed'} onClick={() => setStatusFilter('failed')}>
                Failed {failedCount}
              </Chip>
            ) : null}
            {tagMenu}
          </div>
        )}

        {searchError ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Search failed. Try again in a moment.
          </p>
        ) : null}

        <RecordingList
          tasks={filteredTasks}
          grouped={!hasActiveSearch}
          selectedTaskId={id || null}
          checkedIds={checkedIds}
          showNotebook={!notebookFilter}
          linkSearch={search}
          onToggleChecked={toggleChecked}
          emptyMessage={
            hasActiveSearch || statusFilter !== 'all' || tagFilter
              ? 'No matching recordings.'
              : notebookFilter
                ? 'Nothing here yet.'
                : 'No recordings yet — press New recording to add one.'
          }
        />
      </section>

      {/* Detail column */}
      <section
        aria-label="Recording detail"
        className={cn('min-w-0 flex-1 bg-white', id ? 'flex h-full flex-col' : 'hidden lg:flex lg:flex-col')}
      >
        {activeTask ? (
          <TaskDetail
            task={activeTask}
            onBack={() => navigate({ pathname: '/notebook', search })}
            onUpdateTask={async () => {
              await refreshTasksAndSelection(activeTask.id);
              await fetchTags();
            }}
            onDeleteTask={async () => {
              await selectTask(null);
              // Replace so Back does not return to the deleted recording.
              navigate({ pathname: '/notebook', search }, { replace: true });
              await refreshList();
            }}
          />
        ) : id && (selectedTaskLoading || selectedTaskId !== id) ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-stone-400" />
          </div>
        ) : id ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="font-medium text-stone-800">This recording is unavailable.</p>
            <button
              type="button"
              onClick={() => navigate({ pathname: '/notebook', search }, { replace: true })}
              className="h-9 rounded-lg border border-stone-200 px-4 text-sm font-medium text-stone-800 hover:bg-stone-50"
            >
              Back to recordings
            </button>
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <AudioLines className="h-10 w-10 text-stone-300" />
            <p className="font-medium text-stone-800">Select a recording</p>
            <p className="max-w-xs text-sm text-stone-600">Its summary, transcript and chat open here.</p>
            <button
              type="button"
              onClick={() => openNewRecording('record', {
                notebookId: notebookFilter && notebookFilter !== INBOX_FILTER ? notebookFilter : null,
              })}
              className="mt-2 inline-flex h-9 items-center gap-2 rounded-lg bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-800"
            >
              <Plus className="h-4 w-4" />
              New recording
            </button>
          </div>
        )}
      </section>

      {isNotebookSheetOpen ? (
        <Dialog title="Notebooks" onClose={() => setIsNotebookSheetOpen(false)}>
          <NotebookNav onNavigate={() => setIsNotebookSheetOpen(false)} />
        </Dialog>
      ) : null}
    </div>
  );
}
