import type { TranscriptSegment } from '../audio-engine/types.js';

function clampTimestamp(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return 0;
  }

  return seconds;
}

function formatWebVttTimestamp(seconds: number) {
  const totalMilliseconds = Math.round(clampTimestamp(seconds) * 1000);
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}

function normalizeCueText(segment: TranscriptSegment) {
  const speakerPrefix = segment.speaker?.trim() ? `${segment.speaker.trim()}: ` : '';
  return `${speakerPrefix}${segment.text || ''}`
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

export function buildWebVttFromSegments(segments: TranscriptSegment[]) {
  const cues = segments
    .filter((segment) => Number.isFinite(segment.start) && Number.isFinite(segment.end) && segment.end > segment.start)
    .map((segment, index) => {
      const text = normalizeCueText(segment);
      if (!text) {
        return null;
      }

      const start = formatWebVttTimestamp(segment.start);
      const end = formatWebVttTimestamp(Math.max(segment.end, segment.start + 0.05));
      return `${index + 1}\n${start} --> ${end}\n${text}`;
    })
    .filter(Boolean);

  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}
