# AudioSense AI

AudioSense AI is an open audio workspace for teams that need to capture, transcribe, organize, search, and discuss spoken content.

It combines a React workspace, an API server, a background worker, and an optional local Python runtime for Faster Whisper, optional WhisperX alignment, and diarization workloads.

## Highlights

- Upload audio files and queue long-running transcription jobs
- Record audio directly in the browser and send it into the same processing pipeline
- Organize recordings with notebooks, tags, dates, and task metadata
- Run complete-first local Faster Whisper transcription with optional WhisperX alignment and diarization through `python-runtime`
- Generate summaries, chat with a single transcript, and ask questions across recordings
- Use provider routing, fallback chains, and circuit breaker controls
- Support both SQLite-by-default and PostgreSQL-based deployments
- Deploy with Docker Compose, including a dedicated CUDA runtime container

## Architecture

AudioSense AI is split into a few clear responsibilities:

- `app`
  Frontend + API server. Handles auth, uploads, task creation, settings, retrieval, and LLM orchestration.
- `worker`
  Background job runner. Claims queued transcription jobs and writes results back to storage.
- `local-audio-runtime`
  Optional Python sidecar for local Faster Whisper inference, optional WhisperX timestamp alignment, and diarization, especially useful on a GPU host.
- `database`
  SQLite by default. Stores users, tasks, notebooks, messages, chunks, provider state, and the job queue.

High-level flow:

```mermaid
flowchart LR
  B[Browser<br/>React PWA] -->|upload / record| A[app<br/>Express API]
  A -->|enqueue| Q[(task_jobs<br/>queue)]
  W[worker<br/>lease + heartbeat] -->|claim| Q
  W --> E[audio-engine<br/>provider chain + circuit breaker]
  E --> L[local runtime<br/>Faster Whisper / WhisperX]
  E --> O[OpenAI-compatible / Azure]
  W -->|transcript, segments| D[(SQLite / PostgreSQL<br/>tasks, chunks, FTS, vectors)]
  A -->|summaries, chat, Ask AI| M[LLM API]
  A -->|one row per call| T[(llm_calls)]
  A <-->|hybrid retrieval| D
```

## Core Features

### Workspace

- Task list with transcript, summary, and chat views
- Notebook and tag management
- Edit task metadata after upload
- One-click transcript copy from the transcript panel

### Speech Pipeline

- Queue-based processing for long recordings
- Provider registry and routing layer
- Local Python runtime for WhisperX and diarization
- Word timestamps, speaker segmentation, and transcript normalization

### Knowledge Layer

- Task-level summary generation
- Task-level chat over transcript context
- Cross-recording search and knowledge answering
- Hybrid retrieval with FTS and embeddings

### Operations

- User login / registration / sessions
- Worker retries for failed jobs, and crash recovery through job leases and heartbeats
- Provider health tracking, circuit breaking, and fallback to the next configured provider
- Per-call LLM tracing: latency, time to first token, token usage, errors, prompt version
- Docker Compose deployment for app, worker, and CUDA runtime

## Engineering Notes

How the system is kept honest about reliability and quality:

| Topic | What it covers | Verify it |
|---|---|---|
| [Worker crash recovery](docs/reliability.md) | Leases, heartbeats and fencing so a killed or frozen worker never strands or double-writes a job; provider fallback by error type | `npm run chaos:worker` kills and freezes real worker processes and checks the outcome |
| [LLM observability](docs/observability.md) | One row per LLM call without storing content; usage, latency and cost estimates in Settings › System status | `tests/llm-observability.test.ts` |
| [Evaluation](evaluation/README.md) | CER/WER and real-time factor per transcription configuration; Recall@k, MRR and timestamp hits per retrieval mode | `npm run eval:asr`, `npm run eval:retrieval`, `npm run eval:report` |

## Repository Layout

```
server.ts                   # Express API entrypoint
worker.ts                   # Background transcription worker
db.ts                       # Schema bootstrap and DB initialization

lib/
├── config.ts               # Centralized configuration (single source of truth for all env vars)
├── ai/                     # LLM calls + call tracing, embeddings, query enhancement, reranking
├── auth/                   # User auth, sessions, API tokens, encrypted settings
├── audio-engine/           # Provider abstraction and fallback chain, normalization, speaker merge, subtitle split
├── evaluation/             # CER/WER and retrieval metrics
├── search/                 # Full-text + vector search, knowledge base, associations
├── settings/               # User settings schema, merge, and persistence
├── tasks/                  # Task lifecycle: queue with job leases, processor, chat, uploads, subtitles
├── workspaces/             # Workspace creation and resolution
└── shared/                 # Logger, text encoding, cross-cutting utilities

application/services/       # Application service layer (route handlers import from here)
database/                   # Knex client, config, migrations, and repository modules
routes/                     # Express route handlers (thin HTTP layer)
src/                        # React frontend (Vite + Tailwind)
python-runtime/             # Local WhisperX / diarization inference runtime
scripts/                    # CLI utilities (user management, migrations, reindex) and chaos experiments
evaluation/                 # Transcription and retrieval evaluation harness, datasets format, reports
docs/                       # Architecture, reliability and observability notes
tests/                      # Node.js test runner tests
```

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Create environment file

```bash
cp .env.example .env
```

Recommended minimum settings:

