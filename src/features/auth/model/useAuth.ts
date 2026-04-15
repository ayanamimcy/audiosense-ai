import { useEffect, useState } from 'react';
import { getCurrentUser, getPublicConfig, getStoredUser, logout } from '../api/auth-api';
import type { AuthUser, PublicConfig } from '@/entities/user';

const DEFAULT_PUBLIC_CONFIG: PublicConfig = {
  auth: {
    allowRegistration: false,
  },
};

export function useAuth() {
  const [authLoading, setAuthLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(() => getStoredUser<AuthUser>());
  const [publicConfig, setPublicConfig] = useState<PublicConfig>(DEFAULT_PUBLIC_CONFIG);

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
  }, []);

  const handleLogout = async (clearAppData?: () => void) => {
    await logout();
    setCurrentUser(null);
    clearAppData?.();
  };

  return { authLoading, currentUser, publicConfig, setCurrentUser, handleLogout };
}
