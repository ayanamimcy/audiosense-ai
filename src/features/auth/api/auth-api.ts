import { apiFetch, apiJson } from '@/shared/api/base';
import { getStoredUser, storeUser, clearStoredUser } from '@/shared/lib/local-storage';
import type { AuthUser, PublicConfig } from '@/entities/user';

export { getStoredUser, storeUser, clearStoredUser };

export async function getCurrentUser() {
  const payload = await apiJson<{ user: AuthUser }>('/api/auth/me');
  storeUser(payload.user);
  return payload.user;
}

export async function getPublicConfig() {
  return apiJson<PublicConfig>('/api/public-config');
}

export async function loginWithPassword(input: { email: string; password: string }) {
  const payload = await apiJson<{ user: AuthUser }>('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  storeUser(payload.user);
  return payload.user;
}

export async function registerWithPassword(input: {
  name: string;
  email: string;
  password: string;
}) {
  const payload = await apiJson<{ user: AuthUser }>('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  storeUser(payload.user);
  return payload.user;
}

export async function logout() {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } finally {
    clearStoredUser();
  }
}
