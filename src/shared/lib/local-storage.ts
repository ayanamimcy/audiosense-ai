const CURRENT_USER_KEY = 'currentUser';

export function getLocalSetting(key: string, fallback: string) {
  return localStorage.getItem(key) || fallback;
}

export function getStoredUser<T>(): T | null {
  const raw = localStorage.getItem(CURRENT_USER_KEY);
  return raw ? (JSON.parse(raw) as T) : null;
}

export function storeUser<T>(user: T) {
  localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
}

export function clearStoredUser() {
  localStorage.removeItem(CURRENT_USER_KEY);
}
