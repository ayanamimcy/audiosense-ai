import axios from 'axios';
import { resolveLlmSettings, type UserSettings } from './user-settings-schema.js';

interface RerankCandidate {
  id: string;
  content: string;
}

interface RerankResult {
  id: string;
  score: number;
}

export async function rerankChunks(
  query: string,
  candidates: RerankCandidate[],
  topK: number,
  settings?: Partial<UserSettings>,
  signal?: AbortSignal,
): Promise<RerankResult[]> {
  if (candidates.length === 0) return [];
  if (candidates.length <= topK) {
    return candidates.map((c, i) => ({ id: c.id, score: candidates.length - i }));
  }

  const resolved = resolveLlmSettings(settings);
  if (!resolved.apiKey) {
    return candidates.slice(0, topK).map((c, i) => ({ id: c.id, score: candidates.length - i }));
  }

  const candidateBlock = candidates
    .map((c, i) => `[${i + 1}] ${c.content.slice(0, 300)}`)
    .join('\n\n');

  try {
    const response = await axios.post(
      `${resolved.baseUrl}/chat/completions`,
      {
        model: resolved.model,
        temperature: 0.0,
        max_tokens: 300,
        messages: [
          {
            role: 'system',
            content:
              'You are a relevance judge. Given a query and numbered text passages, decide which passages are relevant to the query and rank them.\n'
              + 'Output a JSON object with two fields:\n'
              + '- "relevant": array of passage numbers that ARE relevant, ordered by relevance (most relevant first)\n'
              + '- "irrelevant": array of passage numbers that are NOT relevant to the query\n'
              + 'Example: {"relevant": [3, 1, 5], "irrelevant": [2, 4, 6]}\n'
              + 'Be strict: only include passages that genuinely help answer the query. Output ONLY the JSON object.',
          },
          {
            role: 'user',
            content: `Query: ${query}\n\nPassages:\n${candidateBlock}\n\nJudge and rank:`,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${resolved.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
        signal,
      },
    );

    const content = String(response.data?.choices?.[0]?.message?.content || '').trim();

    // Try to parse the structured format first
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as { relevant?: number[]; irrelevant?: number[] };
        if (Array.isArray(parsed.relevant) && parsed.relevant.length > 0) {
          const results: RerankResult[] = [];
          const seen = new Set<number>();

          for (const rank of parsed.relevant) {
            const idx = rank - 1;
            if (idx >= 0 && idx < candidates.length && !seen.has(idx)) {
              seen.add(idx);
              results.push({
                id: candidates[idx].id,
                score: parsed.relevant.length - results.length,
              });
              if (results.length >= topK) break;
            }
          }

          // Return only relevant results — irrelevant chunks are filtered out
          return results;
        }
      } catch { /* fall through to array parsing */ }
    }

    // Fallback: parse as plain array (old format)
    const arrayMatch = content.match(/\[[\d\s,]+\]/);
    if (arrayMatch) {
      const ranked = JSON.parse(arrayMatch[0]) as number[];
      const results: RerankResult[] = [];
      const seen = new Set<number>();

      for (const rank of ranked) {
        const idx = rank - 1;
        if (idx >= 0 && idx < candidates.length && !seen.has(idx)) {
          seen.add(idx);
          results.push({
            id: candidates[idx].id,
            score: candidates.length - results.length,
          });
          if (results.length >= topK) break;
        }
      }

      return results;
    }

    return candidates.slice(0, topK).map((c, i) => ({ id: c.id, score: candidates.length - i }));
  } catch (error) {
    console.error('Rerank failed, returning original order:', error);
    return candidates.slice(0, topK).map((c, i) => ({ id: c.id, score: candidates.length - i }));
  }
}
