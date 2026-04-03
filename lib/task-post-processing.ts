import { v4 as uuidv4 } from 'uuid';
import { generateTaskSummary, isLlmConfigured } from './llm.js';
import { getDefaultSummaryPromptForNotebook, listSummaryPrompts } from './summary-prompts.js';
import { reindexTask } from './search-index.js';
import type { UserSettings } from './settings.js';
import {
  buildSummaryGenerationMetadata,
  getSummaryGenerationRequestId,
  normalizeSummaryGenerationError,
  SUMMARY_GENERATING_SENTINEL,
} from './chat-service.js';
import {
  markTaskTagSuggestionsGenerating,
  persistTaskTagSuggestions,
} from './task-tag-suggestions.js';
import {
  findTaskRowById,
  updateTaskRowById,
} from '../database/repositories/tasks-repository.js';
import { repairPossiblyMojibakeText } from './text-encoding.js';
import type { TaskRow } from './task-types.js';

// ---------------------------------------------------------------------------
// Post-processing step contract
// ---------------------------------------------------------------------------

export interface PostProcessingStep {
  id: string;
  /** Return true when this step should run for the given task + settings. */
  enabled(task: TaskRow, settings: Partial<UserSettings> | null): boolean;
  /** Execute the step. Errors are caught by the runner — they never fail the main task. */
  run(task: TaskRow, settings: Partial<UserSettings> | null): Promise<void>;
}

// ---------------------------------------------------------------------------
// Built-in steps
// ---------------------------------------------------------------------------

const summaryStep: PostProcessingStep = {
  id: 'summary',

  enabled(_task, settings) {
    const auto = settings?.autoGenerateSummary || process.env.AUTO_GENERATE_SUMMARY === 'true';
    return Boolean(auto && isLlmConfigured(settings || undefined));
  },

  async run(task, settings) {
    const requestId = uuidv4();

    // Mark generating — keeps the client polling until we finish or fail
    await updateTaskRowById(task.id, {
      summary: SUMMARY_GENERATING_SENTINEL,
      metadata: buildSummaryGenerationMetadata(task, {
        status: 'generating',
        error: null,
        requestId,
      }),
      updatedAt: Date.now(),
    });

    try {
      const displayName = repairPossiblyMojibakeText(task.originalName);
      const summaryPrompts = task.userId ? await listSummaryPrompts(task.userId) : [];
      const defaultPrompt = getDefaultSummaryPromptForNotebook(summaryPrompts, task.notebookId)?.prompt || null;

      const summary = await generateTaskSummary(
        {
          title: displayName,
          transcript: task.transcript!,
          language: task.language,
          speakers: task.speakers ? JSON.parse(task.speakers) : [],
        },
        undefined,
        settings || undefined,
        defaultPrompt,
      );

      // Guard: only write if our request is still current
      const latest = await findTaskRowById(task.id);
      if (
        !latest
        || latest.summary !== SUMMARY_GENERATING_SENTINEL
        || getSummaryGenerationRequestId(latest) !== requestId
      ) {
        return;
      }

      await updateTaskRowById(task.id, {
        summary: summary || null,
        metadata: buildSummaryGenerationMetadata(latest, {
          status: null,
          error: null,
          requestId: null,
        }),
        updatedAt: Date.now(),
      });
      const updated = (await findTaskRowById(task.id)) as TaskRow;
      await reindexTask(updated);
    } catch (error) {
      // Surface the failure in metadata so the UI can show it
      const latest = await findTaskRowById(task.id);
      if (
        !latest
        || latest.summary !== SUMMARY_GENERATING_SENTINEL
        || getSummaryGenerationRequestId(latest) !== requestId
      ) {
        return;
      }

      await updateTaskRowById(task.id, {
        summary: null,
        metadata: buildSummaryGenerationMetadata(latest, {
          status: 'failed',
          error: normalizeSummaryGenerationError(error),
          requestId: null,
        }),
        updatedAt: Date.now(),
      }).catch(() => {});

      // Re-throw so the runner logs it
      throw error;
    }
  },
};

const tagSuggestionStep: PostProcessingStep = {
  id: 'tag-suggestions',

  enabled(task, settings) {
    return Boolean(task.userId && settings?.autoSuggestTags && isLlmConfigured(settings));
  },

  async run(task, settings) {
    // markTaskTagSuggestionsGenerating already sets tagSuggestionStatus: 'generating'
    // which keeps the client polling, and persistTaskTagSuggestions handles its own
    // failure metadata — so no extra work needed here.
    const requestId = await markTaskTagSuggestionsGenerating(task);
    await persistTaskTagSuggestions(task.id, settings!, requestId);
  },
};

// ---------------------------------------------------------------------------
// Step registry
// ---------------------------------------------------------------------------

const steps: PostProcessingStep[] = [
  summaryStep,
  tagSuggestionStep,
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export interface PostProcessingOptions {
  /** Override which step IDs to run. When omitted, all enabled steps run. */
  only?: string[];
  /**
   * The completedAt timestamp from the processing run that produced this task.
   * Used as a per-run token: if the row's completedAt changes (e.g. because
   * the user reprocessed the task), all subsequent steps are skipped.
   */
  completedAt?: number | null;
}

/**
 * Runs all enabled post-processing steps for a completed task.
 *
 * Each step is isolated — a failure in one step is logged but does not
 * prevent subsequent steps from running, and never affects the task's
 * `completed` status. Steps are responsible for persisting their own
 * failure metadata so the UI can surface errors.
 */
export async function runTaskPostProcessing(
  task: TaskRow,
  settings: Partial<UserSettings> | null,
  options?: PostProcessingOptions,
) {
  const taskId = task.id;
  const runToken = options?.completedAt ?? null;
  let currentTask = task;

  for (const step of steps) {
    if (options?.only && !options.only.includes(step.id)) {
      continue;
    }

    // Reload the row before each step so later steps see metadata written
    // by earlier ones, and so we can detect if the task was reprocessed.
    const fresh = await findTaskRowById(taskId);
    if (!fresh || fresh.status !== 'completed') {
      console.log(`Skipping remaining post-processing for task ${taskId}: status is no longer completed`);
      return;
    }
    if (runToken !== null && fresh.completedAt !== runToken) {
      console.log(`Skipping remaining post-processing for task ${taskId}: completedAt changed (reprocessed)`);
      return;
    }
    currentTask = fresh;

    if (!step.enabled(currentTask, settings)) {
      continue;
    }

    try {
      console.log(`Starting post-processing step "${step.id}" for task ${taskId}`);
      await step.run(currentTask, settings);
      console.log(`Completed post-processing step "${step.id}" for task ${taskId}`);
    } catch (error) {
      console.error(`Failed post-processing step "${step.id}" for task ${taskId}:`, error);
    }
  }
}
