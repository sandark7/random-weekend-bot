# Proposal: Dockerize Runtime

## Intent

Run the bot, PostgreSQL/PostGIS, migrations, and GreatList importer through
Docker Compose so local development does not depend on host Python or host
PostgreSQL.

## Scope

In scope:

- Application Docker image with Python dependencies.
- Compose services for PostGIS, bot polling, migrations, and GreatList import.
- Compose profiles for one-off tooling commands.
- Documentation for starting the stack with Docker/Colima.

Out of scope:

- Production deployment hardening.
- Secret manager integration.
- Webhook hosting.

## Success Criteria

- `docker compose up -d postgres` starts the database.
- `docker compose run --rm migrate` applies migrations.
- `docker compose run --rm import-greatlist --dry-run --limit 3` parses GreatList
  from inside the app container.
- `docker compose up bot` starts the Telegram polling process with `.env`.

