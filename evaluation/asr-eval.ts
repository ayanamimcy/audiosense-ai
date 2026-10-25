/**
 * Transcription accuracy and speed on a labelled audio set.
 *
 *   npm run eval:asr -- --label fw-small --provider local-python [--manifest path] [--language ja]
 *
 * Reads a JSONL manifest (one clip per line):
 *   {"id": "mtg-01", "audio": "audio/mtg-01.wav", "reference": "references/mtg-01.txt", "language": "ja", "tags": ["noisy"]}
 * Paths are relative to the manifest. `reference` may also be inline text.
 *
 * Runs each clip through the same pipeline the app uses (provider → normalization), then
 * writes evaluation/results/asr/<label>.json. Change the model or settings between runs via
 * the usual env vars (e.g. LOCAL_AUDIO_ENGINE_MODEL=medium) and give each run its own label;
 * `npm run eval:report` compares all runs.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { characterErrorRate, pooledErrorRate, wordErrorRate, type ErrorRate } from '../lib/evaluation/metrics.js';

// Isolate provider-health/circuit state from the real database: an evaluation run that
// hits a broken provider must not open the circuit for the live app.
process.env.DB_TYPE = 'sqlite3';
process.env.SQLITE_FILENAME = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'audiosense-eval-')), 'eval.sqlite');
const { runMigrations } = await import('../db.js');
await runMigrations();
const { parseAudioWithFallback } = await import('../lib/audio-engine/engine.js');

interface ManifestItem {
  id: string;
  audio: string;
  reference: string;
  language?: string;
  tags?: string[];
}

function readArg(name: string, fallback?: string) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (value && !value.startsWith('--')) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing --${name}`);
}

const root = path.dirname(new URL(import.meta.url).pathname);
const label = readArg('label');
const provider = readArg('provider', '');
const manifestPath = path.resolve(readArg('manifest', path.join(root, 'datasets/asr/manifest.jsonl')));
const languageOverride = readArg('language', '');
const manifestDir = path.dirname(manifestPath);

const items = fs.readFileSync(manifestPath, 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('//'))
  .map((line) => JSON.parse(line) as ManifestItem);

function readReference(item: ManifestItem) {
  const candidate = path.resolve(manifestDir, item.reference);
  return fs.existsSync(candidate) ? fs.readFileSync(candidate, 'utf8') : item.reference;
}

const usesCer = (language: string) => /^(ja|zh|ko|th)/i.test(language);

const results = [];
for (const item of items) {
  const language = languageOverride || item.language || 'auto';
  const reference = readReference(item);
  const startedAt = Date.now();
  process.stdout.write(`${item.id} … `);

  try {
    const outcome = await parseAudioWithFallback(null, provider || null, {
      filePath: path.resolve(manifestDir, item.audio),
      fileName: path.basename(item.audio),
      language,
      diarization: false,
      wordTimestamps: false,
      task: 'transcribe',
      requestId: `eval-${label}-${item.id}`,
    });
    const processingSec = (Date.now() - startedAt) / 1000;
    const hypothesis = outcome.result.text;
    const metric: ErrorRate = usesCer(language) ? characterErrorRate(reference, hypothesis) : wordErrorRate(reference, hypothesis);
    const audioSec = outcome.result.durationSeconds || null;
    results.push({
      id: item.id,
      tags: item.tags || [],
      language,
      metric: usesCer(language) ? 'cer' : 'wer',
      ...metric,
      audioSec,
      processingSec,
      // Real-time factor: processing time / audio length. < 1 means faster than real time.
      rtf: audioSec ? processingSec / audioSec : null,
      provider: outcome.providerName,
      hypothesis,
    });
    console.log(`${(metric.rate * 100).toFixed(1)}% ${usesCer(language) ? 'CER' : 'WER'}, ${processingSec.toFixed(1)}s`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ id: item.id, tags: item.tags || [], language, error: message });
    console.log(`failed: ${message}`);
  }
}

const scored = results.filter((item): item is typeof item & ErrorRate & { rtf: number | null } => 'rate' in item);
const rtfs = scored.map((item) => item.rtf).filter((value): value is number => value != null);
const report = {
  label,
  provider: provider || 'default',
  createdAt: new Date().toISOString(),
  manifest: path.relative(process.cwd(), manifestPath),
  env: {
    // Recorded so a result can be traced back to the configuration that produced it.
    LOCAL_AUDIO_ENGINE_BACKEND: process.env.LOCAL_AUDIO_ENGINE_BACKEND || null,
    LOCAL_AUDIO_ENGINE_MODEL: process.env.LOCAL_AUDIO_ENGINE_MODEL || null,
    LOCAL_AUDIO_ENGINE_VAD_FILTER: process.env.LOCAL_AUDIO_ENGINE_VAD_FILTER || null,
    LOCAL_AUDIO_ENGINE_BEAM_SIZE: process.env.LOCAL_AUDIO_ENGINE_BEAM_SIZE || null,
    OPENAI_TRANSCRIPTION_MODEL: process.env.OPENAI_TRANSCRIPTION_MODEL || null,
  },
  summary: {
    clips: items.length,
    failed: results.length - scored.length,
    pooledErrorRate: pooledErrorRate(scored),
    meanRtf: rtfs.length ? rtfs.reduce((sum, value) => sum + value, 0) / rtfs.length : null,
  },
  results,
};

const outDir = path.join(root, 'results/asr');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `${label}.json`);
fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\n${label}: pooled error rate ${(report.summary.pooledErrorRate * 100).toFixed(2)}% over ${scored.length} clips` +
  (report.summary.meanRtf != null ? `, mean RTF ${report.summary.meanRtf.toFixed(2)}` : '') +
  `\nWrote ${path.relative(process.cwd(), outFile)}`);
process.exit(0);
