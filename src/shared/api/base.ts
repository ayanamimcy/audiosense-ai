import { clearStoredUser } from '@/shared/lib/local-storage';

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
