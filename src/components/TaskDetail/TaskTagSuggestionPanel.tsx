import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, Sparkles, Wand2, X } from 'lucide-react';
import { apiFetch } from '../../api';
import { cn } from '../../lib/utils';
import {
  canTaskGenerateTagSuggestions,
  getTaskTagSuggestionError,
  getTaskTagSuggestions,
  isTaskTagSuggestionGenerating,
} from '../../lib/taskTagSuggestions';
import type { Task } from '../../types';

type TaskTagSuggestionPanelMode = 'desktop-popover' | 'inline';

function toTagKey(tag: string) {
  return tag.trim().toLowerCase();
}

function uniqueTags(tags: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const tag of tags) {
    const normalized = tag.replace(/^#+/, '').replace(/\s+/g, ' ').trim();
    if (!normalized) {
      continue;
    }

    const key = toTagKey(normalized);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function parseCustomTagInput(value: string) {
  return uniqueTags(value.split(','));
}

function SkeletonTag() {
  return <span className="h-8 animate-pulse rounded-full bg-slate-100" />;
}

export function TaskTagSuggestionPanel({
  task,
  onUpdateTask,
  mode = 'inline',
  compact = false,
}: {
  task: Task;
  onUpdateTask: () => void | Promise<void>;
  mode?: TaskTagSuggestionPanelMode;
  compact?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [customTagInput, setCustomTagInput] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState<'generate' | 'apply' | 'dismiss' | null>(null);

  const suggestionError = getTaskTagSuggestionError(task);
  const isGenerating = isTaskTagSuggestionGenerating(task);
  const existingTagKeys = useMemo(() => new Set(task.tags.map(toTagKey)), [task.tags]);
  const suggestedTags = useMemo(
    () => getTaskTagSuggestions(task).filter((tag) => !existingTagKeys.has(toTagKey(tag))),
    [existingTagKeys, task],
  );
  const suggestedTagKeys = useMemo(
    () => new Set(suggestedTags.map(toTagKey)),
    [suggestedTags],
  );
  const selectedTagKeys = useMemo(
    () => new Set(selectedTags.map(toTagKey)),
    [selectedTags],
  );
  const selectedCustomTags = useMemo(
    () => selectedTags.filter((tag) => !suggestedTagKeys.has(toTagKey(tag))),
    [selectedTags, suggestedTagKeys],
  );

  useEffect(() => {
    setSelectedTags([]);
    setCustomTagInput('');
    setIsOpen(false);
  }, [mode, task.id]);

  useEffect(() => {
    setSelectedTags((current) =>
      current.filter((tag) => !existingTagKeys.has(toTagKey(tag))),
    );
  }, [existingTagKeys]);

  useEffect(() => {
    if (mode !== 'desktop-popover' || !isOpen) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen, mode]);

  if (!canTaskGenerateTagSuggestions(task)) {
    return null;
  }

  const triggerBusy = isGenerating || isSubmitting === 'generate';
  const selectedCount = selectedTags.length;

  const triggerLabel = triggerBusy
    ? 'Suggesting tags'
    : suggestionError
      ? 'Retry AI tags'
      : suggestedTags.length > 0
        ? `AI suggestions (${suggestedTags.length})`
        : 'Suggest tags';

  const openPanel = () => {
    setIsOpen((current) => (mode === 'desktop-popover' ? !current : !current));
  };

  const handleGenerate = async () => {
    setIsOpen(true);
    setIsSubmitting('generate');

    try {
      const res = await apiFetch(`/api/tasks/${task.id}/tag-suggestions/generate`, {
        method: 'POST',
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || 'Failed to generate tag suggestions.');
      }
      await onUpdateTask();
    } catch (error) {
      console.error('Failed to generate tag suggestions:', error);
      alert(error instanceof Error ? error.message : 'Failed to generate tag suggestions.');
    } finally {
      setIsSubmitting(null);
    }
  };

  const handleApply = async () => {
    if (selectedTags.length === 0) {
      return;
    }

    setIsSubmitting('apply');
    try {
      const res = await apiFetch(`/api/tasks/${task.id}/tag-suggestions/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: selectedTags }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || 'Failed to apply tag suggestions.');
      }
      setSelectedTags([]);
      setCustomTagInput('');
      setIsOpen(false);
      await onUpdateTask();
    } catch (error) {
      console.error('Failed to apply tag suggestions:', error);
      alert(error instanceof Error ? error.message : 'Failed to apply tag suggestions.');
    } finally {
      setIsSubmitting(null);
    }
  };

  const handleDismiss = async () => {
    setIsSubmitting('dismiss');
    try {
      const res = await apiFetch(`/api/tasks/${task.id}/tag-suggestions/dismiss`, {
        method: 'POST',
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || 'Failed to dismiss tag suggestions.');
      }
      setSelectedTags([]);
      setCustomTagInput('');
      setIsOpen(false);
      await onUpdateTask();
    } catch (error) {
      console.error('Failed to dismiss tag suggestions:', error);
      alert(error instanceof Error ? error.message : 'Failed to dismiss tag suggestions.');
    } finally {
      setIsSubmitting(null);
    }
  };

  const toggleSuggestedTag = (tag: string) => {
    const key = toTagKey(tag);
    setSelectedTags((current) =>
      current.some((item) => toTagKey(item) === key)
        ? current.filter((item) => toTagKey(item) !== key)
        : uniqueTags([...current, tag]),
    );
  };

  const handleSelectAll = () => {
    setSelectedTags((current) => uniqueTags([...current, ...suggestedTags]));
  };

  const handleCustomTagAdd = () => {
    const nextTags = parseCustomTagInput(customTagInput).filter(
      (tag) => !existingTagKeys.has(toTagKey(tag)),
    );
    if (nextTags.length === 0) {
      setCustomTagInput('');
      return;
    }

    setSelectedTags((current) => uniqueTags([...current, ...nextTags]));
    setCustomTagInput('');
  };

  const hasPanelContent = triggerBusy || Boolean(suggestionError) || suggestedTags.length > 0 || selectedCustomTags.length > 0;

  const panel = (
    <div
      className={cn(
        'rounded-2xl border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.12)]',
        mode === 'desktop-popover'
          ? 'absolute left-0 top-full z-30 mt-2 w-[min(26rem,calc(100vw-3rem))]'
          : 'w-full max-w-none',
      )}
    >
      <div className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              <p className="text-sm font-semibold text-slate-900">AI tag suggestions</p>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Pick the tags you want to add, or mix in your own.
            </p>
          </div>
          {mode === 'desktop-popover' ? (
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              aria-label="Close tag suggestions"
            >
              <X className="w-4 h-4" />
            </button>
          ) : null}
        </div>

        {triggerBusy ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
              <span>Suggesting tags...</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <div className="w-20">
                <SkeletonTag />
              </div>
              <div className="w-24">
                <SkeletonTag />
              </div>
              <div className="w-16">
                <SkeletonTag />
              </div>
            </div>
          </div>
        ) : null}

        {!triggerBusy && suggestionError ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3">
            <p className="text-sm font-medium text-red-700">Couldn&apos;t generate tag suggestions.</p>
            <p className="mt-1 text-xs text-red-600">{suggestionError}</p>
          </div>
        ) : null}

        {!triggerBusy && suggestedTags.length > 0 ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-400">
                Suggested
              </p>
              <p className="text-xs text-slate-500">
                {selectedCount > 0 ? `${selectedCount} ready to add` : 'Select tags or accept all'}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {suggestedTags.map((tag) => {
                const selected = selectedTagKeys.has(toTagKey(tag));

                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleSuggestedTag(tag)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                      selected
                        ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm'
                        : 'border-dashed border-indigo-200 bg-indigo-50/60 text-indigo-700 hover:bg-indigo-100',
                    )}
                  >
                    {selected ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                    <span>#{tag}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {!triggerBusy && selectedCustomTags.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-400">
              Custom
            </p>
            <div className="flex flex-wrap gap-2">
              {selectedCustomTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() =>
                    setSelectedTags((current) => current.filter((item) => toTagKey(item) !== toTagKey(tag)))
                  }
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-slate-900 px-3 py-1.5 text-xs font-medium text-white"
                >
                  <X className="w-3 h-3" />
                  <span>#{tag}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {!triggerBusy ? (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-slate-400">
              Add custom tag
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={customTagInput}
                onChange={(event) => setCustomTagInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleCustomTagAdd();
                  }
                }}
                placeholder="product review, podcast"
                className="h-10 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
              />
              <button
                type="button"
                onClick={handleCustomTagAdd}
                disabled={!customTagInput.trim()}
                className="inline-flex h-10 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleApply()}
            disabled={isSubmitting !== null || selectedCount === 0}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Wand2 className="w-3.5 h-3.5" />
            {selectedCount === 0
              ? 'Apply'
              : `Apply ${selectedCount} ${selectedCount === 1 ? 'tag' : 'tags'}`}
          </button>
          {suggestedTags.length > 0 ? (
            <button
              type="button"
              onClick={handleSelectAll}
              disabled={isSubmitting !== null || suggestedTags.every((tag) => selectedTagKeys.has(toTagKey(tag)))}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Accept all
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={isSubmitting !== null}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {suggestedTags.length > 0 || suggestionError ? 'Regenerate' : 'Generate'}
          </button>
          {(suggestedTags.length > 0 || suggestionError) ? (
            <button
              type="button"
              onClick={() => void handleDismiss()}
              disabled={isSubmitting !== null}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Dismiss
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );

  if (mode === 'desktop-popover') {
    return (
      <div ref={rootRef} className="relative inline-flex max-w-full">
        <button
          type="button"
          onClick={() => {
            if (!isOpen && !hasPanelContent) {
              void handleGenerate();
              return;
            }

            openPanel();
          }}
          disabled={isSubmitting === 'apply' || isSubmitting === 'dismiss'}
          className={cn(
            'inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
            triggerBusy
              ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
              : suggestedTags.length > 0
                ? 'border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50'
                : suggestionError
                  ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
          )}
        >
          {triggerBusy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          <span className="truncate">{triggerLabel}</span>
        </button>

        {isOpen ? panel : null}
      </div>
    );
  }

  return (
    <div ref={rootRef} className={cn('flex w-full flex-col items-start gap-3', compact ? '' : '')}>
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => {
            if (!isOpen && !hasPanelContent) {
              void handleGenerate();
              return;
            }

            openPanel();
          }}
          disabled={isSubmitting === 'apply' || isSubmitting === 'dismiss'}
          className={cn(
            'inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold shadow-sm transition-colors',
            triggerBusy
              ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
              : suggestedTags.length > 0
                ? 'border-indigo-200 bg-white text-indigo-700 hover:bg-indigo-50'
                : suggestionError
                  ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
          )}
        >
          {triggerBusy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          <span>{triggerLabel}</span>
        </button>
      </div>

      {isOpen ? panel : null}
    </div>
  );
}
