# Proposal: Rewrite Runtime to TypeScript and SQLite

## Intent

Replace the experimental Python/PostgreSQL direction with a lightweight
TypeScript runtime that fits a 1 OCPU / 1 GB RAM server.

## Scope

In scope:

- TypeScript application runtime.
- grammY Telegram bot.
- Fastify webhook/health server.
- SQLite database file at `/app/data/bot.sqlite`.
- Drizzle ORM schema and repository layer.
- CSV staging import into SQLite.
- Zod validation for environment and imported CSV data.
- pino JSON logging.
- Single-container Docker runtime with a mounted data volume.

Out of scope:

- Keeping PostgreSQL/PostGIS in runtime.
- Running scrapers as long-lived services.
- Admin UI.
- Production reverse proxy/TLS automation.

## Success Criteria

- The app can be built with TypeScript.
- CSV data can be validated and imported into SQLite.
- The bot can suggest an open nearby place from SQLite.
- Docker Compose runs only one application container plus a data volume.