- `TRANSCRIPTION_PROVIDER=local-python`
- `LOCAL_AUDIO_ENGINE_ENABLED=true`
- `LOCAL_AUDIO_ENGINE_URL=http://127.0.0.1:8765`
- `LLM_API_KEY=...` if you want summary and chat

Common optional settings:

- `LOCAL_AUDIO_ENGINE_MODEL`
- `LOCAL_AUDIO_ENGINE_VAD_FILTER=false` keeps the full waveform in the authoritative Faster Whisper pass
- `LOCAL_AUDIO_ENGINE_WHISPERX_ALIGNMENT=true` optionally refines word timestamps without replacing ASR text
- `LOCAL_AUDIO_ENGINE_DIARIZATION_STRATEGY=auto|parallel|sequential`
- `LOCAL_AUDIO_ENGINE_HF_TOKEN`
- `SQLITE_FILENAME`
- `UPLOAD_DIR`
- `EMBEDDING_API_KEY`
- `EMBEDDING_DIMENSIONS` (must match the configured embedding model; `1536` by default)

### 3. Start the web app and worker

Run database migrations first:

```bash
npm run db:migrate
```

Then start the app and worker in development mode:

```bash
npm run dev
```

Default URL: `http://localhost:3000`

### Build for production

```bash
npm run build          # compiles server TypeScript + Vite frontend
npm run start:api      # runs the pre-compiled API server
npm run worker         # runs the pre-compiled worker
```

### 4. Start the local Python runtime

```bash
cd python-runtime
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[full]'
PYTHONPATH=src python -m local_audio_runtime.server
```

Or from the project root:

```bash
npm run dev:local-engine
```

## Docker Deployment

The repository includes:

- [Dockerfile](Dockerfile)
  Shared Node image for `app` and `worker`
- [docker-compose.yml](docker-compose.yml)
  Deployment-focused Compose file using images
- [docker-compose.build.yml](docker-compose.build.yml)
  Local build override for source-based Docker builds
- [python-runtime/Dockerfile.cuda](python-runtime/Dockerfile.cuda)
  CUDA-ready Python runtime image

### Deploy with images

```bash
cp .env.example .env
docker compose pull
docker compose run --rm app npm run db:migrate
docker compose up -d
```

### Build locally from source

```bash
cp .env.example .env
docker compose -f docker-compose.yml -f docker-compose.build.yml build app worker
docker compose -f docker-compose.yml -f docker-compose.build.yml run --rm app npm run db:migrate
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Important deployment notes:

- `app` and `worker` share the same SQLite volume and uploads volume
- `app` and `worker` talk to `local-audio-runtime` over the Compose network
- `local-audio-runtime` is designed for Linux + NVIDIA GPU environments
- First startup may take a while because Whisper / diarization weights are downloaded
- `app` / `worker` no longer create tables implicitly on boot; run `npm run db:migrate` first

Default image names:

- `audiosense-ai`
- `audiosense-ai-local-runtime-cuda`

## Local Runtime Notes

The Python runtime supports:

- WhisperX transcription
- diarization with pyannote
- word timestamps and aligned segments
- live recording runtime primitives
- HTTP transcription endpoints and a WebSocket live endpoint

Relevant files:

- [python-runtime/src/local_audio_runtime/server.py](python-runtime/src/local_audio_runtime/server.py)
- [python-runtime/src/local_audio_runtime/model_manager.py](python-runtime/src/local_audio_runtime/model_manager.py)
- [python-runtime/src/local_audio_runtime/backends.py](python-runtime/src/local_audio_runtime/backends.py)
- [python-runtime/src/local_audio_runtime/diarization.py](python-runtime/src/local_audio_runtime/diarization.py)
- [python-runtime/src/local_audio_runtime/parallel_diarize.py](python-runtime/src/local_audio_runtime/parallel_diarize.py)

## Current Scope

AudioSense AI is already suitable for self-hosted experimentation, internal tooling, and iterative product development. It is not yet presented as a finished enterprise platform.

Current practical boundaries:

- SQLite is the default persistence layer
- object storage is not the default path yet
- browser recording works best in foreground sessions
- large-scale queue orchestration is still intentionally simple

## Database Workflow

Database schema changes are managed through Knex migrations in [database/migrations](database/migrations).

Common commands:

```bash
npm run db:migrate
npm run db:rollback
npm run db:status
npm run db:migrate:make -- add_new_column
```

Optional helpers:

```bash
npm run db:reindex-search
npm run db:migrate:sqlite-to-pg -- --from /path/to/database.sqlite --to postgres://user:pass@host:5432/audiosense
```

Runtime behavior:

- development can opt into automatic migrations with `AUTO_RUN_MIGRATIONS=true`
- production should keep `AUTO_RUN_MIGRATIONS=false`
- if migrations are pending, `app` and `worker` fail fast with a clear error

## Roadmap Ideas

- S3-compatible object storage support
- alternative queue backends beyond SQLite polling
- richer transcript segmentation controls
- more local model backends in `python-runtime`
- improved mobile recording UX
- multi-user collaboration and shared notebooks

## Contributing

Issues and pull requests are welcome.

If you want to contribute:

1. Open an issue for larger changes
2. Keep changes scoped and reviewable
3. Include validation notes for runtime, UI, or Docker changes when relevant

## License

This repository currently does not include a license file yet. Add one before publishing it as a fully open-source distribution.
