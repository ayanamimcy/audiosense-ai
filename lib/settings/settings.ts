import {
  findStoredUserSettingsRow,
  listProviderHealthRows,
  upsertStoredUserSettingsRow,
} from '../../database/repositories/user-settings-repository.js';
import {
  canEncryptStoredSettings,
  decryptStoredSettings,
  encryptStoredSettings,
} from '../auth/secure-settings.js';
import { getAvailableTranscriptionProviders } from '../audio-engine/providers/index.js';
import {
  getDefaultSettings,
  sanitizeUserSettings,
  toClientUserSettings,
  type ClientUserSettings,
  type StoredUserSettingsInput,
  type UserSettings,
} from './user-settings-schema.js';

export { getDefaultSettings, sanitizeUserSettings };
export type {
  ClientUserSettings,
  SubtitleSplitSettings,
  LlmSettings,
  LocalRuntimeSettings,
  OpenAIWhisperSettings,
  RuntimeUserSettings,
  StoredUserSettingsInput,
  UserSettings,
} from './user-settings-schema.js';

function stripServerOnlySettings(input: StoredUserSettingsInput | null | undefined) {
  if (!input) {
    return null;
  }

  const sanitized = { ...input } as StoredUserSettingsInput & { subtitleLlm?: unknown };
  delete sanitized.subtitleSplit;
  delete sanitized.subtitleLlm;
  return sanitized;
}

async function loadStoredUserSettingsInput(userId: string) {
  const row = await findStoredUserSettingsRow(userId);
  if (!row?.settings) {
    return null;
  }

  const stored = decryptStoredSettings(String(row.settings));
  if (!stored.encrypted && canEncryptStoredSettings()) {
    await upsertStoredUserSettingsRow({
      userId,
      settings: encryptStoredSettings(stored.plaintext),
      createdAt: Number(row.createdAt || Date.now()),
      updatedAt: Date.now(),
    });
  }

  return stripServerOnlySettings(JSON.parse(stored.plaintext) as StoredUserSettingsInput);
}

export async function getUserSettings(userId: string) {
  try {
    const storedInput = await loadStoredUserSettingsInput(userId);
    if (!storedInput) {
      return getDefaultSettings();
    }

    return sanitizeUserSettings(storedInput);
  } catch {
    return getDefaultSettings();
  }
}

export async function getUserSettingsForClient(userId: string) {
  const storedInput = await loadStoredUserSettingsInput(userId).catch(() => null);
  const settings = sanitizeUserSettings(storedInput || {});
  return toClientUserSettings(settings, storedInput);
}

export async function saveUserSettings(userId: string, input: StoredUserSettingsInput) {
  const persistedInput = stripServerOnlySettings(input) || {};
  const currentSettings = await getUserSettings(userId);
  const settings = sanitizeUserSettings(persistedInput, currentSettings);
  const storedSettings = stripServerOnlySettings(settings) || {};
  const now = Date.now();
  const existing = await findStoredUserSettingsRow(userId);
  await upsertStoredUserSettingsRow({
    userId,
    settings: encryptStoredSettings(JSON.stringify(storedSettings)),
    createdAt: Number(existing?.createdAt || now),
    updatedAt: now,
  });

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
  const rows = await listProviderHealthRows();
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
