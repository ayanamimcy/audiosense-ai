import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export interface LocalRuntimeModelCatalogEntry {
  id: string;
  label: string;
  description: string;
}

export interface LocalRuntimeBackendCatalogEntry {
  id: string;
  label: string;
  description: string;
  supportsDiarization: boolean;
  supportsIntegratedDiarization: boolean;
  supportsTranslation: boolean;
  defaultModel: string;
  models: LocalRuntimeModelCatalogEntry[];
}

export interface LocalRuntimeCatalog {
  backends: LocalRuntimeBackendCatalogEntry[];
}

const catalogPath = fileURLToPath(
  new URL('../../python-runtime/src/local_audio_runtime/backend_catalog.json', import.meta.url),
);

const fallbackCatalog: LocalRuntimeCatalog = {
  backends: [
    {
      id: 'whisperx',
      label: 'WhisperX',
      description: 'WhisperX with alignment and integrated diarization support.',
      supportsDiarization: true,
      supportsIntegratedDiarization: true,
      supportsTranslation: true,
      defaultModel: 'small',
      models: [
        { id: 'tiny', label: 'Tiny', description: 'Fastest startup, lowest accuracy.' },
        { id: 'base', label: 'Base', description: 'Balanced for quick local smoke tests.' },
        { id: 'small', label: 'Small', description: 'Good default for local deployment.' },
        { id: 'medium', label: 'Medium', description: 'Higher accuracy with more VRAM and latency.' },
        { id: 'large-v2', label: 'Large v2', description: 'Large multilingual checkpoint.' },
        { id: 'large-v3', label: 'Large v3', description: 'Best quality in the Whisper family.' },
        { id: 'distil-large-v3', label: 'Distil Large v3', description: 'Faster distilled large model.' },
      ],
    },
    {
      id: 'faster-whisper',
      label: 'Faster Whisper',
      description: 'Lower-overhead local Whisper runtime with word timestamps.',
      supportsDiarization: true,
      supportsIntegratedDiarization: false,
      supportsTranslation: true,
      defaultModel: 'small',
      models: [
        { id: 'tiny', label: 'Tiny', description: 'Fastest startup, lowest accuracy.' },
        { id: 'base', label: 'Base', description: 'Balanced for quick local smoke tests.' },
        { id: 'small', label: 'Small', description: 'Good default for local deployment.' },
        { id: 'medium', label: 'Medium', description: 'Higher accuracy with more VRAM and latency.' },
        { id: 'large-v2', label: 'Large v2', description: 'Large multilingual checkpoint.' },
        { id: 'large-v3', label: 'Large v3', description: 'Best quality in the Whisper family.' },
        { id: 'distil-large-v3', label: 'Distil Large v3', description: 'Faster distilled large model.' },
      ],
    },
  ],
};

let cachedCatalog: LocalRuntimeCatalog | null = null;

function normalizeCatalog(raw: unknown): LocalRuntimeCatalog {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as LocalRuntimeCatalog).backends)) {
    return fallbackCatalog;
  }

  const backends = (raw as LocalRuntimeCatalog).backends
    .map((backend) => {
      const models = Array.isArray(backend.models)
        ? backend.models
            .map((model) => ({
              id: String(model.id || '').trim(),
              label: String(model.label || model.id || '').trim(),
              description: String(model.description || '').trim(),
            }))
            .filter((model) => model.id)
        : [];

      const defaultModel = String(backend.defaultModel || models[0]?.id || '').trim();
      const resolvedDefaultModel =
        models.find((model) => model.id === defaultModel)?.id || models[0]?.id || '';

      return {
        id: String(backend.id || '').trim(),
        label: String(backend.label || backend.id || '').trim(),
        description: String(backend.description || '').trim(),
        supportsDiarization: Boolean(backend.supportsDiarization),
        supportsIntegratedDiarization: Boolean(backend.supportsIntegratedDiarization),
        supportsTranslation: Boolean(backend.supportsTranslation),
        defaultModel: resolvedDefaultModel,
        models,
      } satisfies LocalRuntimeBackendCatalogEntry;
    })
    .filter((backend) => backend.id && backend.models.length > 0);

  return backends.length > 0 ? { backends } : fallbackCatalog;
}

export function getLocalRuntimeCatalog() {
  if (cachedCatalog) {
    return cachedCatalog;
  }

  try {
    const raw = fs.readFileSync(path.resolve(catalogPath), 'utf8');
    cachedCatalog = normalizeCatalog(JSON.parse(raw));
  } catch {
    cachedCatalog = fallbackCatalog;
  }

  return cachedCatalog;
}

export function getLocalRuntimeBackendCatalogEntry(backendId?: string | null) {
  const catalog = getLocalRuntimeCatalog();
  const normalized = String(backendId || '').trim().toLowerCase();
  return catalog.backends.find((backend) => backend.id === normalized) || catalog.backends[0];
}

export function normalizeLocalRuntimeBackendSelection(
  backendId?: string | null,
  modelName?: string | null,
) {
  const backend = getLocalRuntimeBackendCatalogEntry(backendId);
  const normalizedModel = String(modelName || '').trim();
  const model =
    backend.models.find((item) => item.id === normalizedModel)?.id || backend.defaultModel;

  return {
    backendId: backend.id,
    modelName: model,
  };
}
