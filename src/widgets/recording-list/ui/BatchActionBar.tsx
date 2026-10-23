import { useState } from 'react';
import { ArrowRightLeft, FolderInput, Loader2, MoreHorizontal, Tag, Trash2, X } from 'lucide-react';
import { DropdownMenu } from '@/shared/ui/DropdownMenu';
import { Dialog } from '@/shared/ui/Dialog';
import { useAppDataContext } from '@/app/providers/app-data-context';

const barButtonClassName =
  'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-white hover:bg-white/10';

export function BatchActionBar({
  count,
  allChecked,
  isProcessing,
  onToggleAll,
  onClear,
  onMoveToNotebook,
  onSetTags,
  onMoveToWorkspace,
  onDelete,
}: {
  count: number;
  allChecked: boolean;
  isProcessing: boolean;
  onToggleAll: () => void;
  onClear: () => void;
  onMoveToNotebook: (notebookId: string | null) => void;
  onSetTags: (tags: string) => void;
  onMoveToWorkspace: (workspaceId: string) => void;
  onDelete: () => void;
}) {
  const { notebooks, workspaces, currentWorkspaceId } = useAppDataContext();
  const [isTagDialogOpen, setIsTagDialogOpen] = useState(false);
  const [tagValue, setTagValue] = useState('');
  const otherWorkspaces = workspaces.filter((workspace) => workspace.id !== currentWorkspaceId);

  if (isProcessing) {
    return (
      <div className="flex h-10 items-center justify-center gap-2 rounded-xl bg-stone-900 text-sm font-medium text-white">
        <Loader2 className="h-4 w-4 animate-spin" />
        Updating {count} recordings…
      </div>
    );
  }

  return (
    <>
      <div className="flex min-h-10 flex-wrap items-center gap-0.5 rounded-xl bg-stone-900 py-1 pr-1 pl-3 text-white">
        <button type="button" onClick={onToggleAll} className="mr-auto text-sm font-medium hover:underline">
          {count} selected · {allChecked ? 'Deselect all' : 'Select all'}
        </button>
        <DropdownMenu
          placement="bottom"
          items={[
            { key: 'inbox', label: 'Inbox (no notebook)', onSelect: () => onMoveToNotebook(null) },
            ...notebooks.map((notebook) => ({
              key: notebook.id,
              label: notebook.name,
              onSelect: () => onMoveToNotebook(notebook.id),
            })),
          ]}
          trigger={({ onClick }) => (
            <button type="button" onClick={onClick} className={barButtonClassName}>
              <FolderInput className="h-4 w-4" />
              Move
            </button>
          )}
        />
        <button type="button" onClick={() => setIsTagDialogOpen(true)} className={barButtonClassName}>
          <Tag className="h-4 w-4" />
          Tag
        </button>
        <button type="button" onClick={onDelete} className={`${barButtonClassName} text-red-300`}>
          <Trash2 className="h-4 w-4" />
          <span className="sr-only sm:not-sr-only">Delete</span>
        </button>
        {otherWorkspaces.length > 0 ? (
          <DropdownMenu
            items={otherWorkspaces.map((workspace) => ({
              key: workspace.id,
              label: `Move to ${workspace.name}`,
              icon: <ArrowRightLeft className="h-4 w-4" />,
              onSelect: () => onMoveToWorkspace(workspace.id),
            }))}
            trigger={({ onClick }) => (
              <button type="button" onClick={onClick} aria-label="More batch actions" className={barButtonClassName}>
                <MoreHorizontal className="h-4 w-4" />
              </button>
            )}
          />
        ) : null}
        <button type="button" onClick={onClear} aria-label="Clear selection" className={barButtonClassName}>
          <X className="h-4 w-4" />
        </button>
      </div>

      {isTagDialogOpen ? (
        <Dialog
          title={`Set tags for ${count} recordings`}
          onClose={() => setIsTagDialogOpen(false)}
          className="sm:max-w-md"
          footer={(
            <>
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => setIsTagDialogOpen(false)}
                className="h-9 rounded-lg px-3.5 text-sm font-medium text-stone-800 hover:bg-stone-200/60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsTagDialogOpen(false);
                  onSetTags(tagValue);
                  setTagValue('');
                }}
                className="h-9 rounded-lg bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-800"
              >
                Apply
              </button>
            </>
          )}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-stone-600">Comma separated. Replaces the current tags on each recording.</span>
            <input
              autoFocus
              value={tagValue}
              onChange={(event) => setTagValue(event.target.value)}
              placeholder="meeting, important"
              className="h-10 rounded-lg border border-stone-200 px-3 text-sm text-stone-900 focus:border-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
            />
          </label>
        </Dialog>
      ) : null}
    </>
  );
}
