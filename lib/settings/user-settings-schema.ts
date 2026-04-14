import {
  getLocalRuntimeCatalog,
  normalizeLocalRuntimeBackendSelection,
  type LocalRuntimeCatalog,
} from '../audio-engine/local-runtime-catalog.js';
import { KNOWN_PROVIDER_IDS } from '../audio-engine/providers/catalog.js';
import config from '../config.js';

export type RetrievalMode = 'hybrid' | 'fts' | 'vector';
export type LocalDiarizationStrategy = 'auto' | 'parallel' | 'sequential';

export interface OpenAIWhisperSettings {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  transcriptionPath: string;
  translationPath: string;
  responseFormat: string;
  disableTimestampGranularities: boolean;
}

export interface LocalRuntimeSettings {
  enabled: boolean;
  baseUrl: string;
  backendId: string;
  modelName: string;
  diarizationStrategy: LocalDiarizationStrategy;
  hfToken: string;
  requestTimeoutMs: number;
}

export interface LlmSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface SubtitleSplitSettings {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  requestTimeoutMs: number;
  maxRetries: number;
}

export interface UserSettings {
  currentWorkspaceId: string;
  parseLanguage: string;
  enableDiarization: boolean;
  defaultProvider: string;
  fallbackProviders: string[];
  autoGenerateSummary: boolean;
  autoSuggestTags: boolean;
  circuitBreakerThreshold: number;
  circuitBreakerCooldownMs: number;
  retrievalMode: RetrievalMode;
  maxKnowledgeChunks: number;
  openaiWhisper: OpenAIWhisperSettings;
  localRuntime: LocalRuntimeSettings;
  llm: LlmSettings;
  subtitleSplit: SubtitleSplitSettings;
}

export interface StoredUserSettingsInput extends Partial<UserSettings> {
}

export type RuntimeUserSettings = UserSettings;
export type ClientUserSettings = Omit<UserSettings, 'subtitleSplit'>;

function readString(value: unknown, fallback: string) {
  return typeof value === 'string' ? value.trim() || fallback : fallback;
}

