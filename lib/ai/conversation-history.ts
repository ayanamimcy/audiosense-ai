/**
 * Prepares Ask AI conversation history for the model.
 *
 * Each answer cites its sources as [Source N @ MM:SS], but N is only meaningful within that
 * turn: the next turn retrieves and numbers its sources again. Old markers left in the history
 * make the model reuse stale numbers (and users see citations pointing at the wrong recording),
 * so they are removed, together with the "Sources" list each answer ends with.
 */

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Turns of history sent with the answer prompt (a turn = one question + one answer). */
export const ANSWER_HISTORY_TURNS = 4;
/** Turns of history the search query rewrite sees, to resolve follow-ups like "那第二点呢？". */
export const RETRIEVAL_HISTORY_TURNS = 2;

const MAX_ANSWER_HISTORY_CHARS = 2000;
const MAX_RETRIEVAL_HISTORY_CHARS = 600;

// [Source 2], [Source 2 @ 03:15], [Sources 1, 3], [Source 1 @ 1:02:03; Source 2]
const CITATION_PATTERN = /\s?\[Sources?\s+\d[^\]]*\]/gi;
// A trailing "Sources" / "来源" heading and everything after it.
const SOURCES_SECTION_PATTERN = /\n[ \t]*(?:#{1,6}[ \t]*)?(?:\*\*)?(?:Sources|References|来源|参考来源|参考资料)(?:\*\*)?[ \t]*[:：]?(?:\*\*)?[ \t]*\n[\s\S]*$/i;

function clip(text: string, maxChars: number) {
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

/** An assistant answer without per-turn citation markers and its trailing sources list. */
export function stripCitations(content: string) {
  return content
    .replace(SOURCES_SECTION_PATTERN, '')
    .replace(CITATION_PATTERN, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function lastTurns(history: ConversationTurn[], turns: number) {
  const usable = history.filter((message) => message.content.trim());
  // Count back user messages so the window starts at a question, not mid-turn.
  let questions = 0;
  let start = usable.length;
  while (start > 0) {
    start -= 1;
    if (usable[start].role === 'user') {
      questions += 1;
      if (questions === turns) break;
    }
  }
  return usable.slice(start);
}

function prepare(history: ConversationTurn[], turns: number, maxChars: number): ConversationTurn[] {
  return lastTurns(history, turns)
    .map((message) => ({
      role: message.role,
      content: clip(message.role === 'assistant' ? stripCitations(message.content) : message.content.trim(), maxChars),
    }))
    .filter((message) => message.content);
}

/** History to send with the answer prompt: recent turns, citations removed, long answers clipped. */
export function prepareAnswerHistory(history: ConversationTurn[]) {
  return prepare(history, ANSWER_HISTORY_TURNS, MAX_ANSWER_HISTORY_CHARS);
}

/** Short history for the search query rewrite. */
export function prepareRetrievalHistory(history: ConversationTurn[]) {
  return prepare(history, RETRIEVAL_HISTORY_TURNS, MAX_RETRIEVAL_HISTORY_CHARS);
}

/** Plain-text transcript of history for prompts that take a single user message. */
export function formatHistoryForPrompt(history: ConversationTurn[]) {
  return history
    .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
    .join('\n');
}
