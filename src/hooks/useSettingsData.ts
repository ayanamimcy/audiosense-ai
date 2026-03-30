import { useState } from 'react';
import { apiJson } from '../api';
import type { AppCapabilities, ProviderHealth, UserSettings } from '../types';

export function useSettingsData() {
  const [capabilities, setCapabilities] = useState<AppCapabilities | null>(null);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [providerHealth, setProviderHealth] = useState<ProviderHealth[]>([]);

  const fetchCapabilities = async () => {
    setCapabilities(await apiJson<AppCapabilities>('/api/capabilities'));
  };

  const fetchSettings = async () => {
    const payload = await apiJson<{ settings: UserSettings }>('/api/settings');
    setUserSettings(payload.settings);
  };

  const fetchProviderHealth = async () => {
    setProviderHealth(await apiJson<ProviderHealth[]>('/api/provider-health'));
  };

  const clearSettingsData = () => {
    setCapabilities(null);
    setUserSettings(null);
    setProviderHealth([]);
  };

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
