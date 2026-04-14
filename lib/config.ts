/**
 * Centralized configuration — single source of truth for all environment variables.
 *
 * Every `process.env.*` read in the codebase should go through this module.
 * Values are read once at import time, validated, and exported as a frozen typed object.
 */

import path from 'path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function str(envVar: string | undefined, fallback: string): string {
  const value = envVar?.trim();
  return value || fallback;
}

function num(envVar: string | undefined, fallback: number): number {
  const parsed = Number(envVar);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(envVar: string | undefined, fallback: boolean): boolean {
  const value = (envVar || '').trim().toLowerCase();
  if (!value) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return fallback;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

function parseTrustProxy(): string | number | boolean {
  const raw = process.env.TRUST_PROXY?.trim();
  if (raw === undefined || raw === '') return 1;
  if (['true', 'yes', 'on'].includes(raw.toLowerCase())) return true;
  if (['false', 'no', 'off'].includes(raw.toLowerCase())) return false;
  if (Number.isFinite(Number(raw))) return Number(raw);
  return raw;
}

const server = Object.freeze({
  port: num(process.env.PORT, 3000),
  nodeEnv: str(process.env.NODE_ENV, 'development'),
  isProduction: (process.env.NODE_ENV || '').trim() === 'production',
  trustProxy: parseTrustProxy(),
  corsOrigin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim())
    : undefined,
  allowRegistration: bool(process.env.ALLOW_REGISTRATION, false),
  logLevel: str(process.env.LOG_LEVEL, 'info') as 'debug' | 'info' | 'warn' | 'error',
});

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

const configuredDbType = str(process.env.DB_TYPE, 'sqlite3').toLowerCase();

const db = Object.freeze({
  type: (configuredDbType === 'pg' ? 'pg' : 'sqlite3') as 'sqlite3' | 'pg',
  isSqlite: configuredDbType !== 'pg',
  sqliteFilename: process.env.SQLITE_FILENAME?.trim()
    ? path.resolve(process.env.SQLITE_FILENAME.trim())
    : path.join(process.cwd(), 'database.sqlite'),
  databaseUrl: str(process.env.DATABASE_URL, 'postgres://user:password@localhost:5432/dbname'),
  poolMin: num(process.env.DB_POOL_MIN, configuredDbType !== 'pg' ? 1 : 0),
  poolMax: num(process.env.DB_POOL_MAX, configuredDbType !== 'pg' ? 1 : 5),
  autoRunMigrations: bool(process.env.AUTO_RUN_MIGRATIONS, false),
});

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

const configuredUploadMaxFileSize = Number(process.env.UPLOAD_MAX_FILE_SIZE_BYTES || '');

const upload = Object.freeze({
  dir: path.resolve(str(process.env.UPLOAD_DIR, path.join(process.cwd(), 'uploads'))),
  maxFileSizeBytes:
    Number.isFinite(configuredUploadMaxFileSize) && configuredUploadMaxFileSize > 0
      ? configuredUploadMaxFileSize
      : 2 * 1024 * 1024 * 1024,
});

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

const worker = Object.freeze({
  idleMs: num(process.env.WORKER_IDLE_MS, 3000),
});

// ---------------------------------------------------------------------------
// LLM
// ---------------------------------------------------------------------------

const llm = Object.freeze({
  baseUrl: stripTrailingSlash(str(process.env.LLM_API_BASE_URL, 'https://api.openai.com/v1')),
  apiKey: str(process.env.LLM_API_KEY, '') || str(process.env.OPENAI_API_KEY, ''),
  model: str(process.env.LLM_MODEL, 'gpt-4o-mini'),
});

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

const embeddings = Object.freeze({
  baseUrl: stripTrailingSlash(
    str(process.env.EMBEDDING_API_BASE_URL, '') || llm.baseUrl,
  ),
  apiKey: str(process.env.EMBEDDING_API_KEY, '') || llm.apiKey,
  model: str(process.env.EMBEDDING_MODEL, 'text-embedding-3-small'),
});

// ---------------------------------------------------------------------------
// Subtitle Split
// ---------------------------------------------------------------------------

const subtitleSplit = Object.freeze({
  enabled: process.env.SUBTITLE_SPLIT_ENABLED !== 'false',
  baseUrl: stripTrailingSlash(
    str(process.env.SUBTITLE_SPLIT_API_BASE_URL, '') || llm.baseUrl,
  ),
  apiKey: str(process.env.SUBTITLE_SPLIT_API_KEY, '') || llm.apiKey,
  model: str(process.env.SUBTITLE_SPLIT_MODEL, 'gpt-4o-mini'),
  requestTimeoutMs: Math.max(5_000, num(process.env.SUBTITLE_SPLIT_REQUEST_TIMEOUT_MS, 60_000)),
  maxRetries: Math.min(5, Math.max(0, num(process.env.SUBTITLE_SPLIT_MAX_RETRIES, 2))),
});

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

const transcription = Object.freeze({
  defaultProvider: str(process.env.TRANSCRIPTION_PROVIDER, 'local-python').toLowerCase(),
  autoGenerateSummary: bool(process.env.AUTO_GENERATE_SUMMARY, false),
  autoSuggestTags: process.env.AUTO_SUGGEST_TAGS !== 'false',
});

// ---------------------------------------------------------------------------
// Local Audio Engine
// ---------------------------------------------------------------------------

const localAudioEngineUrl = process.env.LOCAL_AUDIO_ENGINE_URL?.trim();
const localAudioEngineHost = str(process.env.LOCAL_AUDIO_ENGINE_HOST, '127.0.0.1');
const localAudioEnginePort = num(process.env.LOCAL_AUDIO_ENGINE_PORT, 8765);

const localAudioEngine = Object.freeze({
  enabled: bool(process.env.LOCAL_AUDIO_ENGINE_ENABLED, false) || Boolean(localAudioEngineUrl),
  baseUrl: stripTrailingSlash(
    localAudioEngineUrl || `http://${localAudioEngineHost}:${localAudioEnginePort}`,
  ),
  port: localAudioEnginePort,
  autostart: process.env.LOCAL_AUDIO_ENGINE_AUTOSTART !== 'false',
  startupTimeoutMs: Math.max(5_000, num(process.env.LOCAL_AUDIO_ENGINE_STARTUP_TIMEOUT_MS, 120_000)),
  backend: str(process.env.LOCAL_AUDIO_ENGINE_BACKEND, 'whisperx'),
  model: str(process.env.LOCAL_AUDIO_ENGINE_MODEL, 'small'),
  diarizationStrategy: (['auto', 'parallel', 'sequential'].includes(
    str(process.env.LOCAL_AUDIO_ENGINE_DIARIZATION_STRATEGY, '').toLowerCase(),
  )
    ? str(process.env.LOCAL_AUDIO_ENGINE_DIARIZATION_STRATEGY, '').toLowerCase()
    : 'auto') as 'auto' | 'parallel' | 'sequential',
  hfToken: str(process.env.LOCAL_AUDIO_ENGINE_HF_TOKEN, '') || str(process.env.HF_TOKEN, ''),
  requestTimeoutMs: Math.max(60_000, num(process.env.LOCAL_AUDIO_ENGINE_REQUEST_TIMEOUT_MS, 3_600_000)),
});

// ---------------------------------------------------------------------------
// OpenAI Whisper Transcription
// ---------------------------------------------------------------------------

const openaiWhisper = Object.freeze({
  enabled: Boolean(
    str(process.env.OPENAI_TRANSCRIPTION_API_KEY, '') || str(process.env.OPENAI_API_KEY, ''),
  ),
  baseUrl: stripTrailingSlash(
    str(process.env.OPENAI_TRANSCRIPTION_API_BASE_URL, 'https://api.openai.com/v1'),
  ),
  apiKey: str(process.env.OPENAI_TRANSCRIPTION_API_KEY, '') || str(process.env.OPENAI_API_KEY, ''),
  model: str(process.env.OPENAI_TRANSCRIPTION_MODEL, 'whisper-1'),
  transcriptionPath: str(process.env.OPENAI_TRANSCRIPTION_PATH, '/audio/transcriptions'),
  translationPath: str(process.env.OPENAI_TRANSLATION_PATH, '/audio/translations'),
  responseFormat: str(process.env.OPENAI_TRANSCRIPTION_RESPONSE_FORMAT, 'verbose_json'),
  disableTimestampGranularities: bool(process.env.OPENAI_TRANSCRIPTION_DISABLE_TIMESTAMP_GRANULARITIES, false),
});

// ---------------------------------------------------------------------------
// Azure OpenAI
// ---------------------------------------------------------------------------

const azureOpenai = Object.freeze({
  endpoint: stripTrailingSlash(str(process.env.AZURE_OPENAI_ENDPOINT, '')),
  transcriptionDeployment: str(process.env.AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT, ''),
  apiVersion: str(process.env.AZURE_OPENAI_API_VERSION, '2024-10-21'),
  apiKey: str(process.env.AZURE_OPENAI_API_KEY, ''),
});

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

const security = Object.freeze({
  encryptionKey: process.env.USER_SETTINGS_ENCRYPTION_KEY?.trim() || '',
  encryptionKeyFile: process.env.USER_SETTINGS_ENCRYPTION_KEY_FILE?.trim() || '',
});

// ---------------------------------------------------------------------------
// Debug
// ---------------------------------------------------------------------------

const debug = Object.freeze({
  enabled: bool(process.env.DEBUG, false),
  disableHmr: bool(process.env.DISABLE_HMR, false),
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const config = Object.freeze({
  server,
  db,
  upload,
  worker,
  llm,
  embeddings,
  subtitleSplit,
  transcription,
  localAudioEngine,
  openaiWhisper,
  azureOpenai,
  security,
  debug,
});

export default config;
export type AppConfig = typeof config;
