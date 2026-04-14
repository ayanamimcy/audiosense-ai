# Architecture

## Layer Boundaries

The backend is organized into four layers with clear import rules:

```
routes/                     → thin HTTP handlers, only import from application/services/
application/services/       → use-case orchestration, business rules, error mapping
lib/                        → domain logic, pure functions, infrastructure adapters
database/                   → data access (repositories + migrations)
```

**Import rule**: `routes → application/services → lib → database`. Routes never reach directly into `lib/` or `database/repositories/` for business logic. Exceptions: `lib/config.ts` and `lib/auth/` (cross-cutting) can be imported from routes and middleware.

### web-ui (`src/`)

React pages, components, hooks, contexts, and route composition. Responsible for user interaction, optimistic UI, polling, and streaming presentation.

### app-api (`routes/`)

Express route handlers and middleware. Responsible for auth enforcement, request validation, response mapping, and HTTP-only concerns.

### application (`application/services/`)

Task orchestration, chat, summaries, notebooks, uploads, search, and settings workflows. Responsible for business rules and composing repositories/providers.

### domain & infrastructure (`lib/`)

Organized by domain into subdirectories:

```
lib/
├── config.ts               # Centralized env var configuration (read once, frozen)
├── ai/                     # LLM orchestration, embeddings, query enhancement, reranking
├── auth/                   # User auth, sessions, API tokens, encrypted settings storage
├── audio-engine/           # Transcription providers, normalization, subtitle splitting
├── search/                 # Search index, knowledge base, associations, background analysis
├── settings/               # User settings schema, merge, sanitize, persistence
├── tasks/                  # Task queue, processor, chat, uploads, subtitles, post-processing
├── workspaces/             # Workspace creation and resolution
└── shared/                 # Logger, text encoding, cross-cutting utilities
```

### data access (`database/`)

Knex client, connection config, migration runner, and repository modules. Repositories own SQL and row-shape concerns.

## Configuration

All environment variables are read in `lib/config.ts` at import time and exported as a frozen typed object. No other module reads `process.env` directly (except `scripts/` CLI tools and `tests/`).

The config object is organized by concern:

```typescript
config.server         // PORT, NODE_ENV, TRUST_PROXY, CORS_ORIGIN, ALLOW_REGISTRATION
config.db             // DB_TYPE, SQLITE_FILENAME, DATABASE_URL, pool settings
config.upload         // UPLOAD_DIR, UPLOAD_MAX_FILE_SIZE_BYTES
config.worker         // WORKER_IDLE_MS
config.llm            // LLM_API_BASE_URL, LLM_API_KEY, LLM_MODEL
config.embeddings     // EMBEDDING_API_* (falls back to llm config)
config.subtitleSplit  // SUBTITLE_SPLIT_* (falls back to llm config)
config.transcription  // TRANSCRIPTION_PROVIDER, AUTO_GENERATE_SUMMARY
config.localAudioEngine // LOCAL_AUDIO_ENGINE_*
config.openaiWhisper  // OPENAI_TRANSCRIPTION_*
config.azureOpenai    // AZURE_OPENAI_*
config.security       // USER_SETTINGS_ENCRYPTION_KEY
config.debug          // DEBUG, DISABLE_HMR
```

## Build Pipeline

Development uses `tsx` for on-the-fly TypeScript compilation. Production uses pre-compiled JavaScript:

```
npm run build:server   → tsc -p tsconfig.build.json → dist-server/
npm run build:client   → vite build → dist/
npm run build          → both of the above
```

Production entry points:
- `node dist-server/server.js` (API server)
- `node dist-server/worker.js` (background worker)

The Dockerfile uses a multi-stage build: `deps → build → app-runtime`. The runtime stage only contains `dist/`, `dist-server/`, `node_modules/`, `package.json`, and migration files — no TypeScript source.

## Logging

The backend uses a lightweight structured logger (`lib/shared/logger.ts`) instead of raw `console.log`. Each module creates a child logger:

```typescript
import logger from '../shared/logger.js';
const log = logger.child('task-queue');
log.info('Job claimed', { workerId, jobId });
```

Output format:
- **Production**: JSON lines (`{"level":"info","ts":"...","module":"task-queue","msg":"Job claimed","workerId":"..."}`)
- **Development**: human-readable (`12:34:56.789 [INFO ] [task-queue] Job claimed {"workerId":"..."}`)

Log level is controlled via `LOG_LEVEL` env var (default: `info`).

## Current Conventions

- Schema changes must go through `database/migrations`.
- Application startup should not mutate schema.
- Route handlers import from `application/services/`, not directly from `lib/` or repositories.
- Repository modules own SQL and row-shape concerns.
- JSON parse/stringify is centralized in `lib/tasks/task-types.ts`.
- All env var reads are centralized in `lib/config.ts`.

## Database Workflow

- Local/dev bootstrap:
  - `npm run db:migrate`
- Status:
  - `npm run db:status`
- Rollback one batch:
  - `npm run db:rollback`
- Create a new migration file:
  - `npm run db:migrate:make -- add_feature_name`

## PostgreSQL Migration Workflow

- Migrate target PostgreSQL schema first:
  - `DB_TYPE=pg DATABASE_URL=... npm run db:migrate`
- Import SQLite data separately:
  - `npm run db:migrate:sqlite-to-pg -- --from /path/to/database.sqlite --to postgres://...`
- Rebuild search index if needed:
  - `DB_TYPE=pg DATABASE_URL=... npm run db:reindex-search`

## Testing

Tests use the Node.js built-in test runner with `tsx` for TypeScript support:

```bash
npm test
```

Test structure:
- `tests/helpers/setup.ts` — shared helper: temporary SQLite DB, migrations, resetDb, cleanup
- `tests/*.test.ts` — integration tests (auth, workspaces, etc.)
- `tests/unit/*.test.ts` — unit tests (config, user-settings-schema, subtitle splitting)

## Near-term Improvement Targets

- Replace `axios` with native `fetch` in LLM/embedding calls (Node 22 has stable fetch)
- Move remaining search SQL behind a search adapter
- Continue splitting `useAppData` into domain-specific hooks
- Expand test coverage for task CRUD, search, and chat services
