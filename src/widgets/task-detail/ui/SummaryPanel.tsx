import { useEffect, useState } from 'react';
import { ChevronRight, Loader2, Sparkles } from 'lucide-react';
import { apiFetch } from '@/shared/api/base';
import { cn } from '@/shared/lib/cn';
import { MarkdownContent } from '@/shared/ui/MarkdownContent';
import { useAppDataContext } from '@/app/providers/app-data-context';
import {
  SUMMARY_GENERATING_SENTINEL,
  getTaskSummaryGenerationError,
  isTaskSummaryGenerating,
  type Task,
} from '@/entities/task';

export function SummaryPanel({
  task,
  onUpdateTask,
}: {
  task: Task;
  onUpdateTask: () => void | Promise<void>;
}) {
  const { capabilities, summaryPrompts } = useAppDataContext();
  const [promptSelection, setPromptSelection] = useState('default');
  const [instructions, setInstructions] = useState('');
  const [isInstructionsOpen, setIsInstructionsOpen] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);

  useEffect(() => {
    setPromptSelection('default');
    setInstructions('');
    setIsInstructionsOpen(false);
  }, [task.id]);

  const generationError = getTaskSummaryGenerationError(task);
  const isGenerating = isRequesting || isTaskSummaryGenerating(task);
  const hasSummary = Boolean(task.summary && task.summary !== SUMMARY_GENERATING_SENTINEL);
  const isLlmConfigured = Boolean(capabilities?.llm.configured);
  const availablePrompts = summaryPrompts.filter((prompt) => (
    !prompt.notebookIds.length || (task.notebookId ? prompt.notebookIds.includes(task.notebookId) : false)
  ));
  const defaultPrompt = availablePrompts.find((prompt) => prompt.isDefault) || null;

  const handleGenerate = async () => {
    setIsRequesting(true);
    try {
      const res = await apiFetch(`/api/tasks/${task.id}/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instructions,
          summaryPromptId: promptSelection !== 'default' && promptSelection !== 'none' ? promptSelection : null,
          skipConfiguredPrompt: promptSelection === 'none',
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || 'Failed to generate summary.');
      }
      // The backend returns immediately; polling picks up the result.
      await onUpdateTask();
    } catch (error: unknown) {
      console.error('Failed to generate summary:', error);
      alert(error instanceof Error ? error.message : 'Failed to generate summary.');
    } finally {
      setIsRequesting(false);
    }
  };

  const handleDismiss = async () => {
    await apiFetch(`/api/tasks/${task.id}/summary/cancel`, { method: 'POST' });
    await onUpdateTask();
  };

  const controls = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm text-stone-600">
        <Sparkles className="h-4 w-4 text-indigo-700" />
        <label htmlFor="summary-template">Template</label>
        <select
          id="summary-template"
          value={promptSelection}
          onChange={(event) => setPromptSelection(event.target.value)}
          className="h-8 max-w-[14rem] rounded-md border border-stone-200 bg-white px-2 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
        >
          <option value="default">{defaultPrompt ? `Default · ${defaultPrompt.name}` : 'Default'}</option>
          <option value="none">No template</option>
          {availablePrompts.map((prompt) => (
            <option key={prompt.id} value={prompt.id}>{prompt.name}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setIsInstructionsOpen((current) => !current)}
          aria-expanded={isInstructionsOpen}
          className="inline-flex items-center gap-1 text-sm text-stone-600 hover:text-stone-900"
        >
          <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', isInstructionsOpen && 'rotate-90')} />
          Instructions
        </button>
        <button
          type="button"
          onClick={() => void handleGenerate()}
          disabled={isGenerating || !isLlmConfigured || !task.transcript}
          className={cn(
            'ml-auto h-8 rounded-md px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50',
            hasSummary ? 'text-indigo-700 hover:bg-indigo-50' : 'bg-stone-900 text-white hover:bg-stone-800',
          )}
        >
          {isGenerating ? 'Generating…' : hasSummary ? 'Regenerate' : 'Generate summary'}
        </button>
      </div>
      {isInstructionsOpen ? (
        <textarea
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          aria-label="Extra instructions"
          placeholder="Optional, e.g. “Focus on decisions, risks and action items.”"
          className="min-h-20 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-900/10"
        />
      ) : null}
      {!isLlmConfigured ? (
        <p className="text-sm text-amber-800">Summaries need an AI model — set one up in Settings › AI model.</p>
      ) : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      {controls}

      {generationError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">The last summary attempt failed.</p>
          <p className="mt-1">{generationError}</p>
        </div>
      ) : null}

      {isTaskSummaryGenerating(task) ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-stone-300 px-6 py-10 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-stone-500" />
          <p className="text-sm font-medium text-stone-800">Writing the summary…</p>
          <p className="text-xs text-stone-500">It appears here automatically. You can keep browsing.</p>
          <button
            type="button"
            onClick={() => void handleDismiss()}
            className="mt-2 h-8 rounded-md border border-stone-200 bg-white px-3 text-xs font-medium text-stone-700 hover:bg-stone-50"
          >
            Stop waiting
          </button>
        </div>
      ) : hasSummary ? (
        <MarkdownContent
          content={task.summary || ''}
          proseClassName="prose prose-stone max-w-none text-[15px] leading-relaxed prose-headings:font-semibold prose-headings:text-stone-900 prose-a:text-indigo-700"
        />
      ) : (
        <p className="rounded-xl border border-dashed border-stone-300 px-6 py-10 text-center text-sm text-stone-600">
          No summary yet.
        </p>
      )}
    </div>
  );
}
