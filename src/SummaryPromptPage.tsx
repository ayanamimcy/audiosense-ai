import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Sparkles, Trash2 } from 'lucide-react';
import { apiFetch, apiJson } from './api';
import type { Notebook, SummaryPrompt } from './types';

type PromptDraft = {
  name: string;
  prompt: string;
  notebookIds: string[];
  isDefault: boolean;
};

function createEmptyDraft(): PromptDraft {
  return {
    name: '',
    prompt: '',
    notebookIds: [],
    isDefault: false,
  };
}

function buildDraft(prompt: SummaryPrompt | null): PromptDraft {
  if (!prompt) {
    return createEmptyDraft();
  }

  return {
    name: prompt.name,
    prompt: prompt.prompt,
    notebookIds: prompt.notebookIds,
    isDefault: prompt.isDefault,
  };
}

export function SummaryPromptPage({
  prompts,
  notebooks,
  onRefresh,
}: {
  prompts: SummaryPrompt[];
  notebooks: Notebook[];
  onRefresh: () => void | Promise<void>;
}) {
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(prompts[0]?.id || null);
  const [draft, setDraft] = useState<PromptDraft>(createEmptyDraft());
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const selectedPrompt = useMemo(
    () => prompts.find((prompt) => prompt.id === selectedPromptId) || null,
    [prompts, selectedPromptId],
  );

  useEffect(() => {
    if (!prompts.length) {
      setSelectedPromptId(null);
      return;
    }

    setSelectedPromptId((current) => {
      if (current && prompts.some((prompt) => prompt.id === current)) {
        return current;
      }

      return prompts[0].id;
    });
  }, [prompts]);

  useEffect(() => {
    setDraft(buildDraft(selectedPrompt));
  }, [selectedPrompt]);

  const handleCreate = () => {
    setSelectedPromptId(null);
    setDraft(createEmptyDraft());
  };

  const handleSave = async () => {
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
    } catch (error) {
      console.error('Failed to save summary prompt:', error);
      alert(error instanceof Error ? error.message : 'Failed to save Summary Prompt.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedPromptId) {
      return;
    }
    if (!confirm('Delete this Summary Prompt?')) {
      return;
    }

    setIsDeleting(true);
    try {
      await apiFetch(`/api/summary-prompts/${selectedPromptId}`, { method: 'DELETE' });
      setSelectedPromptId(null);
      setDraft(createEmptyDraft());
      await onRefresh();
    } catch (error) {
      console.error('Failed to delete summary prompt:', error);
      alert(error instanceof Error ? error.message : 'Failed to delete Summary Prompt.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:h-full pb-28 lg:pb-0">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-col min-h-[520px]">
        <div className="flex items-center justify-between gap-3 px-2 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Summary Prompts</h2>
            <p className="text-sm text-slate-500 mt-1">Manage reusable prompt templates for summaries.</p>
          </div>
          <button
            onClick={handleCreate}
            className="p-2 rounded-xl bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors"
            title="Create prompt"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
          {prompts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-500 text-center">
              No Summary Prompts yet. Create one to reuse it across tasks.
            </div>
          ) : (
            prompts.map((prompt) => (
              <button
                key={prompt.id}
                onClick={() => setSelectedPromptId(prompt.id)}
                className={`w-full text-left rounded-2xl border p-4 transition-colors ${
                  selectedPromptId === prompt.id
                    ? 'border-indigo-300 bg-indigo-50'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{prompt.name}</p>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">{prompt.prompt}</p>
                  </div>
                  {prompt.isDefault && (
                    <span className="text-[11px] font-medium text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded-full shrink-0">
                      Default
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-3">
                  {prompt.notebookIds.length
                    ? `${prompt.notebookIds.length} notebook${prompt.notebookIds.length > 1 ? 's' : ''}`
                    : 'All notebooks'}
                </p>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 pb-28 lg:pb-6 min-h-[520px]">
        <div className="flex items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              {selectedPrompt ? 'Edit Summary Prompt' : 'New Summary Prompt'}
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Choose which notebooks can use this prompt, and optionally mark it as the default.
            </p>
          </div>
          {selectedPrompt && (
            <button
              onClick={() => void handleDelete()}
              disabled={isDeleting}
              className="px-3 py-2 rounded-xl text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-50 flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          )}
        </div>

        <div className="space-y-5">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Prompt Name</span>
            <input
              type="text"
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              placeholder="Meeting Summary"
              className="w-full mt-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Prompt Content</span>
            <textarea
              value={draft.prompt}
              onChange={(event) => setDraft((current) => ({ ...current, prompt: event.target.value }))}
              placeholder="Summarize this meeting with decisions, risks, and action items."
              className="w-full mt-1 min-h-52 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>

          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-500" />
              <span className="text-sm font-medium text-slate-700">Available Notebooks</span>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Leave all notebooks unchecked to make this prompt available everywhere.
            </p>
            <div className="grid md:grid-cols-2 gap-3 mt-3">
              {notebooks.map((notebook) => {
                const checked = draft.notebookIds.includes(notebook.id);
                return (
                  <label
                    key={notebook.id}
                    className={`flex items-start gap-3 p-3 rounded-xl border ${
                      checked ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200 bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          notebookIds: event.target.checked
                            ? [...current.notebookIds, notebook.id]
                            : current.notebookIds.filter((id) => id !== notebook.id),
                        }))
                      }
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <p className="text-sm font-medium text-slate-800">{notebook.name}</p>
                      {notebook.description ? (
                        <p className="text-xs text-slate-500 mt-1">{notebook.description}</p>
                      ) : null}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          <label className="flex items-start gap-3 p-4 rounded-2xl border border-slate-200 bg-slate-50">
            <input
              type="checkbox"
              checked={draft.isDefault}
              onChange={(event) => setDraft((current) => ({ ...current, isDefault: event.target.checked }))}
              className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <div>
              <p className="text-sm font-medium text-slate-800">Use as default Summary Prompt</p>
              <p className="text-sm text-slate-500 mt-1">
                Default is optional. When a task does not pick a specific prompt, the app will try to use the default prompt that is available for that task&apos;s notebook.
              </p>
            </div>
          </label>

          <div className="flex justify-end">
            <button
              onClick={() => void handleSave()}
              disabled={isSaving}
              className="px-5 py-2.5 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-60"
            >
              {isSaving ? 'Saving...' : selectedPrompt ? 'Save Changes' : 'Create Prompt'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
