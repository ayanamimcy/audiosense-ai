import { useEffect, useMemo, useState } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { apiFetch, apiJson } from '@/shared/api/base';
import { cn } from '@/shared/lib/cn';
import { Field, inputClassName, primaryButtonClassName, secondaryButtonClassName } from '@/shared/ui/form';
import { useAppDataContext } from '@/app/providers/app-data-context';
import type { SummaryPrompt } from '@/entities/summary-prompt';

type PromptDraft = {
  name: string;
  prompt: string;
  notebookIds: string[];
  isDefault: boolean;
};

function createEmptyDraft(): PromptDraft {
  return { name: '', prompt: '', notebookIds: [], isDefault: false };
}

function buildDraft(prompt: SummaryPrompt | null): PromptDraft {
  if (!prompt) return createEmptyDraft();
  return {
    name: prompt.name,
    prompt: prompt.prompt,
    notebookIds: prompt.notebookIds,
    isDefault: prompt.isDefault,
  };
}

/** Reusable summary prompt templates, managed from Settings › Summary templates. */
export function SummaryTemplates() {
  const { summaryPrompts: prompts, notebooks, fetchSummaryPrompts: onRefresh } = useAppDataContext();
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(prompts[0]?.id || null);
  const [draft, setDraft] = useState<PromptDraft>(createEmptyDraft());
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const selectedPrompt = useMemo(
    () => prompts.find((prompt) => prompt.id === selectedPromptId) || null,
    [prompts, selectedPromptId],
  );

  useEffect(() => {
    if (!prompts.length) {
      setSelectedPromptId(null);
      return;
    }
    setSelectedPromptId((current) => (
      current === null || prompts.some((prompt) => prompt.id === current) ? current : prompts[0].id
    ));
  }, [prompts]);

  useEffect(() => {
    setDraft(buildDraft(selectedPrompt));
  }, [selectedPrompt]);

  const handleSave = async () => {
    if (!draft.name.trim() || !draft.prompt.trim()) {
      alert('Give the template a name and some instructions.');
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        name: draft.name,
        prompt: draft.prompt,
        notebookIds: draft.notebookIds,
        isDefault: draft.isDefault,
      };

      if (selectedPromptId) {
        await apiJson(`/api/summary-prompts/${selectedPromptId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        const created = await apiJson<SummaryPrompt>('/api/summary-prompts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        setSelectedPromptId(created.id);
      }

      await onRefresh();
      setSaveSuccess(true);
      window.setTimeout(() => setSaveSuccess(false), 2500);
    } catch (error) {
      console.error('Failed to save summary prompt:', error);
      alert(error instanceof Error ? error.message : 'Failed to save the template.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedPromptId || !confirm(`Delete the template "${selectedPrompt?.name}"?`)) return;

    setIsDeleting(true);
    try {
      await apiFetch(`/api/summary-prompts/${selectedPromptId}`, { method: 'DELETE' });
      setSelectedPromptId(prompts.find((prompt) => prompt.id !== selectedPromptId)?.id || null);
      await onRefresh();
    } catch (error) {
      console.error('Failed to delete summary prompt:', error);
      alert(error instanceof Error ? error.message : 'Failed to delete the template.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        {prompts.map((prompt) => (
          <button
            key={prompt.id}
            type="button"
            onClick={() => setSelectedPromptId(prompt.id)}
            aria-pressed={selectedPromptId === prompt.id}
            className={cn(
              'inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors',
              selectedPromptId === prompt.id
                ? 'border-stone-900 bg-stone-900 text-white'
                : 'border-stone-200 bg-white text-stone-800 hover:bg-stone-50',
            )}
          >
            {prompt.name}
            {prompt.isDefault ? (
              <span className={cn('text-xs font-normal', selectedPromptId === prompt.id ? 'text-stone-300' : 'text-stone-500')}>
                Default
              </span>
            ) : null}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setSelectedPromptId(null)}
          aria-pressed={selectedPromptId === null}
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-lg border border-dashed px-3 text-sm font-medium',
            selectedPromptId === null ? 'border-stone-900 text-stone-900' : 'border-stone-300 text-stone-700 hover:bg-stone-50',
          )}
        >
          <Plus className="h-4 w-4" />
          New template
        </button>
      </div>

      <div className="flex flex-col gap-5 rounded-xl border border-stone-200 p-5">
        <Field label="Name">
          <input
            type="text"
            value={draft.name}
            onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            placeholder="Meeting notes"
            className={inputClassName}
          />
        </Field>

        <Field label="Instructions">
          <textarea
            value={draft.prompt}
            onChange={(event) => setDraft((current) => ({ ...current, prompt: event.target.value }))}
            placeholder="Summarize this meeting with decisions, risks and action items."
            className={cn(inputClassName, 'h-auto min-h-44 py-2.5 leading-relaxed')}
          />
        </Field>

        <fieldset>
          <legend className="text-sm font-medium text-stone-800">Available in</legend>
          <p className="mt-0.5 text-xs text-stone-500">Leave everything unchecked to use it in every notebook.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {notebooks.map((notebook) => {
              const checked = draft.notebookIds.includes(notebook.id);
              return (
                <label
                  key={notebook.id}
                  className={cn(
                    'inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm',
                    checked ? 'border-stone-900 text-stone-900' : 'border-stone-200 text-stone-700',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => setDraft((current) => ({
                      ...current,
                      notebookIds: event.target.checked
                        ? [...current.notebookIds, notebook.id]
                        : current.notebookIds.filter((notebookId) => notebookId !== notebook.id),
                    }))}
                    className="h-4 w-4 accent-stone-900"
                  />
                  {notebook.name}
                </label>
              );
            })}
            {notebooks.length === 0 ? <span className="text-sm text-stone-500">No notebooks yet.</span> : null}
          </div>
        </fieldset>

        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={draft.isDefault}
            onChange={(event) => setDraft((current) => ({ ...current, isDefault: event.target.checked }))}
            className="mt-0.5 h-4 w-4 accent-stone-900"
          />
          <span>
            <span className="block text-sm font-medium text-stone-900">Use as default</span>
            <span className="block text-[13px] text-stone-600">Used whenever a summary is generated without picking a template.</span>
          </span>
        </label>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-stone-200 pt-4">
          {saveSuccess ? (
            <span className="mr-auto inline-flex items-center gap-1.5 text-sm font-medium text-emerald-800">
              <Check className="h-4 w-4" />
              Saved
            </span>
          ) : null}
          {selectedPrompt ? (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={isDeleting}
              className={cn(secondaryButtonClassName, 'text-red-700')}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          ) : null}
          <button type="button" onClick={() => void handleSave()} disabled={isSaving} className={primaryButtonClassName}>
            {isSaving ? 'Saving…' : selectedPrompt ? 'Save changes' : 'Create template'}
          </button>
        </div>
      </div>
    </div>
  );
}
