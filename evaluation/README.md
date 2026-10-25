# Evaluation

Repeatable measurements of how well AudioSense transcribes and retrieves, so a model,
setting or prompt change can be judged by numbers instead of impressions.

| Command | Measures | Output |
|---|---|---|
| `npm run eval:asr -- --label <name> [--provider <id>]` | Transcription error rate (CER for ja/zh/ko, WER otherwise) and speed (real-time factor) | `results/asr/<name>.json` |
| `npm run eval:retrieval -- --email <you> [--enhance]` | Whether search / Ask AI finds the right recording and moment, for FTS, vector and hybrid modes | `results/retrieval/<label>.json` |
| `npm run eval:report` | Compares every run above | `reports/evaluation-report.md` |

Metric code is in [`lib/evaluation/metrics.ts`](../lib/evaluation/metrics.ts) and is unit-tested.

## 1. Build the datasets

Audio, references and questions are private, so they are git-ignored by default.

**Transcription** — `datasets/asr/manifest.jsonl` (format: [`manifest.example.jsonl`](datasets/asr/manifest.example.jsonl)).
Each line points to an audio file and a hand-corrected reference transcript. A useful first
set is small but varied: 5–10 clips of 1–3 minutes covering domain terms, several speakers,
fast speech and background noise. Tag clips (`terms`, `noisy`, …) so the report breaks
results down by condition. Public corpora such as Common Voice (ja) can be added for a
baseline on read speech, keeping in mind that read speech is easier than meetings.

**Retrieval** — `datasets/retrieval/questions.jsonl` (format: [`questions.example.jsonl`](datasets/retrieval/questions.example.jsonl)).
Write 30–50 questions against recordings already in a workspace. For each, list the
recording(s) that answer it and, where you can, the start/end seconds where it is said.
Mix phrasing that reuses the transcript's words (favours full-text search) with paraphrases
and cross-language questions (favour vector search).

## 2. Run experiments

```bash
# Transcription: one run per configuration, each with its own label
LOCAL_AUDIO_ENGINE_MODEL=small    npm run eval:asr -- --label fw-small    --provider local-python
LOCAL_AUDIO_ENGINE_MODEL=large-v3 npm run eval:asr -- --label fw-large-v3 --provider local-python
LOCAL_AUDIO_ENGINE_MODEL=large-v3 LOCAL_AUDIO_ENGINE_VAD_FILTER=true \
                                  npm run eval:asr -- --label fw-large-v3-vad --provider local-python

# Retrieval: modes compared on retrieval alone, then with LLM query rewriting + HyDE as in the app
npm run eval:retrieval -- --email you@example.com --label baseline
npm run eval:retrieval -- --email you@example.com --label enhanced --enhance

npm run eval:report
```

The model is sent with every request, so `LOCAL_AUDIO_ENGINE_MODEL` takes effect per run.
Runtime-level options such as `LOCAL_AUDIO_ENGINE_VAD_FILTER` are read when the Python
runtime starts: stop any running runtime between runs that change them, otherwise the
already-running one is reused and the setting silently does nothing.

The ASR run uses a throwaway database, so a failing provider cannot open the circuit
breaker of the live app. The retrieval run reads the database from `.env` and only queries it.

## 3. Read the results honestly

- **Pooled, not averaged.** Error rate is total errors / total reference length, so a
  30-minute meeting outweighs a 10-second clip.
- **What CER does not forgive.** Width, punctuation and spacing are normalized; kanji vs kana
  spellings, numerals vs kanji numbers and fillers (えーと) are not, so CER overstates errors
  a reader would not notice.
- **Small samples.** With 10 clips or 30 questions, a gap of a few points can be noise.
  Always state the sample size; prefer differences that hold across tags.
- **Timestamps come from vector search.** Full-text matches carry no time range, so TS@k
  (right moment in the top k) is only informative with embeddings configured.
- **Trade-offs, not winners.** Report error rate next to RTF and hardware: a model that is
  1 point better but 3× slower is not automatically the right choice.
