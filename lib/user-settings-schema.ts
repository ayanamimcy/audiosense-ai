import {
  getLocalRuntimeCatalog,
  normalizeLocalRuntimeBackendSelection,
  type LocalRuntimeCatalog,
} from './audio-engine/local-runtime-catalog.js';
import { KNOWN_PROVIDER_IDS } from './audio-engine/providers/catalog.js';

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

export interface LegacySubtitleSplitSettingsInput extends Partial<LlmSettings> {}

export interface StoredUserSettingsInput extends Partial<UserSettings> {
  subtitleLlm?: LegacySubtitleSplitSettingsInput;
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

function getDefaultLocalRuntimeBaseUrl() {
  const configured = process.env.LOCAL_AUDIO_ENGINE_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, '');
  }

  const host = process.env.LOCAL_AUDIO_ENGINE_HOST || '127.0.0.1';
  const port = Number(process.env.LOCAL_AUDIO_ENGINE_PORT || 8765);
  return `http://${host}:${port}`;
}

export function getDefaultSettings(): UserSettings {
  const catalog = getLocalRuntimeCatalog();
  const localSelection = normalizeLocalRuntimeBackendSelection(
    process.env.LOCAL_AUDIO_ENGINE_BACKEND || catalog.backends[0]?.id || 'whisperx',
    process.env.LOCAL_AUDIO_ENGINE_MODEL || catalog.backends[0]?.defaultModel || 'small',
  );

  return {
    currentWorkspaceId: '',
    parseLanguage: 'auto',
    enableDiarization: true,
    defaultProvider: (process.env.TRANSCRIPTION_PROVIDER || 'local-python').toLowerCase(),
    fallbackProviders: [],
    autoGenerateSummary: process.env.AUTO_GENERATE_SUMMARY === 'true',
    autoSuggestTags: process.env.AUTO_SUGGEST_TAGS !== 'false',
    circuitBreakerThreshold: 3,
    circuitBreakerCooldownMs: 5 * 60 * 1000,
    retrievalMode: 'hybrid',
    maxKnowledgeChunks: 8,
    openaiWhisper: {
      enabled: Boolean(process.env.OPENAI_TRANSCRIPTION_API_KEY || process.env.OPENAI_API_KEY),
      baseUrl: (
        process.env.OPENAI_TRANSCRIPTION_API_BASE_URL || 'https://api.openai.com/v1'
      ).replace(/\/$/, ''),
      apiKey: process.env.OPENAI_TRANSCRIPTION_API_KEY || process.env.OPENAI_API_KEY || '',
      model: process.env.OPENAI_TRANSCRIPTION_MODEL || 'whisper-1',
      transcriptionPath: process.env.OPENAI_TRANSCRIPTION_PATH || '/audio/transcriptions',
      translationPath: process.env.OPENAI_TRANSLATION_PATH || '/audio/translations',
      responseFormat: process.env.OPENAI_TRANSCRIPTION_RESPONSE_FORMAT || 'verbose_json',
      disableTimestampGranularities:
        process.env.OPENAI_TRANSCRIPTION_DISABLE_TIMESTAMP_GRANULARITIES === 'true',
    },
    localRuntime: {
      enabled:
        process.env.LOCAL_AUDIO_ENGINE_ENABLED === 'true' ||
        Boolean(process.env.LOCAL_AUDIO_ENGINE_URL?.trim()),
      baseUrl: getDefaultLocalRuntimeBaseUrl(),
      backendId: localSelection.backendId,
      modelName: localSelection.modelName,
      diarizationStrategy: ['auto', 'parallel', 'sequential'].includes(
        String(process.env.LOCAL_AUDIO_ENGINE_DIARIZATION_STRATEGY || '').trim().toLowerCase(),
      )
        ? (String(process.env.LOCAL_AUDIO_ENGINE_DIARIZATION_STRATEGY).trim().toLowerCase() as LocalDiarizationStrategy)
        : 'auto',
      hfToken: process.env.LOCAL_AUDIO_ENGINE_HF_TOKEN || process.env.HF_TOKEN || '',
      requestTimeoutMs: Math.max(
        60_000,
        Number(process.env.LOCAL_AUDIO_ENGINE_REQUEST_TIMEOUT_MS || 3_600_000),
      ),
    },
    llm: {
      baseUrl: (process.env.LLM_API_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
      apiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '',
      model: process.env.LLM_MODEL || 'gpt-4o-mini',
    },
    subtitleSplit: {
      enabled: process.env.SUBTITLE_SPLIT_ENABLED !== 'false',
      baseUrl: (
        process.env.SUBTITLE_SPLIT_API_BASE_URL ||
        process.env.SUBTITLE_LLM_API_BASE_URL ||
        process.env.LLM_API_BASE_URL ||
        'https://api.openai.com/v1'
      ).replace(/\/$/, ''),
      apiKey:
        process.env.SUBTITLE_SPLIT_API_KEY ||
        process.env.SUBTITLE_LLM_API_KEY ||
        process.env.LLM_API_KEY ||
        process.env.OPENAI_API_KEY ||
        '',
      model: process.env.SUBTITLE_SPLIT_MODEL || process.env.SUBTITLE_LLM_MODEL || 'gpt-4o-mini',
      requestTimeoutMs: Math.max(
        5_000,
        Number(process.env.SUBTITLE_SPLIT_REQUEST_TIMEOUT_MS || 60_000),
      ),
      maxRetries: Math.min(
        5,
        Math.max(0, Number(process.env.SUBTITLE_SPLIT_MAX_RETRIES || 2)),
      ),
    },
  };
}

function readLegacySubtitleSplitSettings(input: StoredUserSettingsInput) {
  return {
    baseUrl: readString(input.subtitleLlm?.baseUrl, ''),
    apiKey: readOptionalString(input.subtitleLlm?.apiKey),
    model: readString(input.subtitleLlm?.model, ''),
  };
}

export function mergeUserSettings(
  base: UserSettings,
  input: StoredUserSettingsInput,
): Partial<UserSettings> {
  const legacySubtitleSplit = readLegacySubtitleSplitSettings(input);

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
      ...(legacySubtitleSplit.baseUrl || legacySubtitleSplit.apiKey || legacySubtitleSplit.model
        ? legacySubtitleSplit
        : {}),
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
