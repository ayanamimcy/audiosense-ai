import { clearStoredUser } from '@/shared/lib/local-storage';

/** Fired on window when an API call comes back 401, i.e. the session is gone. */
export const UNAUTHORIZED_EVENT = 'audiosense:unauthorized';

// A 401 from these means "wrong credentials", not "session expired".
const CREDENTIAL_ENDPOINTS = ['/api/auth/login', '/api/auth/register'];

function requestPath(input: RequestInfo | URL) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.pathname;
  return input.url;
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, {
    credentials: 'same-origin',
    ...init,
  });

  if (response.status === 401) {
    const path = requestPath(input);
    if (!CREDENTIAL_ENDPOINTS.some((endpoint) => path.includes(endpoint))) {
      clearStoredUser();
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
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
