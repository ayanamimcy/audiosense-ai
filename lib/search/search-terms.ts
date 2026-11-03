/**
 * Keyword search helpers that work for languages written without spaces (Chinese, Japanese).
 *
 * SQLite FTS5's default tokenizer splits on whitespace and punctuation, so an unspaced Chinese
 * sentence becomes a single token and a query like "会议" never matches inside it. We index
 * CJK text with an invisible separator (U+200B) between characters, which turns every CJK
 * character into its own token, and query CJK words as phrases of those characters. A phrase
 * query then means "these characters, adjacent, in this order" — an exact substring match for
 * any length, without depending on a word segmenter at index time.
 */

const CJK = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}';
const CJK_CHAR = new RegExp(`[${CJK}]`, 'u');
const CJK_BOUNDARY = new RegExp(`(?<=[${CJK}])(?=\\S)|(?<=\\S)(?=[${CJK}])`, 'gu');
const TOKEN = /[\p{L}\p{N}]+/gu;

/** Separator FTS5's unicode61 tokenizer treats as a token boundary; invisible when displayed. */
export const FTS_CJK_SEPARATOR = '​';
const SEPARATOR_PATTERN = /​/g;

/** Upper bound on terms per query, so a pasted paragraph does not build a huge MATCH expression. */
const MAX_TERMS = 24;

/**
 * 'all': every term must match (recording list search box: more words narrow the results).
 * 'any': any term may match, ranked by relevance (Ask AI retrieval from natural questions).
 */
export type SearchMatchMode = 'all' | 'any';

const ENGLISH_STOPWORDS = new Set([
  'a', 'about', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'could',
  'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have', 'how', 'i', 'if', 'in', 'into', 'is',
  'it', 'its', 'me', 'my', 'of', 'on', 'or', 'our', 'should', 'so', 'than', 'that', 'the', 'their',
  'them', 'then', 'there', 'these', 'they', 'this', 'those', 'to', 'us', 'was', 'we', 'were', 'what',
  'when', 'where', 'which', 'who', 'why', 'will', 'with', 'would', 'you', 'your',
]);

export function containsCjk(text: string) {
  return CJK_CHAR.test(text);
}

/** Text as written to the SQLite FTS table. */
export function toFtsIndexText(text: string | null | undefined) {
  return String(text || '').replace(SEPARATOR_PATTERN, '').replace(CJK_BOUNDARY, FTS_CJK_SEPARATOR);
}

/** Undo toFtsIndexText for text read back from the FTS table (e.g. snippet()). */
export function fromFtsIndexText(text: string | null | undefined) {
  return String(text || '').replace(SEPARATOR_PATTERN, '');
}

let wordSegmenter: Intl.Segmenter | null | undefined;
function getWordSegmenter() {
  if (wordSegmenter === undefined) {
    try {
      wordSegmenter = typeof Intl.Segmenter === 'function'
        ? new Intl.Segmenter('zh', { granularity: 'word' })
        : null;
    } catch {
      wordSegmenter = null;
    }
  }
  return wordSegmenter;
}

function splitWords(query: string) {
  const segmenter = getWordSegmenter();
  if (!segmenter) {
    return query.match(TOKEN) || [];
  }
  return [...segmenter.segment(query)]
    .filter((segment) => segment.isWordLike)
    .flatMap((segment) => segment.segment.match(TOKEN) || []);
}

function bigrams(word: string) {
  const chars = [...word];
  const result: string[] = [];
  for (let index = 0; index + 1 < chars.length; index += 1) {
    result.push(chars[index] + chars[index + 1]);
  }
  return result;
}

function dedupe(terms: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const term of terms) {
    const key = term.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(term);
    }
  }
  return result.slice(0, MAX_TERMS);
}

/**
 * Terms to look up for a user query.
 *
 * 'all' keeps each space/punctuation-separated chunk whole, so "产品路线图" must appear as is.
 * 'any' splits natural-language questions into words with Intl.Segmenter and drops filler:
 * single CJK characters (的, 是, 吗) and common English stopwords. Segmenter output is not
 * always a dictionary word ("结论是"), so longer CJK words also contribute their two-character
 * pieces, which still find "结论".
 */
export function extractSearchTerms(query: string, mode: SearchMatchMode): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  if (mode === 'all') {
    return dedupe(trimmed.match(TOKEN) || []);
  }

  const words = splitWords(trimmed);
  const terms: string[] = [];
  const fallback: string[] = [];

  for (const word of words) {
    if (containsCjk(word)) {
      const length = [...word].length;
      if (length === 1) {
        fallback.push(word);
        continue;
      }
      terms.push(word);
      if (length >= 3) terms.push(...bigrams(word));
      continue;
    }

    const lower = word.toLowerCase();
    if (ENGLISH_STOPWORDS.has(lower) || (lower.length === 1 && !/\p{N}/u.test(lower))) {
      fallback.push(word);
      continue;
    }
    terms.push(word);
  }

  // A query made only of filler ("的", "what is it") still searches for what it has.
  return dedupe(terms.length > 0 ? terms : fallback);
}

/** FTS5 MATCH expression for terms, against text written with toFtsIndexText. */
export function toSqliteFtsMatch(terms: string[], mode: SearchMatchMode) {
  const phrases = terms
    .map((term) => toFtsIndexText(term).replace(SEPARATOR_PATTERN, ' ').trim())
    .filter(Boolean)
    .map((phrase) => `"${phrase.replace(/"/g, '""')}"`);
  return phrases.join(mode === 'any' ? ' OR ' : ' ');
}

/** Escapes a term for use inside a LIKE/ILIKE pattern (PostgreSQL's default escape is backslash). */
export function toLikePattern(term: string) {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * A short excerpt of `text` around the first term it contains, with the match in [brackets]
 * like SQLite's snippet(). Returns '' when no term occurs.
 */
export function buildSnippet(text: string | null | undefined, terms: string[], radius = 60) {
  const source = String(text || '');
  if (!source) return '';
  const lower = source.toLowerCase();

  let best: { index: number; length: number } | null = null;
  for (const term of terms) {
    const index = lower.indexOf(term.toLowerCase());
    if (index !== -1 && (!best || index < best.index)) {
      best = { index, length: term.length };
    }
  }
  if (!best) return '';

  const start = Math.max(0, best.index - radius);
  const end = Math.min(source.length, best.index + best.length + radius);
  return `${start > 0 ? '...' : ''}${source.slice(start, best.index)}[${source.slice(best.index, best.index + best.length)}]${source.slice(best.index + best.length, end)}${end < source.length ? '...' : ''}`;
}
