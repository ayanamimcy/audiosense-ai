export function levenshteinDistance(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (!a.length) {
    return b.length;
  }
  if (!b.length) {
    return a.length;
  }

  const prev = new Array(b.length + 1).fill(0);
  const curr = new Array(b.length + 1).fill(0);

  for (let index = 0; index <= b.length; index += 1) {
    prev[index] = index;
  }

  for (let leftIndex = 1; leftIndex <= a.length; leftIndex += 1) {
    curr[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= b.length; rightIndex += 1) {
      const cost = a[leftIndex - 1] === b[rightIndex - 1] ? 0 : 1;
      curr[rightIndex] = Math.min(
        prev[rightIndex] + 1,
        curr[rightIndex - 1] + 1,
        prev[rightIndex - 1] + cost,
      );
    }

    for (let rightIndex = 0; rightIndex <= b.length; rightIndex += 1) {
      prev[rightIndex] = curr[rightIndex];
    }
  }

  return prev[b.length];
}

export function textSimilarity(a: string, b: string): number {
  if (a === b) {
    return 1;
  }

  const maxLength = Math.max(a.length, b.length);
  if (!maxLength) {
    return 1;
  }

  return 1 - levenshteinDistance(a, b) / maxLength;
}

export function stripBreaks(text: string): string {
  return text.replace(/<br\s*\/?>/gi, '').replace(/\s+/g, ' ').trim();
}

export function normalizeForComparison(text: string, isCjk: boolean) {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return isCjk ? collapsed.replace(/\s/g, '') : collapsed;
}

export function countSplitUnits(text: string, isCjk: boolean) {
  if (isCjk) {
    return text.replace(/\s/g, '').length;
  }

  return text.split(/\s+/).filter(Boolean).length;
}

export function findLengthViolation(parts: string[], isCjk: boolean, maxPerLine: number) {
  for (const part of parts) {
    const units = countSplitUnits(part, isCjk);
    if (units > maxPerLine) {
      return {
        part,
        units,
      };
    }
  }

  return null;
}
