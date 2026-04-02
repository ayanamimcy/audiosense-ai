import { v4 as uuidv4 } from 'uuid';
import { findNotebookRowByUserAndId } from '../database/repositories/notebooks-repository.js';
import {
  findTaskRowById,
  listTaskTagRowsByUser,
  updateTaskRowById,
} from '../database/repositories/tasks-repository.js';
import { generateTaskTagSuggestions } from './llm.js';
import type { UserSettings } from './settings.js';
import { parseJsonField, type TaskRow } from './task-types.js';
import { repairPossiblyMojibakeText } from './text-encoding.js';

type TagSuggestionStatus = 'generating' | 'failed';

type TagSuggestionTaskLike = Pick<TaskRow, 'metadata'>;

type TagSuggestionState = {
  status: TagSuggestionStatus | null;
  error: string | null;
  requestId: string | null;
  items: string[];
  generatedAt: number | null;
  dismissedAt: number | null;
};

const MAX_TAG_SUGGESTIONS = 5;
const MAX_NEW_TAG_SUGGESTIONS = 2;
const MAX_HISTORICAL_TAG_CANDIDATES = 50;
const SUMMARY_GENERATING_SENTINEL = '__generating__';
const TRANSCRIPT_EXCERPT_LENGTH = 6000;

const GENERIC_TAGS = new Set([
  'audio',
  'audio note',
  'call',
  'calls',
  'conversation',
  'discussion',
  'file',
  'files',
  'general',
  'meeting',
  'meetings',
  'misc',
  'note',
  'notes',
  'other',
  'recording',
  'recordings',
  'summary',
  'task',
  'tasks',
  'transcript',
  'transcription',
  'voice note',
  'voice notes',
  '会议',
  '对话',
  '录音',
  '录音文件',
  '总结',
  '笔记',
  '转写',
  '转录',
  '通话',
  '任务',
  '文件',
  '其他',
  '杂项',
]);

function getTaskMetadata(task: TagSuggestionTaskLike) {
  return parseJsonField<Record<string, unknown>>(task.metadata, {});
}

function readOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readOptionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function getTaskTagSuggestionState(task: TagSuggestionTaskLike): TagSuggestionState {
  const metadata = getTaskMetadata(task);
  const status = metadata.tagSuggestionStatus;

  return {
    status: status === 'generating' || status === 'failed' ? status : null,
    error: readOptionalString(metadata.tagSuggestionError),
    requestId: readOptionalString(metadata.tagSuggestionRequestId),
    items: Array.isArray(metadata.tagSuggestionItems)
      ? metadata.tagSuggestionItems.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    generatedAt: readOptionalNumber(metadata.tagSuggestionGeneratedAt),
    dismissedAt: readOptionalNumber(metadata.tagSuggestionDismissedAt),
  };
}

export function getTaskTagSuggestionItems(task: TagSuggestionTaskLike) {
  return getTaskTagSuggestionState(task).items;
}

export function getTaskTagSuggestionRequestId(task: TagSuggestionTaskLike) {
  return getTaskTagSuggestionState(task).requestId;
}

export function buildTagSuggestionMetadata(
  task: TagSuggestionTaskLike,
  options: {
    status?: TagSuggestionStatus | null;
    error?: string | null;
    requestId?: string | null;
    items?: string[] | null;
    generatedAt?: number | null;
    dismissedAt?: number | null;
  },
) {
  const metadata = getTaskMetadata(task);
  const current = getTaskTagSuggestionState(task);
  const next = {
    status: Object.prototype.hasOwnProperty.call(options, 'status') ? options.status ?? null : current.status,
    error: Object.prototype.hasOwnProperty.call(options, 'error') ? options.error ?? null : current.error,
    requestId: Object.prototype.hasOwnProperty.call(options, 'requestId') ? options.requestId ?? null : current.requestId,
    items: Object.prototype.hasOwnProperty.call(options, 'items') ? options.items ?? [] : current.items,
    generatedAt: Object.prototype.hasOwnProperty.call(options, 'generatedAt') ? options.generatedAt ?? null : current.generatedAt,
    dismissedAt: Object.prototype.hasOwnProperty.call(options, 'dismissedAt') ? options.dismissedAt ?? null : current.dismissedAt,
  };

  if (next.status) {
    metadata.tagSuggestionStatus = next.status;
  } else {
    delete metadata.tagSuggestionStatus;
  }

  if (next.error) {
    metadata.tagSuggestionError = next.error;
  } else {
    delete metadata.tagSuggestionError;
  }

  if (next.requestId) {
    metadata.tagSuggestionRequestId = next.requestId;
  } else {
    delete metadata.tagSuggestionRequestId;
  }

  if (next.items.length > 0) {
    metadata.tagSuggestionItems = next.items;
  } else {
    delete metadata.tagSuggestionItems;
  }

  if (typeof next.generatedAt === 'number') {
    metadata.tagSuggestionGeneratedAt = next.generatedAt;
  } else {
    delete metadata.tagSuggestionGeneratedAt;
  }

  if (typeof next.dismissedAt === 'number') {
    metadata.tagSuggestionDismissedAt = next.dismissedAt;
  } else {
    delete metadata.tagSuggestionDismissedAt;
  }

  return JSON.stringify(metadata);
}

