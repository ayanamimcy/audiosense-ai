import React from 'react';
import { HelpCircle, Loader2 } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import {
  getTaskSummaryGenerationError,
  isTaskSummaryGenerating,
  SUMMARY_GENERATING_SENTINEL,
} from '@/lib/taskSummary';
import { MarkdownContent } from '@/shared/ui/MarkdownContent';
import { useAppDataContext } from '@/contexts/AppDataContext';
import type { Task } from '@/types';

export function SummaryPanel({
  task,
  summaryInstructions,
  onSummaryInstructionsChange,
  summaryPromptSelection,
  onSummaryPromptSelectionChange,
  isGenerating,
  onGenerate,
  onCancelSummary,
  compact = false,
  scrollContainerRef,
  onScroll,
}: {
  task: Task;
  summaryInstructions: string;
  onSummaryInstructionsChange: (value: string) => void;
  summaryPromptSelection: string;
  onSummaryPromptSelectionChange: (value: string) => void;
  isGenerating: boolean;
  onGenerate: () => void;
  onCancelSummary: () => void;
  compact?: boolean;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
  onScroll?: (event: React.UIEvent<HTMLDivElement>) => void;
}) {
  const { capabilities, summaryPrompts } = useAppDataContext();
  const summaryGenerationError = getTaskSummaryGenerationError(task);
  const isSummaryGenerating = isTaskSummaryGenerating(task);
  const hasGeneratedSummary = Boolean(
    task.summary && task.summary !== SUMMARY_GENERATING_SENTINEL,
  );
  const availableSummaryPrompts = summaryPrompts.filter((prompt) => {
    if (!prompt.notebookIds.length) {
      return true;
    }
    return task.notebookId ? prompt.notebookIds.includes(task.notebookId) : false;
  });
  const defaultSummaryPrompt = availableSummaryPrompts.find((prompt) => prompt.isDefault) || null;

  return (
    <div
      ref={scrollContainerRef}
      onScroll={onScroll}
      className={cn(
        'h-full overflow-y-auto custom-scrollbar',
        compact ? 'px-4 py-4 pb-28' : 'p-6 pb-6',
      )}
    >
      <div className="space-y-6">
        <div className={cn(compact ? 'space-y-5 border-b border-slate-200 pb-6' : 'rounded-2xl border border-slate-200 bg-slate-50 p-4')}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-base font-semibold text-slate-900 shrink-0">Summary Workspace</h3>
            <button
              onClick={onGenerate}
              disabled={isGenerating || !capabilities?.llm.configured || !task.transcript}
              className={cn(
                'bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed',
                compact ? 'w-full py-3' : 'px-4 py-2',
              )}
            >
              {isGenerating ? 'Generating...' : hasGeneratedSummary ? 'Regenerate Summary' : 'Generate Summary'}
            </button>
          </div>
          <div>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Summary Prompt</span>
              <select
                value={summaryPromptSelection}
                onChange={(event) => onSummaryPromptSelectionChange(event.target.value)}
                className="w-full mt-1 px-4 py-3 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="default">
                  {defaultSummaryPrompt
                    ? `Use default (${defaultSummaryPrompt.name})`
                    : 'Use default (none configured)'}
                </option>
                <option value="none">Do not use configured prompt</option>
                {availableSummaryPrompts.map((prompt) => (
                  <option key={prompt.id} value={prompt.id}>
                    {prompt.name}
                    {prompt.isDefault ? ' (Default)' : ''}
                  </option>
                ))}
              </select>
              <div className="flex items-start gap-2 mt-2 text-xs text-slate-500">
                <HelpCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" />
                <p>
                  {task.notebookId
                    ? 'This task can use prompts assigned to its notebook, plus prompts available in all notebooks.'
                    : 'This task is currently unassigned, so it can only use prompts available in all notebooks.'}
                </p>
              </div>
            </label>
          </div>
          <textarea
            value={summaryInstructions}
            onChange={(event) => onSummaryInstructionsChange(event.target.value)}
            placeholder={'Optional: e.g. "Focus on meeting decisions, risks, and action items." Leave empty to use the selected Summary Prompt above.'}
            className="w-full min-h-24 px-4 py-3 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <p className="text-xs text-slate-500">
            {summaryPromptSelection === 'none'
              ? 'The configured prompt will not be used. The system default summarization will apply.'
              : summaryPromptSelection !== 'default'
                ? 'The selected Summary Prompt above will be used.'
                : defaultSummaryPrompt
                  ? `Will use default Summary Prompt: ${defaultSummaryPrompt.name}.`
                  : 'No default Summary Prompt configured. The system default summarization will apply.'}
          </p>
          {!capabilities?.llm.configured && <p className="text-sm text-amber-600">LLM API is not configured. Summary and chat features are unavailable.</p>}
        </div>

        {summaryGenerationError ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p className="font-medium text-amber-900">Last summary attempt failed.</p>
            <p className="mt-1">{summaryGenerationError}</p>
          </div>
        ) : null}

        {isSummaryGenerating ? (
          <div className={cn(
            'flex flex-col items-center justify-center gap-3 text-slate-500',
            compact ? 'border-t border-slate-200 pt-12 pb-4' : 'rounded-2xl border border-dashed border-slate-300 p-12',
          )}>
            <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
            <p className="text-sm font-medium">Generating summary, please wait...</p>
            <p className="text-xs text-slate-400">It will appear automatically when ready. Feel free to switch panels.</p>
            <button
              type="button"
              onClick={onCancelSummary}
              className="mt-2 px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              Dismiss
            </button>
          </div>
        ) : hasGeneratedSummary ? (
          <MarkdownContent
            content={task.summary || ''}
            proseClassName="prose prose-slate max-w-none prose-headings:font-semibold prose-a:text-indigo-600"
          />
        ) : (
          <div className={cn(
            'text-center text-slate-500',
            compact ? 'border-t border-slate-200 pt-8 pb-2' : 'rounded-2xl border border-dashed border-slate-300 p-8',
          )}>
            No summary generated yet. Click "Generate Summary" above, or add custom instructions first.
          </div>
        )}
      </div>
    </div>
  );
}
