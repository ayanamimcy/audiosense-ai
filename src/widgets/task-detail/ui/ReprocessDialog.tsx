import { useState } from 'react';
import { Dialog } from '@/shared/ui/Dialog';
import { LANGUAGE_OPTIONS } from '@/shared/lib/constants';
import { useAppDataContext } from '@/app/providers/app-data-context';
import type { Task } from '@/entities/task';

const selectClassName =
  'h-10 w-full rounded-lg border border-stone-200 bg-white px-3 text-sm text-stone-900 focus:border-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10';

export function ReprocessDialog({
  task,
  onClose,
  onSubmit,
}: {
  task: Task;
  onClose: () => void;
  onSubmit: (options: { language: string; provider: string }) => void | Promise<void>;
}) {
  const { capabilities } = useAppDataContext();
  const [language, setLanguage] = useState(task.language || 'auto');
  const [provider, setProvider] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const providers = capabilities?.transcription.providers || [];

  return (
    <Dialog
      title="Reprocess recording"
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
            disabled={isSubmitting}
            onClick={async () => {
              setIsSubmitting(true);
              try {
                await onSubmit({ language, provider });
              } finally {
                setIsSubmitting(false);
              }
            }}
            className="h-9 rounded-lg bg-stone-900 px-4 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-60"
          >
            Reprocess
          </button>
        </>
      )}
    >
      <p className="text-sm text-stone-600">
        Runs transcription again. The current transcript and summary are replaced when it finishes.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-stone-700">Provider</span>
          <select value={provider} onChange={(event) => setProvider(event.target.value)} className={selectClassName}>
            <option value="">Default</option>
            {providers.map((item) => (
              <option key={item.id} value={item.id} disabled={!item.configured}>
                {item.label}{item.configured ? '' : ' (not set up)'}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-stone-700">Language</span>
          <select value={language} onChange={(event) => setLanguage(event.target.value)} className={selectClassName}>
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>
    </Dialog>
  );
}
