import axios from 'axios';
import config from '../config.js';

function getEmbeddingsBaseUrl() {
  return config.embeddings.baseUrl;
}

function getEmbeddingsApiKey() {
  return config.embeddings.apiKey;
}

function getEmbeddingsModel() {
  return config.embeddings.model;
}

export function getEmbeddingDimensions() {
  return config.embeddings.dimensions;
}

export function isEmbeddingsConfigured() {
  return Boolean(getEmbeddingsApiKey());
}

export function getEmbeddingsInfo() {
  return {
    configured: isEmbeddingsConfigured(),
    model: getEmbeddingsModel(),
    dimensions: getEmbeddingDimensions(),
    baseUrl: getEmbeddingsBaseUrl(),
  };
}

/** Inputs sent per request by createEmbeddings; OpenAI-compatible APIs accept arrays of this size. */
const EMBEDDING_BATCH_SIZE = 64;

function toVector(embedding: unknown) {
  if (!Array.isArray(embedding)) {
    throw new Error('Embedding API did not return a vector.');
  }
  if (embedding.length !== getEmbeddingDimensions()) {
    throw new Error(
      `Embedding dimension mismatch: configured ${getEmbeddingDimensions()}, received ${embedding.length}.`,
    );
  }
  return embedding.map((value: unknown) => Number(value));
}

async function postEmbeddings(input: string | string[]) {
  const apiKey = getEmbeddingsApiKey();
  if (!apiKey) {
    throw new Error('Embedding API is not configured.');
  }

  const response = await axios.post(
    `${getEmbeddingsBaseUrl()}/embeddings`,
    {
      model: getEmbeddingsModel(),
      input,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 120000,
    },
  );

  return response.data?.data as Array<{ embedding?: unknown; index?: number }> | undefined;
}

export async function createEmbedding(input: string) {
  const data = await postEmbeddings(input);
  return {
    model: getEmbeddingsModel(),
    vector: toVector(data?.[0]?.embedding),
  };
}

/**
 * Embeds many inputs with one request per batch instead of one per input.
 * The result is aligned with `inputs`; an entry is null when that input could not be embedded.
 * If a batch request fails (e.g. a provider without array support), its inputs are retried one by one.
 */
export async function createEmbeddings(inputs: string[]) {
  const model = getEmbeddingsModel();
  const results: Array<{ model: string; vector: number[] } | null> = new Array(inputs.length).fill(null);

  for (let offset = 0; offset < inputs.length; offset += EMBEDDING_BATCH_SIZE) {
    const batch = inputs.slice(offset, offset + EMBEDDING_BATCH_SIZE);
    try {
      const data = await postEmbeddings(batch);
      if (!Array.isArray(data) || data.length !== batch.length) {
        throw new Error('Embedding API returned an unexpected number of vectors.');
      }
      data.forEach((item, position) => {
        const index = typeof item.index === 'number' ? item.index : position;
        results[offset + index] = { model, vector: toVector(item.embedding) };
      });
    } catch {
      for (let index = 0; index < batch.length; index += 1) {
        try {
          results[offset + index] = await createEmbedding(batch[index]);
        } catch {
          results[offset + index] = null;
        }
      }
    }
  }

  return results;
}

export function cosineSimilarity(a: number[], b: number[]) {
  if (a.length === 0 || a.length !== b.length) {
    return -1;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }

  if (normA === 0 || normB === 0) {
    return -1;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
