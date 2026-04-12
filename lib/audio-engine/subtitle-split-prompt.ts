import type { LlmSplitConfig, SubtitleSplitFailureInfo } from './subtitle-split-llm-types.js';

export function buildSubtitleSplitRequestBody(
  config: LlmSplitConfig,
  text: string,
  maxPerLine: number,
  unit: string,
  lastFailure?: SubtitleSplitFailureInfo,
) {
  const systemPrompt =
    `You split transcript text into readable subtitle segments. Insert <br> tags at natural sentence boundaries. `
    + `Each segment should be <=${maxPerLine} ${unit}. Do NOT modify, add, remove, normalize, summarize, or translate any text. `
    + `Only return the full original text with <br> tags inserted.`;

  const userPrompt = lastFailure
    ? `Your previous output had an issue: ${lastFailure.message}\n`
      + `Return the COMPLETE original text with <br> tags inserted at natural subtitle boundaries only:\n${text}`
    : `Split this transcript text with <br> markers only:\n${text}`;

  return {
    model: config.model,
    temperature: 0.1,
    max_tokens: Math.max(text.length * 2, 500),
    messages: [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userPrompt },
    ],
  };
}
