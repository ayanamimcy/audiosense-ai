import type { TranscriptSegment } from './types.js';
import type { SplitWordSource } from './subtitle-split-models.js';
import { joinWordTexts } from './subtitle-split-text.js';
import { normalizeForComparison, textSimilarity, countSplitUnits } from './subtitle-split-validation.js';

function buildAlignedSegment(
  words: NonNullable<TranscriptSegment['words']>,
  text: string,
  speaker: string | undefined,
  wordSource: SplitWordSource,
): TranscriptSegment {
  return {
    id: '',
    start: words[0].start,
    end: words[words.length - 1].end,
    text,
    speaker,
    words: wordSource === 'provider' ? words : undefined,
  };
}

export function alignSubtitlePartsToWords(
  parts: string[],
  sortedWords: NonNullable<TranscriptSegment['words']>,
  isCjk: boolean,
  speaker: string | undefined,
  wordSource: SplitWordSource,
): TranscriptSegment[] | null {
  const result: TranscriptSegment[] = [];
  let wordOffset = 0;

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const remainingWords = sortedWords.length - wordOffset;
    const remainingParts = parts.length - index - 1;

    if (remainingWords <= 0) {
      return null;
    }

    if (index === parts.length - 1) {
      const subWords = sortedWords.slice(wordOffset);
      const reconstructed = joinWordTexts(subWords, isCjk ? 'zh' : 'en');
      const similarity = textSimilarity(
        normalizeForComparison(part, isCjk),
        normalizeForComparison(reconstructed, isCjk),
      );

      if (similarity < 0.9) {
        return null;
      }

      result.push(buildAlignedSegment(subWords, part, speaker, wordSource));
      break;
    }

    const targetUnits = Math.max(1, countSplitUnits(part, isCjk));
    const maxWindow = Math.max(1, remainingWords - remainingParts);
    const minWindow = Math.min(maxWindow, Math.max(1, Math.floor(targetUnits * 0.5)));

    let bestWindow = -1;
    let bestSimilarity = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let windowSize = minWindow; windowSize <= maxWindow; windowSize += 1) {
      const candidateWords = sortedWords.slice(wordOffset, wordOffset + windowSize);
      const candidate = joinWordTexts(candidateWords, isCjk ? 'zh' : 'en');
      const similarity = textSimilarity(
        normalizeForComparison(part, isCjk),
        normalizeForComparison(candidate, isCjk),
      );
      const distance = Math.abs(countSplitUnits(candidate, isCjk) - targetUnits);

      if (
        similarity > bestSimilarity
        || (similarity === bestSimilarity && distance < bestDistance)
      ) {
        bestWindow = windowSize;
        bestSimilarity = similarity;
        bestDistance = distance;
      }

      if (similarity === 1 && distance === 0) {
        break;
      }
    }

    if (bestWindow <= 0 || bestSimilarity < 0.88) {
      return null;
    }

    const subWords = sortedWords.slice(wordOffset, wordOffset + bestWindow);
    result.push(buildAlignedSegment(subWords, part, speaker, wordSource));
    wordOffset += bestWindow;
  }

  return result;
}
