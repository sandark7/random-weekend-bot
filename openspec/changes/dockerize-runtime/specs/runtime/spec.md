# Delta for Docker Runtime

## ADDED Requirements

### Requirement: Containerized Bot Runtime

The project MUST provide a Docker image that can run the Telegram polling bot.

#### Scenario: Start bot in Docker

- GIVEN `.env` contains `BOT_TOKEN`
- WHEN the operator runs the bot Compose service
- THEN the bot starts polling from inside the container

### Requirement: Containerized Database

The project MUST provide a Compose-managed PostgreSQL/PostGIS service.

#### Scenario: Start database

- WHEN the operator starts the database Compose service
- THEN PostgreSQL is reachable at the configured `DATABASE_URL`
- AND PostGIS is available for migrations

### Requirement: Containerized One-Off Tools

The project SHOULD provide one-off Compose services for migrations and imports.

#### Scenario: Run importer

- GIVEN the database is healthy
- WHEN the operator runs the GreatList importer service
- THEN it executes inside the same application image
- AND can write to PostgreSQL through the internal Compose network