function readOptionalString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function readBool(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

export function getDefaultSettings(): UserSettings {
  const catalog = getLocalRuntimeCatalog();
  const localSelection = normalizeLocalRuntimeBackendSelection(
    config.localAudioEngine.backend || catalog.backends[0]?.id || 'whisperx',
    config.localAudioEngine.model || catalog.backends[0]?.defaultModel || 'small',
  );

  return {
    currentWorkspaceId: '',
    parseLanguage: 'auto',
    enableDiarization: true,
    defaultProvider: config.transcription.defaultProvider,
    fallbackProviders: [],
    autoGenerateSummary: config.transcription.autoGenerateSummary,
    autoSuggestTags: config.transcription.autoSuggestTags,
    circuitBreakerThreshold: 3,
    circuitBreakerCooldownMs: 5 * 60 * 1000,
    retrievalMode: 'hybrid',
    maxKnowledgeChunks: 8,
    openaiWhisper: {
      enabled: config.openaiWhisper.enabled,
      baseUrl: config.openaiWhisper.baseUrl,
      apiKey: config.openaiWhisper.apiKey,
      model: config.openaiWhisper.model,
      transcriptionPath: config.openaiWhisper.transcriptionPath,
      translationPath: config.openaiWhisper.translationPath,
      responseFormat: config.openaiWhisper.responseFormat,
      disableTimestampGranularities: config.openaiWhisper.disableTimestampGranularities,
    },
    localRuntime: {
      enabled: config.localAudioEngine.enabled,
      baseUrl: config.localAudioEngine.baseUrl,
      backendId: localSelection.backendId,
      modelName: localSelection.modelName,
      diarizationStrategy: config.localAudioEngine.diarizationStrategy,
      hfToken: config.localAudioEngine.hfToken,
      requestTimeoutMs: config.localAudioEngine.requestTimeoutMs,
    },
    llm: {
      baseUrl: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
      model: config.llm.model,
    },
    subtitleSplit: {
      enabled: config.subtitleSplit.enabled,
      baseUrl: config.subtitleSplit.baseUrl,
      apiKey: config.subtitleSplit.apiKey,
      model: config.subtitleSplit.model,
      requestTimeoutMs: config.subtitleSplit.requestTimeoutMs,
      maxRetries: config.subtitleSplit.maxRetries,
    },
  };
}

export function mergeUserSettings(
  base: UserSettings,
  input: StoredUserSettingsInput,
): Partial<UserSettings> {
  return {
    ...base,
    ...input,
    openaiWhisper: {
      ...base.openaiWhisper,
      ...(input.openaiWhisper || {}),
    },
    localRuntime: {
      ...base.localRuntime,
      ...(input.localRuntime || {}),
    },
    llm: {
      ...base.llm,
      ...(input.llm || {}),
    },
    subtitleSplit: {
      ...base.subtitleSplit,
      ...(input.subtitleSplit || {}),
    },
  };
}

export function sanitizeUserSettings(
  input: StoredUserSettingsInput,
  base: UserSettings = getDefaultSettings(),
): UserSettings {
  const merged = mergeUserSettings(base, input);
  const catalog = getLocalRuntimeCatalog();
  const localSelection = normalizeLocalRuntimeBackendSelection(
    merged.localRuntime?.backendId || base.localRuntime.backendId,
    merged.localRuntime?.modelName || base.localRuntime.modelName,
  );

  const defaultProvider = KNOWN_PROVIDER_IDS.includes(
    String(merged.defaultProvider || '').toLowerCase() as (typeof KNOWN_PROVIDER_IDS)[number],
  )
    ? String(merged.defaultProvider).toLowerCase()
    : base.defaultProvider;

  const fallbackProviders = Array.isArray(merged.fallbackProviders)
    ? merged.fallbackProviders
        .map((item) => String(item).toLowerCase())
        .filter(
          (item, index, array) =>
            item &&
            item !== defaultProvider &&
            array.indexOf(item) === index &&
            KNOWN_PROVIDER_IDS.includes(item as (typeof KNOWN_PROVIDER_IDS)[number]),
        )
        .slice(0, 5)
    : base.fallbackProviders;

  return {
    currentWorkspaceId: readOptionalString(merged.currentWorkspaceId),
    parseLanguage: readString(merged.parseLanguage, base.parseLanguage),
    enableDiarization: readBool(merged.enableDiarization, base.enableDiarization),
    defaultProvider,
    fallbackProviders,
    autoGenerateSummary: readBool(merged.autoGenerateSummary, base.autoGenerateSummary),
    autoSuggestTags: readBool(merged.autoSuggestTags, base.autoSuggestTags),
    circuitBreakerThreshold: clampNumber(
      merged.circuitBreakerThreshold,
      base.circuitBreakerThreshold,
      1,
      10,
    ),
    circuitBreakerCooldownMs: clampNumber(
      merged.circuitBreakerCooldownMs,
      base.circuitBreakerCooldownMs,
      10_000,
      60 * 60 * 1000,
    ),
    retrievalMode: ['hybrid', 'fts', 'vector'].includes(String(merged.retrievalMode))
      ? (merged.retrievalMode as RetrievalMode)
      : base.retrievalMode,
    maxKnowledgeChunks: clampNumber(merged.maxKnowledgeChunks, base.maxKnowledgeChunks, 3, 20),
    openaiWhisper: {
      enabled: readBool(merged.openaiWhisper?.enabled, base.openaiWhisper.enabled),
      baseUrl: readString(merged.openaiWhisper?.baseUrl, base.openaiWhisper.baseUrl).replace(/\/$/, ''),
      apiKey: readOptionalString(merged.openaiWhisper?.apiKey),
      model: readString(merged.openaiWhisper?.model, base.openaiWhisper.model),
      transcriptionPath: readString(
        merged.openaiWhisper?.transcriptionPath,
        base.openaiWhisper.transcriptionPath,
      ),
      translationPath: readString(
        merged.openaiWhisper?.translationPath,
        base.openaiWhisper.translationPath,
      ),
      responseFormat: readString(
        merged.openaiWhisper?.responseFormat,
        base.openaiWhisper.responseFormat,
      ),
      disableTimestampGranularities: readBool(
        merged.openaiWhisper?.disableTimestampGranularities,
        base.openaiWhisper.disableTimestampGranularities,
      ),
    },
    localRuntime: {
      enabled: readBool(merged.localRuntime?.enabled, base.localRuntime.enabled),
      baseUrl: readString(merged.localRuntime?.baseUrl, base.localRuntime.baseUrl).replace(/\/$/, ''),
      backendId: localSelection.backendId,
      modelName: localSelection.modelName,
      diarizationStrategy: ['auto', 'parallel', 'sequential'].includes(
        String(merged.localRuntime?.diarizationStrategy || '').trim().toLowerCase(),
      )
        ? (String(merged.localRuntime?.diarizationStrategy).trim().toLowerCase() as LocalDiarizationStrategy)
        : base.localRuntime.diarizationStrategy,
      hfToken: readOptionalString(merged.localRuntime?.hfToken),
      requestTimeoutMs: clampNumber(
        merged.localRuntime?.requestTimeoutMs,
        base.localRuntime.requestTimeoutMs,
        60_000,
        4 * 60 * 60 * 1000,
      ),
    },
    llm: {
      baseUrl: readString(merged.llm?.baseUrl, base.llm.baseUrl).replace(/\/$/, ''),
      apiKey: readOptionalString(merged.llm?.apiKey),
      model: readString(merged.llm?.model, base.llm.model),
    },
    subtitleSplit: {
      enabled: readBool(merged.subtitleSplit?.enabled, base.subtitleSplit.enabled),
      baseUrl: readString(merged.subtitleSplit?.baseUrl, base.subtitleSplit.baseUrl).replace(/\/$/, ''),
      apiKey: readOptionalString(merged.subtitleSplit?.apiKey),
      model: readString(merged.subtitleSplit?.model, base.subtitleSplit.model),
      requestTimeoutMs: clampNumber(
        merged.subtitleSplit?.requestTimeoutMs,
        base.subtitleSplit.requestTimeoutMs,
        5_000,
        5 * 60 * 1000,
      ),
      maxRetries: clampNumber(
        merged.subtitleSplit?.maxRetries,
        base.subtitleSplit.maxRetries,
        0,
        5,
      ),
    },
  };
}

export function toClientUserSettings(
  settings: UserSettings,
  storedInput?: StoredUserSettingsInput | null,
): ClientUserSettings {
  const clientSettings: ClientUserSettings = {
    currentWorkspaceId: settings.currentWorkspaceId,
    parseLanguage: settings.parseLanguage,
    enableDiarization: settings.enableDiarization,
    defaultProvider: settings.defaultProvider,
    fallbackProviders: [...settings.fallbackProviders],
    autoGenerateSummary: settings.autoGenerateSummary,
    autoSuggestTags: settings.autoSuggestTags,
    circuitBreakerThreshold: settings.circuitBreakerThreshold,
    circuitBreakerCooldownMs: settings.circuitBreakerCooldownMs,
    retrievalMode: settings.retrievalMode,
    maxKnowledgeChunks: settings.maxKnowledgeChunks,
    openaiWhisper: {
      ...settings.openaiWhisper,
      apiKey: storedInput?.openaiWhisper?.apiKey ? settings.openaiWhisper.apiKey : '',
    },
    localRuntime: {
      ...settings.localRuntime,
      hfToken: storedInput?.localRuntime?.hfToken ? settings.localRuntime.hfToken : '',
    },
    llm: {
      ...settings.llm,
      apiKey: storedInput?.llm?.apiKey ? settings.llm.apiKey : '',
    },
  };

  return clientSettings;
}

export function resolveOpenAIWhisperSettings(settings?: Partial<UserSettings>) {
  return sanitizeUserSettings(settings || {}, getDefaultSettings()).openaiWhisper;
}

export function resolveLocalRuntimeSettings(_settings?: Partial<UserSettings>) {
  return getDefaultSettings().localRuntime;
}

export function resolveLlmSettings(settings?: Partial<UserSettings>) {
  return sanitizeUserSettings(settings || {}, getDefaultSettings()).llm;
}

export function resolveSubtitleSplitSettings(settings?: Partial<UserSettings>) {
  return sanitizeUserSettings(settings || {}, getDefaultSettings()).subtitleSplit;
}

export function getLocalRuntimeCatalogSnapshot(): LocalRuntimeCatalog {
  return getLocalRuntimeCatalog();
}
