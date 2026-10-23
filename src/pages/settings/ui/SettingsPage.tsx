import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, LogOut, RefreshCw } from 'lucide-react';
import { apiJson } from '@/shared/api/base';
import { cn } from '@/shared/lib/cn';
import { LANGUAGE_OPTIONS } from '@/shared/lib/constants';
import {
  Field,
  SectionHeading,
  SubHeading,
  ToggleRow,
  inputClassName,
  primaryButtonClassName,
  secondaryButtonClassName,
} from '@/shared/ui/form';
import { useAppDataContext } from '@/app/providers/app-data-context';
import type { UserSettings } from '@/entities/settings';
import type { AuthUser } from '@/entities/user';
import { ApiTokensSection } from '@/features/api-tokens';
import { useAuthContext } from '@/features/auth';
import { SummaryTemplates } from '@/features/summary-templates';

type SectionId =
  | 'transcription'
  | 'ai'
  | 'templates'
  | 'search'
  | 'workspaces'
  | 'account'
  | 'tokens'
  | 'status';

const SECTION_GROUPS: { label: string; items: { id: SectionId; label: string }[] }[] = [
  {
    label: 'Processing',
    items: [
      { id: 'transcription', label: 'Transcription' },
      { id: 'ai', label: 'AI model' },
      { id: 'templates', label: 'Summary templates' },
      { id: 'search', label: 'Search' },
    ],
  },
  { label: 'Organization', items: [{ id: 'workspaces', label: 'Workspaces' }] },
  {
    label: 'Account',
    items: [
      { id: 'account', label: 'Profile & password' },
      { id: 'tokens', label: 'API tokens' },
      { id: 'status', label: 'System status' },
    ],
  },
];

const ALL_SECTIONS = SECTION_GROUPS.flatMap((group) => group.items);
/** Sections whose fields belong to the shared settings draft and the Save bar. */
const DRAFT_SECTIONS = new Set<SectionId>(['transcription', 'ai', 'search']);

function isSectionId(value: string | null): value is SectionId {
  return ALL_SECTIONS.some((item) => item.id === value);
}

