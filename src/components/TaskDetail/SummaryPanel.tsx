import React from 'react';
import { HelpCircle } from 'lucide-react';
import { MarkdownContent } from '../MarkdownContent';
import type { AppCapabilities, SummaryPrompt, Task } from '../../types';

export function SummaryPanel({
  task,
  capabilities,
  summaryPrompts,
  summaryInstructions,
  onSummaryInstructionsChange,
  summaryPromptSelection,
  onSummaryPromptSelectionChange,
  isGenerating,
  onGenerate,
}: {
  task: Task;
  capabilities: AppCapabilities | null;
  summaryPrompts: SummaryPrompt[];
  summaryInstructions: string;
  onSummaryInstructionsChange: (value: string) => void;
  summaryPromptSelection: string;
  onSummaryPromptSelectionChange: (value: string) => void;
  isGenerating: boolean;
  onGenerate: () => void;
}) {
  const availableSummaryPrompts = summaryPrompts.filter((prompt) => {
    if (!prompt.notebookIds.length) {
      return true;
    }
    return task.notebookId ? prompt.notebookIds.includes(task.notebookId) : false;
  });
  const defaultSummaryPrompt = availableSummaryPrompts.find((prompt) => prompt.isDefault) || null;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Summary Workspace</h3>
            <p className="text-sm text-slate-500 mt-1">用 LLM 基于当前转写生成总结、要点和行动项。</p>
          </div>
          <button
            onClick={onGenerate}
            disabled={isGenerating || !capabilities?.llm.configured || !task.transcript}
            className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGenerating ? 'Generating...' : task.summary ? 'Regenerate Summary' : 'Generate Summary'}
          </button>
        </div>
        <div className="mt-4">
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
          placeholder={"可选：例如\u201C请重点总结会议决策、风险项和待办事项\u201D。留空时会使用上面的 Summary Prompt 选择。"}
          className="w-full mt-4 min-h-24 px-4 py-3 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <p className="text-xs text-slate-500 mt-3">
          {summaryPromptSelection === 'none'
            ? '当前不会使用配置页里的 Prompt，会直接使用系统默认总结方式。'
            : summaryPromptSelection !== 'default'
              ? '当前会使用你在上面选中的 Summary Prompt。'
              : defaultSummaryPrompt
                ? `当前会优先使用默认 Summary Prompt：${defaultSummaryPrompt.name}。`
                : '当前没有可用的默认 Summary Prompt，会直接使用系统默认总结方式。'}
        </p>
        {!capabilities?.llm.configured && <p className="text-sm text-amber-600 mt-3">当前还没有配置 LLM API，摘要和对话功能暂时不可用。</p>}
      </div>

      {task.summary ? (
        <MarkdownContent
          content={task.summary}
          proseClassName="prose prose-slate max-w-none prose-headings:font-semibold prose-a:text-indigo-600"
        />
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
          还没有生成摘要。你可以直接生成，也可以先写一段自定义总结要求。
        </div>
      )}
    </div>
  );
}
