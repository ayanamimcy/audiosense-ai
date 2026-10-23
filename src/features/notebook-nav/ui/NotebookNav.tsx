import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRightLeft, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { apiJson } from '@/shared/api/base';
import { cn } from '@/shared/lib/cn';
import { DropdownMenu, type DropdownMenuItem } from '@/shared/ui/DropdownMenu';
import { useAppDataContext } from '@/app/providers/app-data-context';
import {
  INBOX_COLOR,
  INBOX_FILTER,
  getNotebookColor,
  useNotebookFilter,
  type Notebook,
} from '@/entities/notebook';

function NavRow({
  label,
  count,
  color,
  active,
  onSelect,
  menu,
}: {
  label: string;
  count: number;
  color: string;
  active: boolean;
  onSelect: () => void;
  menu?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'group flex items-center rounded-lg transition-colors',
        active ? 'bg-white shadow-[0_0_0_1px_var(--color-stone-200)]' : 'hover:bg-stone-200/50',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        className={cn(
          'flex min-h-9 min-w-0 flex-1 items-center gap-2.5 py-1.5 pl-2.5 text-left text-sm',
          active ? 'font-medium text-stone-900' : 'text-stone-700',
          menu ? 'pr-1' : 'pr-2.5',
        )}
      >
        <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ backgroundColor: color }} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className={cn('text-xs text-stone-500 tabular-nums', menu && 'group-hover:hidden group-focus-within:hidden')}>
          {count}
        </span>
      </button>
      {menu}
    </div>
  );
}

export function NotebookNav({ onNavigate }: { onNavigate?: () => void }) {
  const {
    notebooks, tasks, workspaces, currentWorkspaceId, fetchNotebooks, fetchTasks, fetchTags,
  } = useAppDataContext();
  const [filter, setFilter] = useNotebookFilter();
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const counts = useMemo(() => {
    const byNotebook = new Map<string, number>();
    let inbox = 0;
    for (const task of tasks) {
      if (task.notebookId) {
        byNotebook.set(task.notebookId, (byNotebook.get(task.notebookId) || 0) + 1);
      } else {
        inbox += 1;
      }
    }
    return { byNotebook, inbox };
  }, [tasks]);

  const otherWorkspaces = workspaces.filter((workspace) => workspace.id !== currentWorkspaceId);

  useEffect(() => {
    if (renamingId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingId]);

  const select = (next: string | null) => {
    setFilter(next);
    onNavigate?.();
  };

  const refresh = async () => {
    await fetchNotebooks();
    await fetchTasks();
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      setIsCreating(false);
      return;
    }
    try {
      await apiJson('/api/notebooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      setNewName('');
      setIsCreating(false);
      await fetchNotebooks();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to create notebook.');
    }
  };

  const handleRename = async (notebook: Notebook) => {
    const name = renameValue.trim();
    setRenamingId(null);
    if (!name || name === notebook.name) return;
    try {
      await apiJson(`/api/notebooks/${notebook.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      await fetchNotebooks();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to rename notebook.');
    }
  };

  const handleDelete = async (notebook: Notebook) => {
    if (!confirm(`Delete "${notebook.name}"? Its recordings move back to the Inbox.`)) return;
    try {
      await apiJson(`/api/notebooks/${notebook.id}`, { method: 'DELETE' });
      if (filter === notebook.id) setFilter(null);
      await refresh();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to delete notebook.');
    }
  };

  const handleMoveToWorkspace = async (notebook: Notebook, workspaceId: string, workspaceName: string) => {
    if (!confirm(`Move "${notebook.name}" and all of its recordings to "${workspaceName}"?`)) return;
    try {
      await apiJson(`/api/notebooks/${notebook.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      });
      if (filter === notebook.id) setFilter(null);
      await refresh();
      await fetchTags();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to move notebook.');
    }
  };

  const buildMenuItems = (notebook: Notebook): DropdownMenuItem[] => [
    {
      key: 'rename',
      label: 'Rename',
      icon: <Pencil className="h-4 w-4" />,
      onSelect: () => {
        setRenamingId(notebook.id);
        setRenameValue(notebook.name);
      },
    },
    ...otherWorkspaces.map((workspace, index) => ({
      key: `move-${workspace.id}`,
      label: `Move to ${workspace.name}`,
      icon: <ArrowRightLeft className="h-4 w-4" />,
      separated: index === 0,
      onSelect: () => void handleMoveToWorkspace(notebook, workspace.id, workspace.name),
    })),
    {
      key: 'delete',
      label: 'Delete',
      icon: <Trash2 className="h-4 w-4" />,
      danger: true,
      separated: true,
      onSelect: () => void handleDelete(notebook),
    },
  ];

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between px-2.5 pb-1">
        <span className="text-xs font-semibold text-stone-500">Notebooks</span>
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          aria-label="New notebook"
          className="flex h-7 w-7 items-center justify-center rounded-md text-stone-500 hover:bg-stone-200/60 hover:text-stone-800"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <NavRow
        label="All recordings"
        count={tasks.length}
        color="#a8a29e"
        active={!filter}
        onSelect={() => select(null)}
      />
      <NavRow
        label="Inbox"
        count={counts.inbox}
        color={INBOX_COLOR}
        active={filter === INBOX_FILTER}
        onSelect={() => select(INBOX_FILTER)}
      />

      {notebooks.map((notebook, index) => (
        renamingId === notebook.id ? (
          <input
            key={notebook.id}
            ref={renameInputRef}
            value={renameValue}
            aria-label="Notebook name"
            onChange={(event) => setRenameValue(event.target.value)}
            onBlur={() => void handleRename(notebook)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleRename(notebook);
              if (event.key === 'Escape') setRenamingId(null);
            }}
            className="h-9 rounded-lg border border-stone-300 bg-white px-2.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
          />
        ) : (
          <NavRow
            key={notebook.id}
            label={notebook.name}
            count={counts.byNotebook.get(notebook.id) || 0}
            color={getNotebookColor(notebook, index)}
            active={filter === notebook.id}
            onSelect={() => select(notebook.id)}
            menu={(
              <DropdownMenu
                items={buildMenuItems(notebook)}
                trigger={({ onClick, open }) => (
                  <button
                    type="button"
                    onClick={onClick}
                    aria-label={`${notebook.name} options`}
                    aria-expanded={open}
                    className={cn(
                      'mr-1 flex h-7 w-7 items-center justify-center rounded-md text-stone-500 hover:bg-stone-200 hover:text-stone-800',
                      open ? 'flex' : 'hidden group-hover:flex group-focus-within:flex [@media(hover:none)]:flex',
                    )}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                )}
              />
            )}
          />
        )
      ))}

      {isCreating ? (
        <input
          autoFocus
          value={newName}
          aria-label="New notebook name"
          placeholder="Notebook name"
          onChange={(event) => setNewName(event.target.value)}
          onBlur={() => void handleCreate()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void handleCreate();
            if (event.key === 'Escape') {
              setNewName('');
              setIsCreating(false);
            }
          }}
          className="h-9 rounded-lg border border-stone-300 bg-white px-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
        />
      ) : null}
    </div>
  );
}
