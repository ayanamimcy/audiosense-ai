import type { Task } from '../model/types';

const AUDIO_EXTENSIONS = new Set([
  '.aac',
  '.flac',
  '.m4a',
  '.mp3',
  '.ogg',
  '.opus',
  '.wav',
  '.webm',
]);

const VIDEO_EXTENSIONS = new Set([
  '.m4v',
  '.mkv',
  '.mov',
  '.mp4',
  '.ogv',
  '.webm',
]);

function getNormalizedMimeType(task: Pick<Task, 'metadata'>) {
  const mimeType = task.metadata?.originalMimeType;
  return typeof mimeType === 'string' ? mimeType.trim().toLowerCase() : '';
}

function getLowerExtension(task: Pick<Task, 'filename' | 'originalName'>) {
  const name = (task.originalName || task.filename || '').toLowerCase();
  const lastDot = name.lastIndexOf('.');
  return lastDot >= 0 ? name.slice(lastDot) : '';
}

export function isVideoTask(task: Pick<Task, 'filename' | 'originalName' | 'metadata'>) {
  const mimeType = getNormalizedMimeType(task);
  if (mimeType.startsWith('video/')) {
    return true;
  }
  if (mimeType.startsWith('audio/')) {
    return false;
  }

  const extension = getLowerExtension(task);
  if (VIDEO_EXTENSIONS.has(extension) && !AUDIO_EXTENSIONS.has(extension)) {
    return true;
  }

  return extension === '.mov' || extension === '.m4v' || extension === '.mkv';
}

export function getTaskMediaUrl(task: Pick<Task, 'filename'>) {
  return `/api/audio/${task.filename}`;
}

export function getTaskSubtitleUrl(task: Pick<Task, 'id'>) {
  return `/api/tasks/${task.id}/subtitles.vtt`;
}

export function getTaskTrackLanguage(task: Pick<Task, 'language'>) {
  const normalized = typeof task.language === 'string' ? task.language.trim().toLowerCase() : '';
  if (!normalized || normalized === 'auto') {
    return 'und';
  }

  return normalized;
}
