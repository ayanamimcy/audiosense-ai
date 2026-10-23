import { useState } from 'react';
import { format } from 'date-fns';
import { apiFetch } from '@/shared/api/base';
import { Dialog } from '@/shared/ui/Dialog';
import { Field, inputClassName, primaryButtonClassName } from '@/shared/ui/form';
import { useAppDataContext } from '@/app/providers/app-data-context';
import type { Task } from '@/entities/task';

export function TaskEditModal({
  task,
  onClose,
  onSaved,
}: {
  task: Task;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { notebooks } = useAppDataContext();
  const [name, setName] = useState(task.originalName);
  const [notebookId, setNotebookId] = useState<string>(task.notebookId || '');
  const [date, setDate] = useState(format(new Date(task.eventDate || task.createdAt), 'yyyy-MM-dd'));
  const [tags, setTags] = useState(task.tags.join(', '));
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;

    const [year, month, day] = date.split('-').map(Number);
    const eventDateTimestamp = year && month && day
      ? new Date(year, month - 1, day).getTime()
      : task.eventDate || task.createdAt;

    setIsSaving(true);
    try {
      const res = await apiFetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalName: name.trim(),
          notebookId: notebookId || null,
          eventDate: eventDateTimestamp,
          tags,
        }),
      });

      if (!res.ok) throw new Error('Failed to update recording.');
      onClose();
      await onSaved();
    } catch (error) {
      console.error('Failed to update task:', error);
      alert(error instanceof Error ? error.message : 'Failed to update recording.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      title="Edit details"
      onClose={onClose}
      className="sm:max-w-md"
      footer={(
        <>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg px-3.5 text-sm font-medium text-stone-800 hover:bg-stone-200/60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving || !name.trim()}
            className={primaryButtonClassName}
          >
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </>
      )}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSave();
        }}
      >
        <Field label="Name">
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={inputClassName}
            autoFocus
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Notebook">
            <select value={notebookId} onChange={(event) => setNotebookId(event.target.value)} className={inputClassName}>
              <option value="">Inbox</option>
              {notebooks.map((notebook) => (
                <option key={notebook.id} value={notebook.id}>{notebook.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={inputClassName} />
          </Field>
        </div>
        <Field label="Tags" hint="Comma separated.">
          <input
            type="text"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="meeting, research"
            className={inputClassName}
          />
        </Field>
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Dialog>
  );
}
