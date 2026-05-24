# Design: Docker Runtime

## Services

- `postgres`: PostGIS database with a healthcheck.
- `bot`: long-running Telegram polling process.
- `migrate`: one-off migration runner.
- `import-greatlist`: one-off importer command; accepts additional CLI args.

The app image installs `.[db]` so it includes `aiogram` and `psycopg`.

## Local Engine

On macOS, use Docker Desktop or a lightweight engine such as Colima plus Docker
CLI. The Compose file does not depend on Docker Desktop-specific features.

## Secrets

The Compose services read `.env`. `.env` remains ignored by git.

