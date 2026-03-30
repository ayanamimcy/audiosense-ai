import { db } from '../client.js';

export interface StoredUserSettingsRow {
  userId: string;
  settings: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderHealthRow {
  provider: string;
  failureCount: number;
  successCount: number;
  circuitOpenUntil?: number | null;
  lastFailureAt?: number | null;
  lastError?: string | null;
  updatedAt: number;
}

export async function findStoredUserSettingsRow(userId: string) {
  return (await db('user_settings').where({ userId }).first()) as StoredUserSettingsRow | undefined;
}

export async function upsertStoredUserSettingsRow(row: StoredUserSettingsRow) {
  const existing = await findStoredUserSettingsRow(row.userId);
  if (existing) {
    await db('user_settings').where({ userId: row.userId }).update({
      settings: row.settings,
      updatedAt: row.updatedAt,
    });
    return;
  }

  await db('user_settings').insert(row);
}

export async function listProviderHealthRows() {
  return (await db('provider_health').select('*')) as ProviderHealthRow[];
}

export async function findProviderHealthRow(provider: string) {
  return (await db('provider_health').where({ provider }).first()) as ProviderHealthRow | undefined;
}

export async function upsertProviderHealthRow(row: ProviderHealthRow) {
  const existing = await findProviderHealthRow(row.provider);
  if (existing) {
    await db('provider_health').where({ provider: row.provider }).update(row);
    return;
  }

  await db('provider_health').insert(row);
}

export async function updateProviderHealthRow(provider: string, updates: Partial<ProviderHealthRow>) {
  await db('provider_health').where({ provider }).update(updates);
}
