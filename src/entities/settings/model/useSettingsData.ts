import { useCallback, useState } from 'react';
import { apiJson } from '@/shared/api/base';
import type { AppCapabilities, ProviderHealth, UserSettings } from './types';

export function useSettingsData() {
  const [capabilities, setCapabilities] = useState<AppCapabilities | null>(null);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [providerHealth, setProviderHealth] = useState<ProviderHealth[]>([]);

  const fetchCapabilities = useCallback(async () => {
    setCapabilities(await apiJson<AppCapabilities>('/api/capabilities'));
  }, []);

  const fetchSettings = useCallback(async () => {
    const payload = await apiJson<{ settings: UserSettings }>('/api/settings');
    setUserSettings(payload.settings);
  }, []);

  const fetchProviderHealth = useCallback(async () => {
    setProviderHealth(await apiJson<ProviderHealth[]>('/api/provider-health'));
  }, []);

  const clearSettingsData = useCallback(() => {
    setCapabilities(null);
    setUserSettings(null);
    setProviderHealth([]);
  }, []);

  return {
    capabilities,
    userSettings,
    providerHealth,
    fetchCapabilities,
    fetchSettings,
    fetchProviderHealth,
    clearSettingsData,
  };
}
