# Architecture

## Layer Boundaries

The repository is being refactored around four internal layers while keeping the existing external API and deployment model intact.

- `web-ui`
  - React pages, components, hooks, contexts, and route composition.
  - Responsible for user interaction, optimistic UI, polling, and streaming presentation.
- `app-api`
  - Express route handlers and middleware.
  - Responsible for auth enforcement, request validation, response mapping, and HTTP-only concerns.
- `application`
  - Task orchestration, chat, summaries, notebooks, uploads, and search workflows.
  - Responsible for business rules and composing repositories/providers.
- `infrastructure`
  - Database access, migrations, search-index adapters, file system access, and runtime/provider integration.
  - Responsible for persistence and external system boundaries.

## Current Conventions

- Schema changes must go through `database/migrations`.
- Application startup should not mutate schema.
- Route handlers should avoid direct Knex access whenever an application or repository layer exists.
- Repository modules should own SQL and row-shape concerns.
- JSON parse/stringify should be centralized instead of spread across routes.

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

## Near-term Refactor Targets

- Move remaining search SQL behind a search adapter.
- Continue splitting `useAppData` into domain-specific hooks.
- Keep `server.ts` as an app assembly entrypoint only.
- Keep `worker.ts` as a thin bootstrap around queue execution.
