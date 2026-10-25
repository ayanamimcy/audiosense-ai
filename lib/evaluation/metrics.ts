/**
 * Evaluation metrics for transcription and retrieval. Pure functions, no I/O.
 */

/**
 * Normalization applied to both reference and hypothesis before scoring, so the metric
 * measures recognition rather than formatting:
 * - NFKC folds full-width/half-width forms (ＡＢＣ → ABC, ｶﾀｶﾅ → カタカナ, １２ → 12)
 * - lower-case Latin text
 * - drop punctuation and symbols (、。！？「」…, ASCII punctuation) and all whitespace
 *
 * Not normalized (deliberately, and worth stating in any report): kanji vs kana spellings
 * (例えば / たとえば), numerals vs kanji numbers (3 / 三), and filler words (えーと).
 * These count as errors, which inflates CER compared with a human judging meaning.
 */
export function normalizeForCer(text: string) {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, '')
    .replace(/\s+/gu, '');
}

export function normalizeForWer(text: string) {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean);
}

/** Levenshtein distance over arbitrary token arrays (characters or words). */
export function editDistance<T>(reference: readonly T[], hypothesis: readonly T[]) {
  const previous = new Array<number>(hypothesis.length + 1);
  const current = new Array<number>(hypothesis.length + 1);
  for (let j = 0; j <= hypothesis.length; j += 1) previous[j] = j;

  for (let i = 1; i <= reference.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= hypothesis.length; j += 1) {
      const substitution = previous[j - 1] + (reference[i - 1] === hypothesis[j - 1] ? 0 : 1);
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
    }
    for (let j = 0; j <= hypothesis.length; j += 1) previous[j] = current[j];
  }
  return previous[hypothesis.length];
}

export interface ErrorRate {
  /** errors / reference length; can exceed 1 when the hypothesis has many insertions */
  rate: number;
  errors: number;
  referenceLength: number;
}

/** Character error rate — the standard metric for Japanese/Chinese, which have no word spaces. */
export function characterErrorRate(reference: string, hypothesis: string): ErrorRate {
  const ref = Array.from(normalizeForCer(reference));
  const hyp = Array.from(normalizeForCer(hypothesis));
  const errors = editDistance(ref, hyp);
  return { rate: ref.length ? errors / ref.length : hyp.length ? 1 : 0, errors, referenceLength: ref.length };
}

/** Word error rate — for space-delimited languages such as English. */
export function wordErrorRate(reference: string, hypothesis: string): ErrorRate {
  const ref = normalizeForWer(reference);
  const hyp = normalizeForWer(hypothesis);
  const errors = editDistance(ref, hyp);
  return { rate: ref.length ? errors / ref.length : hyp.length ? 1 : 0, errors, referenceLength: ref.length };
}

/**
 * Corpus-level rate: total errors over total reference length. This weights each clip by
 * its length, unlike averaging per-clip rates, which lets a 5-second clip count as much as
 * a 30-minute meeting.
 */
export function pooledErrorRate(items: ErrorRate[]) {
  const errors = items.reduce((sum, item) => sum + item.errors, 0);
  const referenceLength = items.reduce((sum, item) => sum + item.referenceLength, 0);
  return referenceLength ? errors / referenceLength : 0;
}

/** Recall@k for one query: share of relevant ids that appear in the top k results. */
export function recallAtK(ranked: readonly string[], relevant: ReadonlySet<string>, k: number) {
  if (relevant.size === 0) return 0;
  const top = new Set(ranked.slice(0, k));
  let hits = 0;
  for (const id of relevant) if (top.has(id)) hits += 1;
  return hits / relevant.size;
}

/** Reciprocal rank of the first relevant result (0 when none is retrieved). */
export function reciprocalRank(ranked: readonly string[], relevant: ReadonlySet<string>) {
  const index = ranked.findIndex((id) => relevant.has(id));
  return index === -1 ? 0 : 1 / (index + 1);
}

export function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

/** True when two time ranges overlap, with `toleranceSec` of slack on both ends. */
export function rangesOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number },
  toleranceSec = 0,
) {
  return a.start <= b.end + toleranceSec && b.start <= a.end + toleranceSec;
}
