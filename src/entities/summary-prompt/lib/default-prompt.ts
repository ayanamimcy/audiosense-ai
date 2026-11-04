import type { SummaryPrompt } from '../model/types';

/** Mirrors isSummaryPromptAvailableForNotebook() in lib/tasks/summary-prompts.ts. */
export function isPromptAvailableInNotebook(prompt: SummaryPrompt, notebookId?: string | null) {
  if (!prompt.notebookIds.length) return true;
  return notebookId ? prompt.notebookIds.includes(notebookId) : false;
}

export function getWorkspaceDefaultPrompt(prompts: SummaryPrompt[], notebookId?: string | null) {
  return prompts.find((prompt) => prompt.isDefault && isPromptAvailableInNotebook(prompt, notebookId)) || null;
}

/**
 * Mirrors getDefaultSummaryPromptForNotebook() on the server: the notebook's own default
 * when it is set and still available there, otherwise the workspace default.
 */
export function getDefaultPromptForNotebook(
  prompts: SummaryPrompt[],
  notebookId?: string | null,
  notebookDefaultPromptId?: string | null,
) {
  if (notebookId && notebookDefaultPromptId) {
    const notebookDefault = prompts.find((prompt) => (
      prompt.id === notebookDefaultPromptId && isPromptAvailableInNotebook(prompt, notebookId)
    ));
    if (notebookDefault) return notebookDefault;
  }
  return getWorkspaceDefaultPrompt(prompts, notebookId);
}