export function SettingsPage({
  onLogout,
  onUserUpdated,
  onSettingsSaved,
}: {
  onLogout: () => void | Promise<void>;
  onUserUpdated: (user: AuthUser) => void;
  onSettingsSaved: () => void | Promise<void>;
}) {
  const {
    capabilities,
    userSettings,
    providerHealth,
    workspaces,
    currentWorkspaceId,
    selectWorkspace,
    refreshAll,
  } = useAppDataContext();
  const { currentUser } = useAuthContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const sectionParam = searchParams.get('section');
  const section: SectionId = isSectionId(sectionParam) ? sectionParam : 'transcription';

  const [draft, setDraft] = useState<UserSettings | null>(userSettings);
  const [isSaving, setIsSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [profileName, setProfileName] = useState(currentUser.name);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [llmModels, setLlmModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);

  useEffect(() => {
    if (userSettings) setDraft(userSettings);
  }, [userSettings]);

  useEffect(() => {
    setProfileName(currentUser.name);
  }, [currentUser.name]);

  const isDirty = useMemo(
    () => Boolean(draft && userSettings && JSON.stringify(draft) !== JSON.stringify(userSettings)),
    [draft, userSettings],
  );

  const goToSection = (id: SectionId) => {
    setSearchParams(id === 'transcription' ? {} : { section: id }, { replace: true });
  };

  const updateDraft = (updater: (current: UserSettings) => UserSettings) => {
    setDraft((current) => (current ? updater(current) : current));
  };

  const providerOptions = capabilities?.transcription.providers || [];
  const providerHealthMap = new Map(providerHealth.map((item) => [item.provider, item]));

  const fetchLlmModels = useCallback(async () => {
    setIsLoadingModels(true);
    try {
      const result = await apiJson<{ data: { id: string }[] }>('/api/llm/models');
      setLlmModels((result.data || []).map((model) => model.id).filter(Boolean).sort());
    } catch {
      setLlmModels([]);
    } finally {
      setIsLoadingModels(false);
    }
  }, []);

  const handleSave = async () => {
    if (!draft) return;
    setIsSaving(true);
    try {
      await apiJson('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      await onSettingsSaved();
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 2500);
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
      alert('Profile updated.');
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
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      alert('Password updated.');
    } catch (error) {
      console.error('Failed to update password:', error);
      alert(error instanceof Error ? error.message : 'Failed to update password.');
    } finally {
      setIsSavingPassword(false);
    }
  };

  const runWorkspaceAction = async (action: () => Promise<unknown>, fallbackMessage: string) => {
    setIsSavingWorkspace(true);
    try {
      await action();
      await refreshAll();
    } catch (error) {
      alert(error instanceof Error ? error.message : fallbackMessage);
    } finally {
      setIsSavingWorkspace(false);
    }
  };

  const handleCreateWorkspace = () => {
    const name = newWorkspaceName.trim();
    if (!name) {
      alert('Workspace name is required.');
      return;
    }
    void runWorkspaceAction(async () => {
      await apiJson('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      setNewWorkspaceName('');
    }, 'Failed to create workspace.');
  };

  const handleRenameWorkspace = (workspaceId: string, currentName: string) => {
    const nextName = window.prompt('Rename workspace', currentName)?.trim();
    if (!nextName || nextName === currentName) return;
    void runWorkspaceAction(() => apiJson(`/api/workspaces/${workspaceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nextName }),
    }), 'Failed to rename workspace.');
  };

  const handleDeleteWorkspace = (workspaceId: string, workspaceName: string) => {
    if (!window.confirm(`Delete workspace "${workspaceName}"? It must be empty.`)) return;
    void runWorkspaceAction(
      () => apiJson(`/api/workspaces/${workspaceId}`, { method: 'DELETE' }),
      'Failed to delete workspace.',
    );
  };

  const handleSwitchWorkspace = async (workspaceId: string) => {
    setIsSavingWorkspace(true);
    try {
      await selectWorkspace(workspaceId);
      await onSettingsSaved();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to switch workspace.');
    } finally {
      setIsSavingWorkspace(false);
    }
  };

  const renderTranscription = (current: UserSettings) => (
    <>
      <SectionHeading
        title="Transcription"
        description="Defaults for every new recording. You can still change them per recording."
      />

      <SubHeading>Default provider</SubHeading>
      <div role="radiogroup" aria-label="Default provider" className="divide-y divide-stone-200 rounded-xl border border-stone-200">
        {providerOptions.map((provider) => {
          const health = providerHealthMap.get(provider.id);
          return (
            <label key={provider.id} className="flex cursor-pointer items-center gap-3 px-4 py-3.5">
              <input
                type="radio"
                name="default-provider"
                checked={current.defaultProvider === provider.id}
                onChange={() => updateDraft((value) => ({
                  ...value,
                  defaultProvider: provider.id,
                  fallbackProviders: value.fallbackProviders.filter((item) => item !== provider.id),
                }))}
                className="h-4 w-4 accent-stone-900"
              />
              <span className="min-w-0 flex-1">
                <span className={cn('block text-sm font-medium', provider.configured ? 'text-stone-900' : 'text-stone-500')}>
                  {provider.label}
                </span>
                <span className="block truncate text-[13px] text-stone-600">{provider.description}</span>
              </span>
              {!provider.configured ? (
                <span className="text-xs text-stone-500">Not set up</span>
              ) : health?.lastError ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-red-800">
                  <span className="h-2 w-2 rounded-full bg-red-600" />
                  Errors
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs text-emerald-800">
                  <span className="h-2 w-2 rounded-full bg-emerald-600" />
                  Ready
                </span>
              )}
            </label>
          );
        })}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Field label="Language">
          <select
            value={current.parseLanguage}
            onChange={(event) => updateDraft((value) => ({ ...value, parseLanguage: event.target.value }))}
            className={inputClassName}
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </Field>
      </div>

      <SubHeading>After transcription</SubHeading>
      <div>
        <ToggleRow
          label="Identify speakers"
          description="Label who said what, when the provider supports it."
          checked={current.enableDiarization}
          onChange={(checked) => updateDraft((value) => ({ ...value, enableDiarization: checked }))}
        />
        <ToggleRow
          label="Write a summary"
          description="Uses your default summary template. Needs an AI model."
          checked={current.autoGenerateSummary}
          onChange={(checked) => updateDraft((value) => ({ ...value, autoGenerateSummary: checked }))}
        />
        <ToggleRow
          label="Suggest tags"
          description="You confirm suggestions before they are applied. Needs an AI model."
          checked={current.autoSuggestTags}
          onChange={(checked) => updateDraft((value) => ({ ...value, autoSuggestTags: checked }))}
        />
      </div>

      <SubHeading>OpenAI-compatible Whisper API</SubHeading>
      <div className="rounded-xl border border-stone-200 px-4">
        <ToggleRow
          label="Enable this provider"
          description="Once saved it can be the default or a fallback provider."
          checked={current.openaiWhisper.enabled}
          onChange={(checked) => updateDraft((value) => ({ ...value, openaiWhisper: { ...value.openaiWhisper, enabled: checked } }))}
        />
        {current.openaiWhisper.enabled ? (
          <div className="grid gap-4 py-4 sm:grid-cols-2">
            <Field label="API base URL" className="sm:col-span-2">
              <input
                type="url"
                value={current.openaiWhisper.baseUrl}
                onChange={(event) => updateDraft((value) => ({ ...value, openaiWhisper: { ...value.openaiWhisper, baseUrl: event.target.value } }))}
                placeholder="https://api.openai.com/v1"
                className={inputClassName}
              />
            </Field>
            <Field label="Model">
              <input
                type="text"
                value={current.openaiWhisper.model}
                onChange={(event) => updateDraft((value) => ({ ...value, openaiWhisper: { ...value.openaiWhisper, model: event.target.value } }))}
                placeholder="whisper-1"
                className={inputClassName}
              />
            </Field>
            <Field label="API key">
              <input
                type="password"
                value={current.openaiWhisper.apiKey}
                onChange={(event) => updateDraft((value) => ({ ...value, openaiWhisper: { ...value.openaiWhisper, apiKey: event.target.value } }))}
                placeholder="sk-…"
                className={inputClassName}
              />
            </Field>
            <Field label="Transcription path">
              <input
                type="text"
                value={current.openaiWhisper.transcriptionPath}
                onChange={(event) => updateDraft((value) => ({ ...value, openaiWhisper: { ...value.openaiWhisper, transcriptionPath: event.target.value } }))}
                className={inputClassName}
              />
            </Field>
            <Field label="Translation path">
              <input
                type="text"
                value={current.openaiWhisper.translationPath}
                onChange={(event) => updateDraft((value) => ({ ...value, openaiWhisper: { ...value.openaiWhisper, translationPath: event.target.value } }))}
                className={inputClassName}
              />
            </Field>
            <Field label="Response format">
              <select
                value={current.openaiWhisper.responseFormat}
                onChange={(event) => updateDraft((value) => ({ ...value, openaiWhisper: { ...value.openaiWhisper, responseFormat: event.target.value } }))}
                className={inputClassName}
              >
                <option value="verbose_json">verbose_json</option>
                <option value="json">json</option>
                <option value="text">text</option>
              </select>
            </Field>
            <div className="sm:col-span-2">
              <ToggleRow
                label="Disable timestamp granularities"
                description="Turn on if your endpoint rejects timestamp_granularities[]."
                checked={current.openaiWhisper.disableTimestampGranularities}
                onChange={(checked) => updateDraft((value) => ({
                  ...value,
                  openaiWhisper: { ...value.openaiWhisper, disableTimestampGranularities: checked },
                }))}
              />
            </div>
          </div>
        ) : null}
      </div>

      <details className="group mt-8 rounded-xl border border-stone-200 px-4 py-3.5">
        <summary className="cursor-pointer text-sm font-medium text-stone-900">Advanced: fallback and retries</summary>
        <div className="mt-4 flex flex-col gap-5">
          <fieldset>
            <legend className="text-sm font-medium text-stone-800">Fallback providers</legend>
            <p className="mt-0.5 text-xs text-stone-500">Tried in order when the default provider fails.</p>
            <div className="mt-2 flex flex-col gap-2">
              {providerOptions.filter((provider) => provider.id !== current.defaultProvider).map((provider) => (
                <label key={provider.id} className="flex cursor-pointer items-center gap-3 text-sm text-stone-800">
                  <input
                    type="checkbox"
                    checked={current.fallbackProviders.includes(provider.id)}
                    onChange={(event) => updateDraft((value) => ({
                      ...value,
                      fallbackProviders: event.target.checked
                        ? [...value.fallbackProviders, provider.id]
                        : value.fallbackProviders.filter((item) => item !== provider.id),
                    }))}
                    className="h-4 w-4 accent-stone-900"
                  />
                  {provider.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Circuit breaker threshold" hint="Failures before a provider is paused.">
              <input
                type="number"
                min={1}
                max={10}
                value={current.circuitBreakerThreshold}
                onChange={(event) => updateDraft((value) => ({ ...value, circuitBreakerThreshold: Number(event.target.value) }))}
                className={inputClassName}
              />
            </Field>
            <Field label="Cooldown (seconds)" hint="How long a paused provider rests.">
              <input
                type="number"
                min={10}
                max={3600}
                value={Math.round(current.circuitBreakerCooldownMs / 1000)}
                onChange={(event) => updateDraft((value) => ({ ...value, circuitBreakerCooldownMs: Number(event.target.value) * 1000 }))}
                className={inputClassName}
              />
            </Field>
          </div>
        </div>
      </details>
    </>
  );

  const renderAiModel = (current: UserSettings) => (
    <>
      <SectionHeading title="AI model" description="Used for summaries, tag suggestions and chat." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Base URL" className="sm:col-span-2">
          <input
            type="url"
            value={current.llm.baseUrl}
            onChange={(event) => updateDraft((value) => ({ ...value, llm: { ...value.llm, baseUrl: event.target.value } }))}
            placeholder="https://api.openai.com/v1"
            className={inputClassName}
          />
        </Field>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor="llm-model" className="text-sm font-medium text-stone-800">Model</label>
          <div className="flex items-center gap-2">
            {llmModels.length > 0 ? (
              <select
                id="llm-model"
                value={current.llm.model}
                onChange={(event) => updateDraft((value) => ({ ...value, llm: { ...value.llm, model: event.target.value } }))}
                className={inputClassName}
              >
                {!llmModels.includes(current.llm.model) && current.llm.model ? (
                  <option value={current.llm.model}>{current.llm.model}</option>
                ) : null}
                {llmModels.map((model) => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
            ) : (
              <input
                id="llm-model"
                type="text"
                value={current.llm.model}
                onChange={(event) => updateDraft((value) => ({ ...value, llm: { ...value.llm, model: event.target.value } }))}
                placeholder="gpt-4o-mini"
                className={inputClassName}
              />
            )}
            <button
              type="button"
              onClick={() => void fetchLlmModels()}
              disabled={isLoadingModels}
              aria-label="Load available models"
              title="Load available models"
              className={cn(secondaryButtonClassName, 'h-10 w-10 shrink-0 px-0')}
            >
              <RefreshCw className={cn('h-4 w-4', isLoadingModels && 'animate-spin')} />
            </button>
          </div>
        </div>
        <Field label="API key">
          <input
            type="password"
            value={current.llm.apiKey}
            onChange={(event) => updateDraft((value) => ({ ...value, llm: { ...value.llm, apiKey: event.target.value } }))}
            placeholder="sk-…"
            className={inputClassName}
          />
        </Field>
      </div>
    </>
  );

  const renderSearch = (current: UserSettings) => (
    <>
      <SectionHeading title="Search" description="How search and Ask AI rank transcript passages." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Retrieval mode">
          <select
            value={current.retrievalMode}
            onChange={(event) => updateDraft((value) => ({ ...value, retrievalMode: event.target.value as UserSettings['retrievalMode'] }))}
            className={inputClassName}
          >
            <option value="hybrid">Hybrid (full-text + vector)</option>
            <option value="fts">Full-text only</option>
            <option value="vector">Vector only</option>
          </select>
        </Field>
        <Field label="Passages per answer" hint="Between 3 and 20.">
          <input
            type="number"
            min={3}
            max={20}
            value={current.maxKnowledgeChunks}
            onChange={(event) => updateDraft((value) => ({ ...value, maxKnowledgeChunks: Number(event.target.value) }))}
            className={inputClassName}
          />
        </Field>
      </div>
    </>
  );

  const renderWorkspaces = () => (
    <>
      <SectionHeading
        title="Workspaces"
        description="Recordings, notebooks and conversations stay inside their workspace."
      />
      <div className="divide-y divide-stone-200 rounded-xl border border-stone-200">
        {workspaces.map((workspace) => {
          const isCurrent = workspace.id === currentWorkspaceId;
          return (
            <div key={workspace.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-stone-900 text-[13px] font-semibold text-white">
                {workspace.name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-stone-900">{workspace.name}</span>
                <span className="block text-xs text-stone-500">{isCurrent ? 'Current workspace' : workspace.description || ''}</span>
              </span>
              <div className="flex gap-1.5">
                {!isCurrent ? (
                  <button
                    type="button"
                    onClick={() => void handleSwitchWorkspace(workspace.id)}
                    disabled={isSavingWorkspace}
                    className={secondaryButtonClassName}
                  >
                    Switch
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => handleRenameWorkspace(workspace.id, workspace.name)}
                  disabled={isSavingWorkspace}
                  className={secondaryButtonClassName}
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteWorkspace(workspace.id, workspace.name)}
                  disabled={isSavingWorkspace || workspaces.length <= 1}
                  className={cn(secondaryButtonClassName, 'text-red-700')}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex gap-2">
        <label className="sr-only" htmlFor="new-workspace">New workspace name</label>
        <input
          id="new-workspace"
          type="text"
          value={newWorkspaceName}
          onChange={(event) => setNewWorkspaceName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleCreateWorkspace();
          }}
          placeholder="New workspace name"
          className={inputClassName}
        />
        <button type="button" onClick={handleCreateWorkspace} disabled={isSavingWorkspace} className={cn(primaryButtonClassName, 'h-10 shrink-0')}>
          Add
        </button>
      </div>
    </>
  );

  const renderAccount = () => (
    <>
      <SectionHeading title="Profile & password" description={currentUser.email} />
      <SubHeading>Display name</SubHeading>
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="profile-name">Display name</label>
        <input
          id="profile-name"
          type="text"
          value={profileName}
          onChange={(event) => setProfileName(event.target.value)}
          placeholder="Your name"
          className={inputClassName}
        />
        <button
          type="button"
          onClick={() => void handleProfileSave()}
          disabled={isSavingProfile || profileName.trim() === currentUser.name}
          className={cn(primaryButtonClassName, 'h-10 shrink-0')}
        >
          {isSavingProfile ? 'Saving…' : 'Save'}
        </button>
      </div>

      <SubHeading>Change password</SubHeading>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Current password" className="sm:col-span-2">
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            className={inputClassName}
          />
        </Field>
        <Field label="New password" hint="At least 8 characters.">
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            className={inputClassName}
          />
        </Field>
        <Field label="Confirm new password">
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            className={inputClassName}
          />
        </Field>
      </div>
      <button
        type="button"
        onClick={() => void handlePasswordSave()}
        disabled={isSavingPassword}
        className={cn(primaryButtonClassName, 'mt-4')}
      >
        {isSavingPassword ? 'Updating…' : 'Update password'}
      </button>
    </>
  );

  const renderStatus = () => (
    <>
      <SectionHeading title="System status" description="Health of the services this workspace depends on." />
      <div className="divide-y divide-stone-200 rounded-xl border border-stone-200">
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="flex-1 text-sm font-medium text-stone-900">AI model</span>
          <span className="text-sm text-stone-600">{capabilities?.llm.configured ? capabilities.llm.model : 'Not configured'}</span>
        </div>
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="flex-1 text-sm font-medium text-stone-900">Embeddings</span>
          <span className="text-sm text-stone-600">{capabilities?.embeddings.configured ? capabilities.embeddings.model : 'Off'}</span>
        </div>
      </div>

      <SubHeading>Transcription providers</SubHeading>
      <div className="divide-y divide-stone-200 rounded-xl border border-stone-200">
        {providerOptions.map((provider) => {
          const health = providerHealthMap.get(provider.id);
          return (
            <div key={provider.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-stone-900">{provider.label}</span>
                <span className="block text-xs text-stone-500">
                  {provider.configured ? 'Configured' : 'Not set up'} · {health?.successCount || 0} succeeded · {health?.failureCount || 0} failed
                </span>
                {health?.lastError ? <span className="mt-1 block text-xs text-red-800">{health.lastError}</span> : null}
              </span>
              <button
                type="button"
                onClick={async () => {
                  await apiJson(`/api/provider-health/${provider.id}/reset`, { method: 'POST' });
                  await onSettingsSaved();
                }}
                className={secondaryButtonClassName}
              >
                Reset circuit
              </button>
            </div>
          );
        })}
      </div>
    </>
  );

  const renderSection = () => {
    if (DRAFT_SECTIONS.has(section) && !draft) {
      return <p className="text-sm text-stone-600">Loading settings…</p>;
    }
    switch (section) {
      case 'transcription':
        return renderTranscription(draft!);
      case 'ai':
        return renderAiModel(draft!);
      case 'search':
        return renderSearch(draft!);
      case 'templates':
        return (
          <>
            <SectionHeading
              title="Summary templates"
              description="Reusable instructions for summaries. Pick one per recording, or set a default."
            />
            <SummaryTemplates />
          </>
        );
      case 'workspaces':
        return renderWorkspaces();
      case 'account':
        return renderAccount();
      case 'tokens':
        return (
          <>
            <SectionHeading title="API tokens" description="For external access, like iOS Shortcuts." />
            <ApiTokensSection />
          </>
        );
      case 'status':
        return renderStatus();
      default:
        return null;
    }
  };

  const showSaveBar = DRAFT_SECTIONS.has(section) && (isDirty || justSaved);

  return (
    <div className="flex min-h-full flex-col lg:h-full lg:flex-row">
      <nav
        aria-label="Settings sections"
        className="shrink-0 lg:flex lg:w-56 lg:flex-col lg:overflow-y-auto lg:border-r lg:border-stone-200 lg:px-3 lg:py-5"
      >
        <h1 className="hidden px-2.5 pb-3 text-lg font-semibold text-stone-900 lg:block">Settings</h1>
        {/* Mobile: one scrollable row of sections */}
        <div className="flex gap-1.5 overflow-x-auto px-4 py-2 lg:hidden">
          {ALL_SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => goToSection(item.id)}
              aria-current={section === item.id ? 'page' : undefined}
              className={cn(
                'h-8 shrink-0 rounded-full border px-3 text-[13px] font-medium',
                section === item.id ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-200 bg-white text-stone-700',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="hidden flex-col lg:flex">
          {SECTION_GROUPS.map((group) => (
            <div key={group.label} className="mb-3 flex flex-col gap-0.5">
              <span className="px-2.5 pt-2 pb-1 text-xs font-semibold text-stone-500">{group.label}</span>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => goToSection(item.id)}
                  aria-current={section === item.id ? 'page' : undefined}
                  className={cn(
                    'flex min-h-9 items-center rounded-lg px-2.5 text-left text-sm',
                    section === item.id
                      ? 'bg-white font-medium text-stone-900 shadow-[0_0_0_1px_var(--color-stone-200)]'
                      : 'text-stone-700 hover:bg-stone-200/50',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void onLogout()}
          className="mt-auto hidden min-h-9 items-center gap-2 rounded-lg px-2.5 text-left text-sm text-red-700 hover:bg-red-50 lg:flex"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
        <div className="min-h-0 flex-1 lg:overflow-y-auto custom-scrollbar">
          <div className="max-w-2xl px-5 py-6 lg:px-10 lg:py-8">
            {renderSection()}
            {section === 'account' ? (
              <button
                type="button"
                onClick={() => void onLogout()}
                className={cn(secondaryButtonClassName, 'mt-10 text-red-700 lg:hidden')}
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            ) : null}
          </div>
        </div>

        {showSaveBar ? (
          <div className="sticky bottom-0 flex shrink-0 items-center gap-2 border-t border-stone-200 bg-stone-50 px-5 py-3 lg:px-10">
            {justSaved && !isDirty ? (
              <span className="inline-flex flex-1 items-center gap-1.5 text-sm font-medium text-emerald-800">
                <Check className="h-4 w-4" />
                Settings saved
              </span>
            ) : (
              <>
                <span className="flex-1 text-sm text-stone-600">You have unsaved changes</span>
                <button
                  type="button"
                  onClick={() => setDraft(userSettings)}
                  disabled={isSaving}
                  className="h-9 rounded-lg px-3.5 text-sm font-medium text-stone-800 hover:bg-stone-200/60"
                >
                  Discard
                </button>
                <button type="button" onClick={() => void handleSave()} disabled={isSaving} className={primaryButtonClassName}>
                  {isSaving ? 'Saving…' : 'Save'}
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
