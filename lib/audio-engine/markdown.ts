import type { TranscriptionResult } from './types.js';

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const secs = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');

  return `${mins}:${secs}`;
}

export function formatTranscriptMarkdown(result: TranscriptionResult) {
  const sections: string[] = ['## Transcript'];

  if (result.speakers.length > 0) {
    sections.push('### Speakers');
    for (const speaker of result.speakers) {
      sections.push(
        `- ${speaker.label}: ${speaker.segmentCount} segments, ${speaker.durationSeconds.toFixed(1)}s`,
      );
    }
  }

  if (result.metadata.warnings.length > 0) {
    sections.push('', '### Notes');
    for (const warning of result.metadata.warnings) {
      sections.push(`- ${warning}`);
    }
  }

  if (result.segments.length > 0) {
    sections.push('', '### Timeline');
    for (const segment of result.segments) {
      const speaker = segment.speaker ? `**${segment.speaker}** ` : '';
      sections.push(`- [${formatTime(segment.start)} - ${formatTime(segment.end)}] ${speaker}${segment.text}`);
    }
  } else if (result.text) {
    sections.push('', result.text);
  }

  return sections.join('\n');
}

