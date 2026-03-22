import { db } from '../db.js';
import { getAvailableTranscriptionProviders } from './audio-engine/providers/index.js';
import {
  getDefaultSettings,
  sanitizeUserSettings,
  type UserSettings,
} from './user-settings-schema.js';

export { getDefaultSettings, sanitizeUserSettings };
export type { LlmSettings, LocalRuntimeSettings, OpenAIWhisperSettings, UserSettings } from './user-settings-schema.js';

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
  const currentSettings = await getUserSettings(userId);
  const settings = sanitizeUserSettings(input, currentSettings);
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

export async function getProviderHealth(settings?: Partial<UserSettings> | null) {
  const rows = (await db('provider_health').select('*')) as Array<{
    provider: string;
    failureCount: number;
    successCount: number;
    circuitOpenUntil?: number | null;
    lastFailureAt?: number | null;
    lastError?: string | null;
    updatedAt: number;
  }>;
  const providers = getAvailableTranscriptionProviders(settings || undefined);
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
