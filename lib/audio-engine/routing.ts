import {
  findProviderHealthRow,
  upsertProviderHealthRow,
  updateProviderHealthRow,
} from '../../database/repositories/user-settings-repository.js';
import { getAvailableTranscriptionProviders } from './providers/index.js';
import { getUserSettings } from '../settings/settings.js';
import type { UserSettings } from '../settings/user-settings-schema.js';
import config from '../config.js';

export function buildProviderChain(settings: UserSettings | null | undefined, primary?: string | null) {
  const configuredProviders = new Set(
    getAvailableTranscriptionProviders(settings || undefined)
      .filter((item) => item.configured)
      .map((item) => item.id),
  );

  const chain = [
    primary || settings?.defaultProvider || config.transcription.defaultProvider,
    ...(settings?.fallbackProviders || []),
  ]
    .map((item) => String(item).toLowerCase())
    .filter((item, index, array) => item && array.indexOf(item) === index && configuredProviders.has(item));

  if (chain.length > 0) {
    return chain;
  }

  const configuredFallback = Array.from(configuredProviders);
  return configuredFallback.length > 0 ? configuredFallback : ['local-python'];
}

export async function isProviderCircuitOpen(provider: string) {
  const row = await findProviderHealthRow(provider);
  return Boolean(row?.circuitOpenUntil && row.circuitOpenUntil > Date.now());
}

export async function recordProviderSuccess(provider: string) {
  const row = await findProviderHealthRow(provider);
  const now = Date.now();
  if (row) {
    await updateProviderHealthRow(provider, {
      failureCount: 0,
      successCount: Number(row.successCount || 0) + 1,
      circuitOpenUntil: null,
      lastError: null,
      updatedAt: now,
    });
  } else {
    await upsertProviderHealthRow({
      provider,
      failureCount: 0,
      successCount: 1,
      circuitOpenUntil: null,
      lastFailureAt: null,
      lastError: null,
      updatedAt: now,
    });
  }
}

export async function recordProviderFailure(
  provider: string,
  userId: string | null | undefined,
  error: Error,
) {
  const settings = userId ? await getUserSettings(userId) : null;
  const threshold = settings?.circuitBreakerThreshold || 3;
  const cooldownMs = settings?.circuitBreakerCooldownMs || 5 * 60 * 1000;
  const row = await findProviderHealthRow(provider);
  const nextFailureCount = Number(row?.failureCount || 0) + 1;
  const now = Date.now();
  const circuitOpenUntil = nextFailureCount >= threshold ? now + cooldownMs : null;

  if (row) {
    await updateProviderHealthRow(provider, {
      failureCount: nextFailureCount,
      successCount: Number(row.successCount || 0),
      circuitOpenUntil,
      lastFailureAt: now,
      lastError: error.message,
      updatedAt: now,
    });
  } else {
    await upsertProviderHealthRow({
      provider,
      failureCount: nextFailureCount,
      successCount: 0,
      circuitOpenUntil,
      lastFailureAt: now,
      lastError: error.message,
      updatedAt: now,
    });
  }
}

export async function resetProviderCircuit(provider: string) {
  await updateProviderHealthRow(provider, {
    failureCount: 0,
    circuitOpenUntil: null,
    lastError: null,
    updatedAt: Date.now(),
  });
}
