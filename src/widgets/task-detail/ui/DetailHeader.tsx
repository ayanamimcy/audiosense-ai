import { format } from 'date-fns';
import { ArrowLeft, Check, Copy, Download, MoreHorizontal, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { DropdownMenu, type DropdownMenuItem } from '@/shared/ui/DropdownMenu';
import { useAppDataContext } from '@/app/providers/app-data-context';
import { INBOX_COLOR, getNotebookColor } from '@/entities/notebook';
import {
  TASK_STATUS_TONE_CLASS,
  formatTaskDuration,
  getTaskMediaUrl,
  getTaskStatusBadge,
  type Task,
} from '@/entities/task';
import { TaskTagSuggestionPanel } from './TaskTagSuggestionPanel';

function downloadMedia(task: Task) {
  const anchor = document.createElement('a');
  anchor.href = getTaskMediaUrl(task);
  anchor.download = task.originalName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function DetailHeader({
  task,
  isDesktop,
  hasTranscript,
  transcriptCopied,
  onBack,
  onCopyTranscript,
  onEdit,
  onReprocess,
  onDelete,
  onUpdateTask,
}: {
  task: Task;
  isDesktop: boolean;
  hasTranscript: boolean;
  transcriptCopied: boolean;
  onBack: () => void;
  onCopyTranscript: () => void;
  onEdit: () => void;
  onReprocess: () => void;
  onDelete: () => void;
  onUpdateTask: () => void | Promise<void>;
}) {
  const { notebooks } = useAppDataContext();
  const notebookIndex = notebooks.findIndex((item) => item.id === task.notebookId);
  const notebook = notebookIndex >= 0 ? notebooks[notebookIndex] : null;
  const statusBadge = getTaskStatusBadge(task.status);
  const duration = formatTaskDuration(task.durationSeconds);
  const canReprocess = task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled';

  const menuItems: DropdownMenuItem[] = [
    { key: 'edit', label: 'Edit details', icon: <Pencil className="h-4 w-4" />, onSelect: onEdit },
    ...(!isDesktop && hasTranscript
      ? [{ key: 'copy', label: 'Copy transcript', icon: <Copy className="h-4 w-4" />, onSelect: onCopyTranscript }]
      : []),
    ...(canReprocess
      ? [{ key: 'reprocess', label: 'Reprocess…', icon: <RefreshCw className="h-4 w-4" />, onSelect: onReprocess }]
      : []),
    { key: 'download', label: 'Download audio', icon: <Download className="h-4 w-4" />, onSelect: () => downloadMedia(task) },
    { key: 'delete', label: 'Delete', icon: <Trash2 className="h-4 w-4" />, danger: true, separated: true, onSelect: onDelete },
  ];

  const moreMenu = (
    <DropdownMenu
      items={menuItems}
      trigger={({ onClick, open }) => (
        <button
          type="button"
          onClick={onClick}
          aria-label="More actions"
          aria-expanded={open}
          className={cn(
            'flex items-center justify-center text-stone-800',
            isDesktop
              ? 'h-9 w-9 rounded-lg border border-stone-200 bg-white hover:bg-stone-50'
              : 'h-11 w-11 rounded-full hover:bg-stone-100',
          )}
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      )}
    />
  );

  return (
    <header className={cn('shrink-0', isDesktop ? 'px-8 pt-6' : 'px-5')}>
      {!isDesktop ? (
        <div
          className="-mx-3 flex items-center justify-between"
          style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.25rem)' }}
        >
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to recordings"
            className="flex h-11 w-11 items-center justify-center rounded-full text-stone-900 hover:bg-stone-100"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          {moreMenu}
        </div>
      ) : null}

      <div className="flex items-start gap-3">
        <h1 className={cn('min-w-0 flex-1 font-semibold tracking-tight text-stone-900', isDesktop ? 'text-[22px]' : 'text-[22px] leading-snug')}>
          {task.originalName}
        </h1>
        {isDesktop ? (
          <div className="flex shrink-0 items-center gap-2">
            {hasTranscript ? (
              <button
                type="button"
                onClick={onCopyTranscript}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 text-sm font-medium text-stone-900 hover:bg-stone-50"
              >
                {transcriptCopied ? <Check className="h-4 w-4 text-emerald-700" /> : <Copy className="h-4 w-4" />}
                {transcriptCopied ? 'Copied' : 'Copy transcript'}
              </button>
            ) : null}
            {moreMenu}
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[13px] text-stone-600">
        {statusBadge ? (
          <span className={cn('rounded-md px-2 py-0.5 text-xs font-semibold', TASK_STATUS_TONE_CLASS[statusBadge.tone])}>
            {statusBadge.label}
          </span>
        ) : null}
        <span>{format(new Date(task.eventDate || task.createdAt), 'MMM d, yyyy')}</span>
        {duration ? <span>{duration}</span> : null}
        {task.speakerCount > 1 ? <span>{task.speakerCount} speakers</span> : null}
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-[3px]"
            style={{ backgroundColor: notebook ? getNotebookColor(notebook, notebookIndex) : INBOX_COLOR }}
          />
          {notebook?.name || 'Inbox'}
        </span>
        {task.tags.map((tag) => (
          <span key={tag} className="rounded-md bg-stone-100 px-2 py-0.5 text-xs text-stone-700">#{tag}</span>
        ))}
        <button type="button" onClick={onEdit} className="text-xs font-medium text-indigo-700 hover:text-indigo-900">
          {task.tags.length ? 'Edit tags' : '+ Tag'}
        </button>
        {task.status === 'completed' && isDesktop ? (
          <TaskTagSuggestionPanel task={task} onUpdateTask={onUpdateTask} mode="desktop-popover" />
        ) : null}
      </div>
      {task.status === 'completed' && !isDesktop ? (
        <div className="mt-2">
          <TaskTagSuggestionPanel task={task} onUpdateTask={onUpdateTask} mode="inline" compact />
        </div>
      ) : null}
    </header>
  );
}
