const EAST_ASIAN_CHAR_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const EAST_ASIAN_PUNCTUATION_PATTERN = /[。、，．・「」『』【】（）［］｛｝〈〉《》ー〜！？]/g;
const LATIN1_MOJIBAKE_HINT_PATTERN = /[ÃÂãâåæçèéêëìíîïðñòóôõöøùúûüýþÿ]/g;
const CONTROL_CHAR_PATTERN = /[\u0080-\u009f]/g;

function countMatches(text: string, pattern: RegExp) {
  return text.match(pattern)?.length || 0;
}

function scoreText(text: string) {
  return (
    countMatches(text, EAST_ASIAN_CHAR_PATTERN) * 4 +
    countMatches(text, EAST_ASIAN_PUNCTUATION_PATTERN) * 2 -
    countMatches(text, LATIN1_MOJIBAKE_HINT_PATTERN) * 3 -
    countMatches(text, CONTROL_CHAR_PATTERN) * 4
  );
}

export function repairPossiblyMojibakeText(value: string) {
  if (!value || /^[\x00-\x7F]*$/.test(value)) {
    return value;
  }

  const decoded = Buffer.from(value, 'latin1').toString('utf8');
  if (!decoded || decoded.includes('\uFFFD') || decoded === value) {
    return value;
  }

  return scoreText(decoded) > scoreText(value) ? decoded : value;
}
