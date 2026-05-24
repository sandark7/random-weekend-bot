# Design: TypeScript SQLite Runtime

## Architecture

```text
Telegram
  |
  v
Fastify webhook or polling entrypoint
  |
  v
grammY bot handlers
  |
  v
Address geocoder (optional text input)
  |
  v
Place repository (Drizzle + SQLite)
  |
  v
/app/data/bot.sqlite
```

## Runtime Choices

- Node.js + TypeScript.
- grammY for Telegram.
- Fastify for HTTP health/webhook.
- SQLite with Drizzle ORM.
- Zod for env and CSV validation.
- pino for JSON logs.

## Data Flow

Scrapers and manual curation produce CSV files:

- `categories.csv`
- `places.csv`
- `place_categories.csv`

The runtime importer validates CSV rows, deletes places absent from the current
CSV set, upserts current place rows, and replaces place-category links from the
current CSV set. Scrapers do not write directly to the runtime database.

## Nearby Search

SQLite stores `latitude` and `longitude` as `REAL` on each physical place row.
Nearby search:

1. Compute a bounding box for the requested radius.
2. Query rows inside that box.
3. Compute haversine distance in TypeScript.
4. Filter by radius and current opening hours.
5. Choose a random candidate.

This is enough for thousands of places on a 1 GB VM.

## Address Geocoding

Telegram Desktop often cannot send GPS location, so free-form address input is
a first-class path. The bot accepts street and house text, adds a Moscow bias,
and resolves it through a configurable Nominatim-compatible search endpoint.

The public Nominatim endpoint is only for moderate, user-triggered usage. The
runtime therefore:

- sends an application `User-Agent`;
- does not implement autocomplete;
- applies a Moscow viewbox and Russia country filter;
- keeps a small in-memory cache for repeated lookups within the process;
- spaces out external requests through `GEOCODER_MIN_INTERVAL_MS`.

If traffic grows, `GEOCODER_URL` can be switched to a hosted or self-managed
geocoder without changing the bot code.

## Opening Hours

`opening_hours_text` preserves the human-entered source. `opening_hours_json`
stores a normalized weekly schedule when parsing succeeds. The column is
nullable, but runtime suggestions always require parsed hours and only return
places open at the current Moscow time.

## Deployment

Docker Compose runs only one service:

- `bot`: Node.js application.

SQLite lives in a Docker volume mounted at `/app/data`.
