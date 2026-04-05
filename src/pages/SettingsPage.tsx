import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, LogOut, RefreshCw } from 'lucide-react';
import { apiJson } from '../api';
import { cn, getLocalSetting, LANGUAGE_OPTIONS } from '../lib/utils';
import { useAppDataContext } from '../contexts/AppDataContext';
import { useAuthContext } from '../contexts/AuthContext';
import { ApiTokensSection } from '../components/ApiTokensSection';
import type { AuthUser, UserSettings } from '../types';

export function SettingsPage({
  onLogout,
  onUserUpdated,
  onSettingsSaved,
}: {
  onLogout: () => void | Promise<void>;
  onUserUpdated: (user: AuthUser) => void;
  onSettingsSaved: () => void | Promise<void>;
}) {
  const { capabilities, userSettings, providerHealth } = useAppDataContext();
  const { currentUser } = useAuthContext();
  const [language, setLanguage] = useState('auto');
  const [enableDiarization, setEnableDiarization] = useState(true);
  const [draft, setDraft] = useState<UserSettings | null>(userSettings);
  const [isSaving, setIsSaving] = useState(false);
  const [profileName, setProfileName] = useState(currentUser.name);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [llmModels, setLlmModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  const fetchLlmModels = useCallback(async () => {
    setIsLoadingModels(true);
    try {
      const result = await apiJson<{ data: { id: string }[] }>('/api/llm/models');
      const ids = (result.data || []).map((m) => m.id).filter(Boolean).sort();
      setLlmModels(ids);
    } catch {
      setLlmModels([]);
    } finally {
      setIsLoadingModels(false);
    }
  }, []);

  useEffect(() => {
    setLanguage(getLocalSetting('parseLanguage', 'auto'));
    setEnableDiarization(getLocalSetting('enableDiarization', 'true') === 'true');
  }, []);

  useEffect(() => {
    if (!userSettings) {
      return;
    }

    setDraft(userSettings);
  }, [userSettings]);

  useEffect(() => {
    setProfileName(currentUser.name);
  }, [currentUser.name]);

  const updateDraft = (updater: (current: UserSettings) => UserSettings) => {
    setDraft((current) => (current ? updater(current) : current));
  };

  const providerOptions = capabilities?.transcription.providers || [];
  const providerHealthMap = new Map(providerHealth.map((item) => [item.provider, item]));

  const handleSave = async () => {
    if (!draft) {
      return;
    }

    localStorage.setItem('parseLanguage', language);
    localStorage.setItem('enableDiarization', String(enableDiarization));

    setIsSaving(true);
    try {
      await apiJson('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      await onSettingsSaved();
      alert('Settings saved successfully.');
    } catch (error) {
      console.error('Failed to save settings:', error);
      alert(error instanceof Error ? error.message : 'Failed to save settings.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleProfileSave = async () => {
    const trimmedName = profileName.trim();
    if (!trimmedName) {
      alert('Display name is required.');
      return;
    }

    setIsSavingProfile(true);
    try {
      const payload = await apiJson<{ user: AuthUser }>('/api/account/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName }),
      });
      onUserUpdated(payload.user);
      alert('Profile updated successfully.');
    } catch (error) {
      console.error('Failed to update profile:', error);
      alert(error instanceof Error ? error.message : 'Failed to update profile.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handlePasswordSave = async () => {
    if (!currentPassword) {
      alert('Current password is required.');
      return;
    }
    if (newPassword.length < 8) {
      alert('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      alert('New password and confirmation do not match.');
      return;
    }

    setIsSavingPassword(true);
    try {
      await apiJson('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      alert('Password updated successfully.');
    } catch (error) {
      console.error('Failed to update password:', error);
      alert(error instanceof Error ? error.message : 'Failed to update password.');
    } finally {
      setIsSavingPassword(false);
    }
  };

  if (!draft) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm max-w-3xl">
        <h2 className="text-2xl font-bold text-slate-900 mb-4">Settings</h2>
        <p className="text-slate-500">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm max-w-3xl">
      <h2 className="text-2xl font-bold text-slate-900 mb-6">Settings</h2>

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Parsing Language</label>
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            className="w-full max-w-md px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-700"
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-start gap-3 p-4 rounded-2xl border border-slate-200 bg-slate-50">
          <input
            type="checkbox"
            checked={enableDiarization}
            onChange={(event) => setEnableDiarization(event.target.checked)}
            className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <div>
            <p className="text-sm font-medium text-slate-800">Enable speaker diarization</p>
            <p className="text-sm text-slate-500 mt-1">Providers that support diarization can split transcripts by speaker and time segments.</p>
          </div>
        </label>

        <div className="rounded-2xl border border-slate-200 p-5 space-y-5">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Transcription</h3>
              <p className="text-sm text-slate-500 mt-1">Choose your transcription provider and automation preferences.</p>
            </div>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Default provider</span>
            <select
              value={draft.defaultProvider}
              onChange={(event) =>
                updateDraft((current) => ({
                  ...current,
                  defaultProvider: event.target.value,
                  fallbackProviders: current.fallbackProviders.filter((item) => item !== event.target.value),
                }))
              }
              className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {providerOptions.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                  {provider.configured ? '' : ' (Missing saved config)'}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-start gap-3 p-4 rounded-2xl border border-slate-200 bg-slate-50">
            <input
              type="checkbox"
              checked={draft.autoGenerateSummary}
              onChange={(event) =>
                updateDraft((current) => ({
                  ...current,
                  autoGenerateSummary: event.target.checked,
                }))
              }
              className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <div>
              <p className="text-sm font-medium text-slate-800">Auto generate summary after transcription</p>
              <p className="text-sm text-slate-500 mt-1">If LLM is configured, the worker will generate a summary automatically after a task completes.</p>
            </div>
          </label>

          <label className="flex items-start gap-3 p-4 rounded-2xl border border-slate-200 bg-slate-50">
            <input
              type="checkbox"
              checked={draft.autoSuggestTags}
              onChange={(event) =>
                updateDraft((current) => ({
                  ...current,
                  autoSuggestTags: event.target.checked,
                }))
              }
              className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <div>
              <p className="text-sm font-medium text-slate-800">Auto suggest tags after transcription</p>
              <p className="text-sm text-slate-500 mt-1">If LLM is configured, completed tasks will get suggested tags that you can review before applying.</p>
            </div>
          </label>

          <button
            type="button"
            onClick={() => setIsAdvancedOpen((v) => !v)}
            className="flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors"
          >
            <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', isAdvancedOpen && 'rotate-180')} />
            Advanced provider settings
          </button>

          {isAdvancedOpen && (
            <>
              <div>
                <span className="text-sm font-medium text-slate-700">Fallback chain</span>
                <div className="mt-2 space-y-2">
                  {providerOptions
                    .filter((provider) => provider.id !== draft.defaultProvider)
                    .map((provider) => {
                      const checked = draft.fallbackProviders.includes(provider.id);
                      return (
                        <label key={provider.id} className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 bg-slate-50">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => {
                              updateDraft((current) => ({
                                ...current,
                                fallbackProviders: event.target.checked
                                  ? [...current.fallbackProviders, provider.id]
                                  : current.fallbackProviders.filter((item) => item !== provider.id),
                              }));
                            }}
                            className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <div>
                            <p className="text-sm font-medium text-slate-800">{provider.label}</p>
                            <p className="text-xs text-slate-500 mt-1">{provider.description}</p>
                          </div>
                        </label>
                      );
                    })}
                </div>
              </div>

          <div className="grid md:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Circuit breaker threshold</span>
              <input
                type="number"
                min={1}
                max={10}
                value={draft.circuitBreakerThreshold}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    circuitBreakerThreshold: Number(event.target.value),
                  }))
                }
                className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">Cooldown (seconds)</span>
              <input
                type="number"
                min={10}
                max={3600}
                value={Math.round(draft.circuitBreakerCooldownMs / 1000)}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    circuitBreakerCooldownMs: Number(event.target.value) * 1000,
                  }))
                }
                className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </label>
          </div>
            </>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-slate-900">OpenAI Whisper API</h3>
            <p className="text-sm text-slate-500 mt-1">Configure a standard OpenAI-compatible Whisper transcription endpoint.</p>
          </div>

          <label className="flex items-start gap-3 p-4 rounded-2xl border border-slate-200 bg-slate-50">
            <input
              type="checkbox"
              checked={draft.openaiWhisper.enabled}
              onChange={(event) =>
                updateDraft((current) => ({
                  ...current,
                  openaiWhisper: {
                    ...current.openaiWhisper,
                    enabled: event.target.checked,
                  },
                }))
              }
              className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <div>
              <p className="text-sm font-medium text-slate-800">Enable OpenAI Whisper provider</p>
              <p className="text-sm text-slate-500 mt-1">After saving, this provider can be used as the default provider or a fallback provider.</p>
            </div>
          </label>

          {draft.openaiWhisper.enabled && (
            <>
              <div className="grid md:grid-cols-2 gap-4">
                <label className="block md:col-span-2">
                  <span className="text-sm font-medium text-slate-700">API base URL</span>
                  <input
                    type="url"
                    value={draft.openaiWhisper.baseUrl}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        openaiWhisper: {
                          ...current.openaiWhisper,
                          baseUrl: event.target.value,
                        },
                      }))
                    }
                    className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="https://api.openai.com/v1"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Model</span>
                  <input
                    type="text"
                    value={draft.openaiWhisper.model}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        openaiWhisper: {
                          ...current.openaiWhisper,
                          model: event.target.value,
                        },
                      }))
                    }
                    className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="whisper-1"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">API key</span>
                  <input
                    type="password"
                    value={draft.openaiWhisper.apiKey}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        openaiWhisper: {
                          ...current.openaiWhisper,
                          apiKey: event.target.value,
                        },
                      }))
                    }
                    className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="sk-..."
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Transcription path</span>
                  <input
                    type="text"
                    value={draft.openaiWhisper.transcriptionPath}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        openaiWhisper: {
                          ...current.openaiWhisper,
                          transcriptionPath: event.target.value,
                        },
                      }))
                    }
                    className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Translation path</span>
                  <input
                    type="text"
                    value={draft.openaiWhisper.translationPath}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        openaiWhisper: {
                          ...current.openaiWhisper,
                          translationPath: event.target.value,
                        },
                      }))
                    }
                    className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Response format</span>
                  <select
                    value={draft.openaiWhisper.responseFormat}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        openaiWhisper: {
                          ...current.openaiWhisper,
                          responseFormat: event.target.value,
                        },
                      }))
                    }
                    className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="verbose_json">verbose_json</option>
                    <option value="json">json</option>
                    <option value="text">text</option>
                  </select>
                </label>
              </div>

              <label className="flex items-start gap-3 p-4 rounded-2xl border border-slate-200 bg-slate-50">
                <input
                  type="checkbox"
                  checked={draft.openaiWhisper.disableTimestampGranularities}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      openaiWhisper: {
                        ...current.openaiWhisper,
                        disableTimestampGranularities: event.target.checked,
                      },
                    }))
                  }
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <p className="text-sm font-medium text-slate-800">Disable timestamp granularities</p>
                  <p className="text-sm text-slate-500 mt-1">Turn this on if your endpoint does not support `timestamp_granularities[]`.</p>
                </div>
              </label>
            </>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-slate-900">LLM API</h3>
            <p className="text-sm text-slate-500 mt-1">Used for summary generation and transcript chat.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <label className="block md:col-span-2">
              <span className="text-sm font-medium text-slate-700">Base URL</span>
              <input
                type="url"
                value={draft.llm.baseUrl}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    llm: {
                      ...current.llm,
                      baseUrl: event.target.value,
                    },
                  }))
                }
                className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="https://api.openai.com/v1"
              />
            </label>
            <div className="block md:col-span-2">
              <span className="text-sm font-medium text-slate-700">Model</span>
              <div className="flex items-center gap-2 mt-1">
                {llmModels.length > 0 ? (
                  <select
                    value={draft.llm.model}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        llm: {
                          ...current.llm,
                          model: event.target.value,
                        },
                      }))
                    }
                    className="min-w-0 flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {!llmModels.includes(draft.llm.model) && draft.llm.model && (
                      <option value={draft.llm.model}>{draft.llm.model}</option>
                    )}
                    {llmModels.map((id) => (
                      <option key={id} value={id}>{id}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={draft.llm.model}
                    onChange={(event) =>
                      updateDraft((current) => ({
                        ...current,
                        llm: {
                          ...current.llm,
                          model: event.target.value,
                        },
                      }))
                    }
                    className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="gpt-4o-mini"
                  />
                )}
                <button
                  type="button"
                  onClick={() => void fetchLlmModels()}
                  disabled={isLoadingModels}
                  className="inline-flex items-center justify-center w-9 h-9 rounded-xl border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50"
                  title="Fetch available models"
                >
                  <RefreshCw className={cn('w-4 h-4', isLoadingModels && 'animate-spin')} />
                </button>
              </div>
            </div>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">API key</span>
              <input
                type="password"
                value={draft.llm.apiKey}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    llm: {
                      ...current.llm,
                      apiKey: event.target.value,
                    },
                  }))
                }
                className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="sk-..."
              />
            </label>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Retrieval Settings</h3>
            <p className="text-sm text-slate-500 mt-1">Tune how global search and cross-recording Q&A rank transcript chunks.</p>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Retrieval mode</span>
            <select
              value={draft.retrievalMode}
              onChange={(event) =>
                updateDraft((current) => ({
                  ...current,
                  retrievalMode: event.target.value as UserSettings['retrievalMode'],
                }))
              }
              className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="hybrid">Hybrid (FTS + vector)</option>
              <option value="fts">Full-text only</option>
              <option value="vector">Vector only</option>
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Max knowledge chunks</span>
            <input
              type="number"
              min={3}
              max={20}
              value={draft.maxKnowledgeChunks}
              onChange={(event) =>
                updateDraft((current) => ({
                  ...current,
                  maxKnowledgeChunks: Number(event.target.value),
                }))
              }
              className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </label>
        </div>

        <div className="rounded-2xl border border-slate-200 p-5">
          <h3 className="text-base font-semibold text-slate-900">System Status</h3>
          <div className="mt-3 flex flex-wrap gap-3 text-xs">
            <span className={cn('px-2.5 py-1 rounded-full border', capabilities?.llm.configured ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200')}>
              LLM: {capabilities?.llm.configured ? capabilities.llm.model : 'Not configured'}
            </span>
            <span className={cn('px-2.5 py-1 rounded-full border', capabilities?.embeddings.configured ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200')}>
              Embeddings: {capabilities?.embeddings.configured ? capabilities.embeddings.model : 'Off'}
            </span>
          </div>
          <div className="mt-4 space-y-2">
            {providerOptions.map((provider) => (
              <div key={provider.id} className="rounded-xl border border-slate-200 p-4 flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-900">{provider.label}</p>
                  <p className="text-xs text-slate-500 mt-1">{provider.description}</p>
                  {providerHealthMap.get(provider.id)?.lastError && (
                    <p className="text-xs text-red-600 mt-2">
                      {providerHealthMap.get(provider.id)?.lastError}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={cn('text-xs font-medium px-2.5 py-1 rounded-full border', provider.configured ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200')}>
                    {provider.configured ? 'Configured' : 'Missing config'}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    failures {providerHealthMap.get(provider.id)?.failureCount || 0}
                    {' • '}
                    success {providerHealthMap.get(provider.id)?.successCount || 0}
                  </span>
                  <button
                    onClick={async () => {
                      await apiJson(`/api/provider-health/${provider.id}/reset`, { method: 'POST' });
                      await onSettingsSaved();
                    }}
                    className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                  >
                    Reset Circuit
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100">
          <button
            onClick={() => void handleSave()}
            disabled={isSaving}
            className="px-6 py-2.5 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-60"
          >
            {isSaving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>

        <div className="pt-8 mt-8 border-t border-slate-100">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Account</h3>
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-xl">
              {currentUser.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="font-medium text-slate-900">{currentUser.name}</p>
              <p className="text-sm text-slate-500">{currentUser.email}</p>
            </div>
          </div>

          <div className="grid gap-6 mb-6">
            <div className="rounded-2xl border border-slate-200 p-5 space-y-4">
              <div>
                <h4 className="text-base font-semibold text-slate-900">Profile</h4>
                <p className="text-sm text-slate-500 mt-1">Update the display name shown across your workspace.</p>
              </div>

              <label className="block">
                <span className="text-sm font-medium text-slate-700">Display name</span>
                <input
                  type="text"
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                  className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Your name"
                />
              </label>

              <button
                onClick={() => void handleProfileSave()}
                disabled={isSavingProfile}
                className="px-5 py-2.5 bg-slate-900 text-white font-medium rounded-xl hover:bg-slate-800 transition-colors disabled:opacity-60"
              >
                {isSavingProfile ? 'Saving profile...' : 'Save Profile'}
              </button>
            </div>

            <div className="rounded-2xl border border-slate-200 p-5 space-y-4">
              <div>
                <h4 className="text-base font-semibold text-slate-900">Password</h4>
                <p className="text-sm text-slate-500 mt-1">Use your current password to set a new one.</p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="block md:col-span-2">
                  <span className="text-sm font-medium text-slate-700">Current password</span>
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(event) => setCurrentPassword(event.target.value)}
                    className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Current password"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">New password</span>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="At least 8 characters"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-700">Confirm new password</span>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className="w-full mt-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Repeat new password"
                  />
                </label>
              </div>

              <button
                onClick={() => void handlePasswordSave()}
                disabled={isSavingPassword}
                className="px-5 py-2.5 bg-slate-900 text-white font-medium rounded-xl hover:bg-slate-800 transition-colors disabled:opacity-60"
              >
                {isSavingPassword ? 'Updating password...' : 'Update Password'}
              </button>
            </div>
          </div>

          <ApiTokensSection />

          <button
            onClick={() => void onLogout()}
            className="w-full sm:w-auto px-6 py-2.5 bg-red-50 text-red-600 font-medium rounded-xl hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
