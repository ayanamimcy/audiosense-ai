import { useCallback, useEffect, useState } from 'react';
import { UNAUTHORIZED_EVENT } from '@/shared/api/base';
import { getCurrentUser, getPublicConfig, getStoredUser, logout } from '../api/auth-api';
import type { AuthUser, PublicConfig } from '@/entities/user';

const DEFAULT_PUBLIC_CONFIG: PublicConfig = {
  auth: {
    allowRegistration: false,
  },
};

export function useAuth() {
  const [authLoading, setAuthLoading] = useState(true);
  const [currentUser, setCurrentUserState] = useState<AuthUser | null>(() => getStoredUser<AuthUser>());
  const [publicConfig, setPublicConfig] = useState<PublicConfig>(DEFAULT_PUBLIC_CONFIG);
  const [sessionLost, setSessionLost] = useState(false);

  // Any change of user (sign-in, sign-out, bootstrap) settles the session question.
  const setCurrentUser = useCallback((user: AuthUser | null) => {
    setSessionLost(false);
    setCurrentUserState(user);
  }, []);

  // The server rejected the session mid-use (expired, revoked, signed out elsewhere).
  useEffect(() => {
    const handleUnauthorized = () => setSessionLost(true);
    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      const configResult = await getPublicConfig().catch((error) => {
        console.error('Failed to load public config:', error);
        return DEFAULT_PUBLIC_CONFIG;
      });
      setPublicConfig(configResult);

      try {
        const user = await getCurrentUser();
        setCurrentUser(user);
      } catch {
        setCurrentUser(null);
      } finally {
        setAuthLoading(false);
      }
    };

    void bootstrap();
  }, [setCurrentUser]);

  const handleLogout = useCallback(async (clearAppData?: () => void) => {
    await logout();
    setCurrentUser(null);
    clearAppData?.();
  }, [setCurrentUser]);

  // Only meaningful for a signed-in user once bootstrap has finished.
  const sessionExpired = sessionLost && !authLoading && currentUser !== null;

  return { authLoading, currentUser, publicConfig, setCurrentUser, handleLogout, sessionExpired };
}
