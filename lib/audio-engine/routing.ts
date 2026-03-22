import { db } from '../../db.js';
import { getAvailableTranscriptionProviders } from './providers/index.js';
import { getUserSettings } from '../settings.js';

type ProviderHealthRow = {
  provider: string;
  failureCount: number;
  successCount: number;
  circuitOpenUntil?: number | null;
  lastFailureAt?: number | null;
  lastError?: string | null;
  updatedAt: number;
};

export async function buildProviderChain(userId: string | null | undefined, primary?: string | null) {
  const configuredProviders = new Set(
    getAvailableTranscriptionProviders()
      .filter((item) => item.configured)
      .map((item) => item.id),
  );

  const settings = userId ? await getUserSettings(userId) : null;
  const chain = [
    primary || settings?.defaultProvider || process.env.TRANSCRIPTION_PROVIDER || 'whisperx',
    ...(settings?.fallbackProviders || []),
  ]
    .map((item) => String(item).toLowerCase())
    .filter((item, index, array) => item && array.indexOf(item) === index && configuredProviders.has(item));

  return chain.length > 0 ? chain : ['whisperx'];
}

export async function isProviderCircuitOpen(provider: string) {
  const row = (await db('provider_health').where({ provider }).first()) as ProviderHealthRow | undefined;
  return Boolean(row?.circuitOpenUntil && row.circuitOpenUntil > Date.now());
}

export async function recordProviderSuccess(provider: string) {
  const row = (await db('provider_health').where({ provider }).first()) as ProviderHealthRow | undefined;
  const now = Date.now();
  if (row) {
    await db('provider_health').where({ provider }).update({
      failureCount: 0,
      successCount: Number(row.successCount || 0) + 1,
      circuitOpenUntil: null,
      lastError: null,
      updatedAt: now,
    });
  } else {
    await db('provider_health').insert({
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
  const row = (await db('provider_health').where({ provider }).first()) as ProviderHealthRow | undefined;
  const nextFailureCount = Number(row?.failureCount || 0) + 1;
  const now = Date.now();
  const circuitOpenUntil = nextFailureCount >= threshold ? now + cooldownMs : null;

  if (row) {
    await db('provider_health').where({ provider }).update({
      failureCount: nextFailureCount,
      successCount: Number(row.successCount || 0),
      circuitOpenUntil,
      lastFailureAt: now,
      lastError: error.message,
      updatedAt: now,
    });
  } else {
    await db('provider_health').insert({
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
  await db('provider_health').where({ provider }).update({
    failureCount: 0,
    circuitOpenUntil: null,
    lastError: null,
    updatedAt: Date.now(),
  });
}

