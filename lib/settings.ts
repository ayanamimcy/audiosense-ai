import { db } from '../db.js';
import { getAvailableTranscriptionProviders } from './audio-engine/providers/index.js';

export interface UserSettings {
  defaultProvider: string;
  fallbackProviders: string[];
  autoGenerateSummary: boolean;
  circuitBreakerThreshold: number;
  circuitBreakerCooldownMs: number;
  retrievalMode: 'hybrid' | 'fts' | 'vector';
  maxKnowledgeChunks: number;
}

const DEFAULT_SETTINGS: UserSettings = {
  defaultProvider: (process.env.TRANSCRIPTION_PROVIDER || 'whisperx').toLowerCase(),
  fallbackProviders: [],
  autoGenerateSummary: process.env.AUTO_GENERATE_SUMMARY === 'true',
  circuitBreakerThreshold: 3,
  circuitBreakerCooldownMs: 5 * 60 * 1000,
  retrievalMode: 'hybrid',
  maxKnowledgeChunks: 8,
};

export function getDefaultSettings() {
  return { ...DEFAULT_SETTINGS };
}

export function sanitizeUserSettings(input: Partial<UserSettings>) {
  const knownProviderIds = new Set(getAvailableTranscriptionProviders().map((item) => item.id));
  const defaultProvider = knownProviderIds.has(String(input.defaultProvider || ''))
    ? String(input.defaultProvider)
    : DEFAULT_SETTINGS.defaultProvider;

  const fallbackProviders = Array.isArray(input.fallbackProviders)
    ? input.fallbackProviders
        .map((item) => String(item))
        .filter((item) => knownProviderIds.has(item) && item !== defaultProvider)
        .slice(0, 5)
    : DEFAULT_SETTINGS.fallbackProviders;

  return {
    defaultProvider,
    fallbackProviders,
    autoGenerateSummary:
      typeof input.autoGenerateSummary === 'boolean'
        ? input.autoGenerateSummary
        : DEFAULT_SETTINGS.autoGenerateSummary,
    circuitBreakerThreshold: Math.min(
      10,
      Math.max(1, Number(input.circuitBreakerThreshold || DEFAULT_SETTINGS.circuitBreakerThreshold)),
    ),
    circuitBreakerCooldownMs: Math.min(
      60 * 60 * 1000,
      Math.max(
        10_000,
        Number(input.circuitBreakerCooldownMs || DEFAULT_SETTINGS.circuitBreakerCooldownMs),
      ),
    ),
    retrievalMode: ['hybrid', 'fts', 'vector'].includes(String(input.retrievalMode))
      ? (input.retrievalMode as UserSettings['retrievalMode'])
      : DEFAULT_SETTINGS.retrievalMode,
    maxKnowledgeChunks: Math.min(
      20,
      Math.max(3, Number(input.maxKnowledgeChunks || DEFAULT_SETTINGS.maxKnowledgeChunks)),
    ),
  } satisfies UserSettings;
}

export async function getUserSettings(userId: string) {
  const row = await db('user_settings').where({ userId }).first();
  if (!row?.settings) {
    return getDefaultSettings();
  }

  try {
    return sanitizeUserSettings(JSON.parse(row.settings) as Partial<UserSettings>);
  } catch {
    return getDefaultSettings();
  }
}

export async function saveUserSettings(userId: string, input: Partial<UserSettings>) {
  const settings = sanitizeUserSettings(input);
  const now = Date.now();
  const existing = await db('user_settings').where({ userId }).first();

  if (existing) {
    await db('user_settings').where({ userId }).update({
      settings: JSON.stringify(settings),
      updatedAt: now,
    });
  } else {
    await db('user_settings').insert({
      userId,
      settings: JSON.stringify(settings),
      createdAt: now,
      updatedAt: now,
    });
  }

  return settings;
}

export type ProviderHealth = {
  provider: string;
  failureCount: number;
  successCount: number;
  circuitOpenUntil: number | null;
  lastFailureAt: number | null;
  lastError: string | null;
  updatedAt: number;
  configured: boolean;
};

export async function getProviderHealth() {
  const rows = (await db('provider_health').select('*')) as Array<{
    provider: string;
    failureCount: number;
    successCount: number;
    circuitOpenUntil?: number | null;
    lastFailureAt?: number | null;
    lastError?: string | null;
    updatedAt: number;
  }>;
  const providers = getAvailableTranscriptionProviders();
  const healthMap = new Map(rows.map((row) => [row.provider, row]));

  return providers.map((provider) => {
    const health = healthMap.get(provider.id);
    return {
      provider: provider.id,
      failureCount: health?.failureCount || 0,
      successCount: health?.successCount || 0,
      circuitOpenUntil: health?.circuitOpenUntil ?? null,
      lastFailureAt: health?.lastFailureAt ?? null,
      lastError: health?.lastError ?? null,
      updatedAt: health?.updatedAt || 0,
      configured: provider.configured,
    } satisfies ProviderHealth;
  });
}
