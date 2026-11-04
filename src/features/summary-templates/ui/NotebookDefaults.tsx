import { useState } from 'react';
import { apiJson } from '@/shared/api/base';
import { useAppDataContext } from '@/app/providers/app-data-context';
import { getNotebookColor, type Notebook } from '@/entities/notebook';
import {
  getWorkspaceDefaultPrompt,
  isPromptAvailableInNotebook,
} from '@/entities/summary-prompt';

const selectClassName =
  'h-9 w-full min-w-0 rounded-lg border border-stone-200 bg-white px-2.5 text-sm text-stone-900 focus:border-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10 disabled:opacity-60 sm:w-80';

/** Lets each notebook pick its own default summary template. */
export function NotebookDefaults() {
  const { notebooks, summaryPrompts, fetchNotebooks } = useAppDataContext();
  const [savingId, setSavingId] = useState<string | null>(null);

  if (!notebooks.length) return null;

  const handleChange = async (notebook: Notebook, promptId: string) => {
    setSavingId(notebook.id);
    try {
      await apiJson(`/api/notebooks/${notebook.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultSummaryPromptId: promptId || null }),
      });
      await fetchNotebooks();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to update the notebook default.');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-medium text-stone-900">Notebook defaults</h3>
        <p className="mt-0.5 text-[13px] text-stone-600">
          Give a notebook its own default template. Notebooks left on “Workspace default” use the template marked as default above.
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-stone-200 rounded-xl border border-stone-200">
        {notebooks.map((notebook, index) => {
          const available = summaryPrompts.filter((prompt) => isPromptAvailableInNotebook(prompt, notebook.id));
          const workspaceDefault = getWorkspaceDefaultPrompt(summaryPrompts, notebook.id);
          const value = available.some((prompt) => prompt.id === notebook.defaultSummaryPromptId)
            ? notebook.defaultSummaryPromptId || ''
            : '';
          const selectId = `notebook-default-${notebook.id}`;
          return (
            <li key={notebook.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
              <label htmlFor={selectId} className="flex min-w-0 flex-1 items-center gap-2.5 text-sm text-stone-800">
                <span
                  className="h-2 w-2 shrink-0 rounded-[3px]"
                  style={{ backgroundColor: getNotebookColor(notebook, index) }}
                />
                <span className="truncate">{notebook.name}</span>
              </label>
              <select
                id={selectId}
                value={value}
                disabled={savingId === notebook.id}
                onChange={(event) => void handleChange(notebook, event.target.value)}
                className={selectClassName}
              >
                <option value="">
                  {workspaceDefault ? `Workspace default · ${workspaceDefault.name}` : 'Workspace default · none'}
                </option>
                {available.map((prompt) => (
                  <option key={prompt.id} value={prompt.id}>{prompt.name}</option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
