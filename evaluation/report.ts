/**
 * Builds evaluation/reports/evaluation-report.md from every run under evaluation/results.
 *
 *   npm run eval:report
 */
import fs from 'fs';
import path from 'path';

const root = path.dirname(new URL(import.meta.url).pathname);

function readRuns(dir: string) {
  const full = path.join(root, 'results', dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full)
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(fs.readFileSync(path.join(full, file), 'utf8')));
}

const pct = (value: number | null | undefined, digits = 1) => (value == null ? '—' : `${(value * 100).toFixed(digits)}%`);
const lines: string[] = ['# Evaluation report', '', `Generated ${new Date().toISOString()}.`, ''];

const asrRuns = readRuns('asr').sort((a, b) => a.summary.pooledErrorRate - b.summary.pooledErrorRate);
if (asrRuns.length) {
  const tags = [...new Set(asrRuns.flatMap((run) => run.results.flatMap((item: { tags?: string[] }) => item.tags || [])))] as string[];
  lines.push('## Transcription', '');
  lines.push('Pooled error rate = total edit errors / total reference characters (CER) or words (WER), so long clips weigh more than short ones. RTF = processing time / audio length (lower is faster).', '');
  lines.push(`| Run | Provider | Model | Clips | Error rate | ${tags.map((tag) => `\`${tag}\``).join(' | ')}${tags.length ? ' | ' : ''}Mean RTF | Failed |`);
  lines.push(`|---|---|---|---|---|${tags.map(() => '---|').join('')}---|---|`);
  for (const run of asrRuns) {
    const byTag = tags.map((tag) => {
      const items = run.results.filter((item: { tags?: string[]; errors?: number }) => item.tags?.includes(tag) && item.errors != null);
      const errors = items.reduce((sum: number, item: { errors: number }) => sum + item.errors, 0);
      const length = items.reduce((sum: number, item: { referenceLength: number }) => sum + item.referenceLength, 0);
      return length ? pct(errors / length) : '—';
    });
    const model = run.env?.LOCAL_AUDIO_ENGINE_MODEL || run.env?.OPENAI_TRANSCRIPTION_MODEL || '—';
    lines.push(`| ${run.label} | ${run.provider} | ${model} | ${run.summary.clips} | **${pct(run.summary.pooledErrorRate, 2)}** | ${byTag.join(' | ')}${tags.length ? ' | ' : ''}${run.summary.meanRtf == null ? '—' : run.summary.meanRtf.toFixed(2)} | ${run.summary.failed} |`);
  }
  lines.push('');
}

const retrievalRuns = readRuns('retrieval');
if (retrievalRuns.length) {
  lines.push('## Retrieval', '');
  lines.push('R@k = share of relevant recordings in the top k. MRR = mean reciprocal rank of the first relevant recording. TS@k = the right moment (±15 s) is among the top k passages.', '');
  lines.push('| Run | Mode | Questions | R@1 | R@3 | R@5 | MRR | TS@3 | Mean latency |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const run of retrievalRuns) {
    for (const [mode, data] of Object.entries(run.modes) as [string, { summary: { recallAtK: Record<string, number>; mrr: number; timestampHitAtK: Record<string, number | null>; meanLatencyMs: number } }][]) {
      const s = data.summary;
      lines.push(`| ${run.label} | ${mode} | ${run.questions} | ${pct(s.recallAtK['1'], 0)} | ${pct(s.recallAtK['3'], 0)} | ${pct(s.recallAtK['5'], 0)} | ${s.mrr.toFixed(2)} | ${pct(s.timestampHitAtK['3'], 0)} | ${Math.round(s.meanLatencyMs)} ms |`);
    }
  }
  lines.push('');
}

lines.push('## Reading these numbers', '');
lines.push('- Small sets give wide error bars: with 10 clips or 30 questions, a difference of a few points can be noise. Report the sample size next to any claim.');
lines.push('- CER normalization folds width, punctuation and spacing, but not kanji/kana spelling, numerals or fillers; those count as errors.');
lines.push('- Retrieval runs depend on what is indexed in the workspace and on the embeddings model at the time of the run.');
lines.push('');

const outDir = path.join(root, 'reports');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'evaluation-report.md');
fs.writeFileSync(outFile, `${lines.join('\n')}\n`);
console.log(`Wrote ${path.relative(process.cwd(), outFile)} (${asrRuns.length} transcription runs, ${retrievalRuns.length} retrieval runs)`);