export function normalizeTagSuggestionError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return 'Tag suggestion generation failed. Please try again.';
}

function clipTranscript(value: string | null | undefined) {
  const transcript = String(value || '').trim();
  if (!transcript) {
    return '';
  }

  if (transcript.length <= TRANSCRIPT_EXCERPT_LENGTH) {
    return transcript;
  }

  return `${transcript.slice(0, TRANSCRIPT_EXCERPT_LENGTH).trimEnd()}...`;
}

function usesCjk(tag: string) {
  return /[\u3040-\u30ff\u3400-\u9fff]/u.test(tag);
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function canonicalizeTag(value: string) {
  return normalizeWhitespace(value)
    .replace(/^#+/, '')
    .replace(/[-_/]+/g, ' ')
    .toLowerCase();
}

function normalizeTagCandidate(value: string) {
  return normalizeWhitespace(
    value
      .replace(/^#+/, '')
      .replace(/^[`"'“”‘’]+|[`"'“”‘’]+$/g, '')
      .replace(/[，。！？、；：,.!?;:]+$/g, ''),
  );
}

function isGenericTag(tag: string) {
  return GENERIC_TAGS.has(canonicalizeTag(tag));
}

function isNumericOrDateLike(tag: string) {
  return /^[\d\s\-/:.]+$/.test(tag);
}

function isTagLengthValid(tag: string) {
  if (usesCjk(tag)) {
    const compact = tag.replace(/\s+/g, '');
    return compact.length >= 2 && compact.length <= 8;
  }

  const words = tag.split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 3 && tag.length <= 24 && tag.length >= 2;
}

function isTagShapeValid(tag: string) {
  if (!tag) {
    return false;
  }
  if (/[\r\n]/.test(tag)) {
    return false;
  }
  if (/[.!?。！？:：;；]/.test(tag)) {
    return false;
  }
  if (/[()[\]{}]/.test(tag)) {
    return false;
  }
  if (isNumericOrDateLike(tag)) {
    return false;
  }
  if (isGenericTag(tag)) {
    return false;
  }
  if (!isTagLengthValid(tag)) {
    return false;
  }

  return true;
}

function normalizeGeneratedTag(tag: string, historicalMap: Map<string, string>) {
  const normalizedCandidate = normalizeTagCandidate(tag);
  if (!normalizedCandidate || !isTagShapeValid(normalizedCandidate)) {
    return null;
  }

  const canonical = canonicalizeTag(normalizedCandidate);
  const historical = historicalMap.get(canonical);
  if (historical) {
    return {
      value: historical,
      canonical,
      historical: true,
    };
  }

  return {
    value: usesCjk(normalizedCandidate) ? normalizedCandidate : normalizedCandidate.toLowerCase(),
    canonical,
    historical: false,
  };
}

function isTitleLikeDuplicate(tag: string, title: string) {
  const normalizedTitle = canonicalizeTag(title.replace(/\.[a-z0-9]{1,6}$/i, ''));
  if (!normalizedTitle) {
    return false;
  }

  return canonicalizeTag(tag) === normalizedTitle;
}

function finalizeSuggestedTags(
  rawTags: string[],
  options: {
    existingTags: string[];
    historicalTags: string[];
    title: string;
  },
) {
  const historicalMap = new Map(
    options.historicalTags.map((tag) => [canonicalizeTag(tag), tag] as const),
  );
  const existingKeys = new Set(options.existingTags.map(canonicalizeTag));
  const selectedKeys = new Set<string>();
  const selected: string[] = [];
  let newTagCount = 0;

  for (const rawTag of rawTags) {
    const normalized = normalizeGeneratedTag(rawTag, historicalMap);
    if (!normalized) {
      continue;
    }
    if (existingKeys.has(normalized.canonical) || selectedKeys.has(normalized.canonical)) {
      continue;
    }
    if (isTitleLikeDuplicate(normalized.value, options.title)) {
      continue;
    }
    if (!normalized.historical && newTagCount >= MAX_NEW_TAG_SUGGESTIONS) {
      continue;
    }

    selected.push(normalized.value);
    selectedKeys.add(normalized.canonical);
    if (!normalized.historical) {
      newTagCount += 1;
    }

    if (selected.length >= MAX_TAG_SUGGESTIONS) {
      break;
    }
  }

  return selected;
}

async function listHistoricalTagCandidatesForUser(userId: string, existingTags: string[]) {
  const rows = await listTaskTagRowsByUser(userId);
  const counts = new Map<string, { value: string; count: number }>();
  const existingKeys = new Set(existingTags.map(canonicalizeTag));

  for (const row of rows) {
    for (const tag of parseJsonField<string[]>(row.tags, [])) {
      const normalized = normalizeTagCandidate(tag);
      if (!normalized || !isTagShapeValid(normalized)) {
        continue;
      }

      const key = canonicalizeTag(normalized);
      if (existingKeys.has(key)) {
        continue;
      }

      const current = counts.get(key);
      if (current) {
        current.count += 1;
      } else {
        counts.set(key, { value: tag, count: 1 });
      }
    }
  }

  return Array.from(counts.values())
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
    .slice(0, MAX_HISTORICAL_TAG_CANDIDATES)
    .map((item) => item.value);
}

async function buildSuggestedTagsForTask(task: TaskRow, userSettings: Partial<UserSettings>) {
  const title = repairPossiblyMojibakeText(task.originalName);
  const existingTags = parseJsonField<string[]>(task.tags, []);
  const historicalTags = task.userId
    ? await listHistoricalTagCandidatesForUser(task.userId, existingTags)
    : [];
  const notebook = task.userId && task.notebookId
    ? await findNotebookRowByUserAndId(task.userId, task.notebookId)
    : null;

  const rawTags = await generateTaskTagSuggestions(
    {
      title,
      summary:
        task.summary && task.summary !== SUMMARY_GENERATING_SENTINEL
          ? task.summary
          : null,
      transcript: clipTranscript(task.transcript),
      language: task.language,
      notebook: notebook?.name || null,
      existingTags,
      historicalTags,
    },
    userSettings,
  );

  return finalizeSuggestedTags(rawTags, {
    existingTags,
    historicalTags,
    title,
  });
}

export function removeAppliedTagsFromSuggestions(task: TagSuggestionTaskLike, appliedTags: string[]) {
  const state = getTaskTagSuggestionState(task);
  if (state.items.length === 0) {
    return task.metadata;
  }

  const appliedKeys = new Set(appliedTags.map(canonicalizeTag));
  const remainingItems = state.items.filter((tag) => !appliedKeys.has(canonicalizeTag(tag)));
  if (remainingItems.length === state.items.length) {
    return task.metadata;
  }

  return buildTagSuggestionMetadata(task, {
    items: remainingItems.length > 0 ? remainingItems : null,
    generatedAt: remainingItems.length > 0 ? state.generatedAt : null,
  });
}

export async function markTaskTagSuggestionsGenerating(
  task: TaskRow,
  options?: {
    clearDismissed?: boolean;
  },
) {
  const requestId = uuidv4();
  const updatedAt = Date.now();

  await updateTaskRowById(task.id, {
    metadata: buildTagSuggestionMetadata(task, {
      status: 'generating',
      error: null,
      requestId,
      items: null,
      generatedAt: null,
      dismissedAt: options?.clearDismissed === false
        ? getTaskTagSuggestionState(task).dismissedAt
        : null,
    }),
    updatedAt,
  });

  return requestId;
}

export async function persistTaskTagSuggestions(
  taskId: string,
  userSettings: Partial<UserSettings>,
  requestId: string,
) {
  try {
    const task = await findTaskRowById(taskId);
    if (!task || getTaskTagSuggestionRequestId(task) !== requestId) {
      return;
    }

    const suggestions = await buildSuggestedTagsForTask(task, userSettings);
    const latest = await findTaskRowById(taskId);
    if (!latest || getTaskTagSuggestionRequestId(latest) !== requestId) {
      return;
    }

    const latestExistingTagKeys = new Set(
      parseJsonField<string[]>(latest.tags, []).map(canonicalizeTag),
    );
    const nextSuggestions = suggestions.filter(
      (tag) => !latestExistingTagKeys.has(canonicalizeTag(tag)),
    );

    await updateTaskRowById(taskId, {
      metadata: buildTagSuggestionMetadata(latest, {
        status: null,
        error: null,
        requestId: null,
        items: nextSuggestions.length > 0 ? nextSuggestions : null,
        generatedAt: nextSuggestions.length > 0 ? Date.now() : null,
        dismissedAt: null,
      }),
      updatedAt: Date.now(),
    });
  } catch (error) {
    console.error(`Failed to generate tag suggestions for task ${taskId}:`, error);
    const latest = await findTaskRowById(taskId);
    if (!latest || getTaskTagSuggestionRequestId(latest) !== requestId) {
      return;
    }

    await updateTaskRowById(taskId, {
      metadata: buildTagSuggestionMetadata(latest, {
        status: 'failed',
        error: normalizeTagSuggestionError(error),
        requestId: null,
        items: null,
        generatedAt: null,
      }),
      updatedAt: Date.now(),
    }).catch(() => {});
  }
}
