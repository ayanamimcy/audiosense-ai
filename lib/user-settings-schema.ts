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

export interface UserSettings {
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
}

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
  };
}

export function mergeUserSettings(
  base: UserSettings,
  input: Partial<UserSettings>,
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
  };
}

export function sanitizeUserSettings(
  input: Partial<UserSettings>,
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
  };
}

export function resolveOpenAIWhisperSettings(settings?: Partial<UserSettings>) {
  return sanitizeUserSettings(settings || {}, getDefaultSettings()).openaiWhisper;
}

export function resolveLocalRuntimeSettings(settings?: Partial<UserSettings>) {
  return sanitizeUserSettings(settings || {}, getDefaultSettings()).localRuntime;
}

export function resolveLlmSettings(settings?: Partial<UserSettings>) {
  return sanitizeUserSettings(settings || {}, getDefaultSettings()).llm;
}

export function getLocalRuntimeCatalogSnapshot(): LocalRuntimeCatalog {
  return getLocalRuntimeCatalog();
}
