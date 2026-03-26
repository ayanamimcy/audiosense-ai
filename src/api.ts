import type { AuthUser, PublicConfig } from './types';

const CURRENT_USER_KEY = 'currentUser';

export function getStoredUser() {
  const raw = localStorage.getItem(CURRENT_USER_KEY);
  return raw ? (JSON.parse(raw) as AuthUser) : null;
}

export function storeUser(user: AuthUser) {
  localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
}

export function clearStoredUser() {
  localStorage.removeItem(CURRENT_USER_KEY);
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, {
    credentials: 'same-origin',
    ...init,
  });

  if (response.status === 401) {
    clearStoredUser();
  }

  return response;
}

export async function apiJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  const response = await apiFetch(input, init);
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: string }).error)
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

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
