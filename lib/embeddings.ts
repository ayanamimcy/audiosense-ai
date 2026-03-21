import axios from 'axios';

function getEmbeddingsBaseUrl() {
  return (
    process.env.EMBEDDING_API_BASE_URL ||
    process.env.LLM_API_BASE_URL ||
    'https://api.openai.com/v1'
  ).replace(/\/$/, '');
}

function getEmbeddingsApiKey() {
  return process.env.EMBEDDING_API_KEY || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '';
}

function getEmbeddingsModel() {
  return process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
}

export function isEmbeddingsConfigured() {
  return Boolean(getEmbeddingsApiKey());
}

export function getEmbeddingsInfo() {
  return {
    configured: isEmbeddingsConfigured(),
    model: getEmbeddingsModel(),
    baseUrl: getEmbeddingsBaseUrl(),
  };
}

export async function createEmbedding(input: string) {
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

  const embedding = response.data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error('Embedding API did not return a vector.');
  }

  return {
    model: getEmbeddingsModel(),
    vector: embedding.map((value: unknown) => Number(value)),
  };
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
