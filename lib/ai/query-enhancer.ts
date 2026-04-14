import axios from 'axios';
import { resolveLlmSettings, type UserSettings } from '../settings/user-settings-schema.js';
import { createEmbedding, isEmbeddingsConfigured } from './embeddings.js';

function getApiKey(settings?: Partial<UserSettings>) {
  return resolveLlmSettings(settings).apiKey;
}
function getBaseUrl(settings?: Partial<UserSettings>) {
  return resolveLlmSettings(settings).baseUrl;
}
function getModel(settings?: Partial<UserSettings>) {
  return resolveLlmSettings(settings).model;
}

async function quickCompletion(
  prompt: string,
  systemPrompt: string,
  settings?: Partial<UserSettings>,
  signal?: AbortSignal,
): Promise<string> {
  const apiKey = getApiKey(settings);
  if (!apiKey) return '';

  try {
    const response = await axios.post(
      `${getBaseUrl(settings)}/chat/completions`,
      {
        model: getModel(settings),
        temperature: 0.0,
        max_tokens: 300,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
        signal,
      },
    );
    return String(response.data?.choices?.[0]?.message?.content || '').trim();
  } catch {
    return '';
  }
}

/**
 * Rewrite a user query into a keyword-rich search query for FTS.
 * Returns the original query if LLM is unavailable.
 */
export async function rewriteQueryForSearch(
  query: string,
  settings?: Partial<UserSettings>,
  signal?: AbortSignal,
): Promise<string> {
  if (!getApiKey(settings)) return query;

  const rewritten = await quickCompletion(
    query,
    'Rewrite the following user question into a concise keyword-rich search query optimized for full-text search across audio transcripts. '
    + 'Include synonyms and related terms. Output ONLY the search query, no explanation. '
    + 'Keep the same language as the input.',
    settings,
    signal,
  );

  return rewritten || query;
}

/**
 * HyDE: Generate a hypothetical answer to the user's question,
 * then embed that answer for semantic search.
 * Returns the embedding vector, or null if unavailable.
 */
export async function generateHydeEmbedding(
  query: string,
  settings?: Partial<UserSettings>,
  signal?: AbortSignal,
): Promise<{ vector: number[]; model: string } | null> {
  if (!getApiKey(settings) || !isEmbeddingsConfigured()) return null;

  const hypothetical = await quickCompletion(
    query,
    'You are an assistant that answers questions about audio recordings and meeting transcripts. '
    + 'Write a brief, plausible answer (2-3 sentences) to the following question as if you had access to the relevant transcripts. '
    + 'Be specific and include likely keywords. Keep the same language as the question.',
    settings,
    signal,
  );

  if (!hypothetical) return null;

  try {
    return await createEmbedding(hypothetical);
  } catch {
    return null;
  }
}
