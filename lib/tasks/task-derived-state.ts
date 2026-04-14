import { buildTagSuggestionMetadata } from './task-tag-suggestions.js';
import { parseJsonField, type TaskRow } from './task-types.js';

type TaskLike = Pick<TaskRow, 'metadata'>;

/**
 * Builds a new metadata JSON string with all derived / post-processing state
 * cleared, ready for a fresh processing run.
 *
 * Currently resets:
 *  - summary generation state  (summaryGenerationStatus / Error / RequestId)
 *  - tag suggestion state       (tagSuggestionStatus / Error / RequestId / Items / GeneratedAt / DismissedAt)
 *
 * Future derived states (e.g. notebook suggestions, topic extraction) should be
 * added here so every "re-enter main flow" code path stays in sync.
 */
export function resetTaskDerivedState(task: TaskLike): string {
  // Start by clearing tag suggestion state via the canonical helper
  const withTagsCleared = buildTagSuggestionMetadata(task, {
    status: null,
    error: null,
    requestId: null,
    items: null,
    generatedAt: null,
    dismissedAt: null,
  });

  // Then clear summary generation state on top of the result
  const metadata = parseJsonField<Record<string, unknown>>(withTagsCleared, {});
  delete metadata.summaryGenerationStatus;
  delete metadata.summaryGenerationError;
  delete metadata.summaryGenerationRequestId;

  return JSON.stringify(metadata);
}
