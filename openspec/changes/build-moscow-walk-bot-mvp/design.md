# Design: Moscow Walk Bot MVP

## Technical Approach

Build the system as a small Python package with a clean boundary between domain
logic and the Telegram adapter.

The MVP uses local JSON files:

- `data/activities.sample.json` stores curated places and walks.
- `data/anchors.moscow.json` stores aliases for manual text input.

The bot can later swap local JSON for a database or external APIs without
changing the recommendation service contract.

## Architecture

```text
Telegram user
    |
    v
aiogram adapter (random_weekend_bot.bot)
    |
    v
Application service (random_weekend_bot.app)
    |
    +--> Local geocoder (random_weekend_bot.geocoding)
    +--> Activity repository (random_weekend_bot.repository)
    +--> Recommender (random_weekend_bot.recommender)
    +--> Formatter (random_weekend_bot.formatting)
```

## Key Decisions

### Decision: Local Data Before External Geocoding

Use local anchors for manual input in the MVP. Moscow geolocation can be noisy,
and API credentials introduce deployment friction. A local resolver lets the
core flow work immediately while keeping a provider interface ready for future
geocoders.

### Decision: JSON Instead of Database

Use JSON for seed data because the first iteration is curated and small. This
keeps setup simple and lets tests load fixtures directly.

### Decision: Standard Library Domain Core

Keep the domain core dependency-light. The only runtime framework dependency is
the Telegram adapter, so tests can run without network credentials or bot
startup.

## Data Model

`Activity` fields:

- `id`
- `title`
- `category`: `walk`, `drink`, `dinner`, `culture`
- `address`
- `latitude`
- `longitude`
- `description`
- `tags`
- `active`

`Anchor` fields:

- `id`
- `title`
- `aliases`
- `latitude`
- `longitude`

## Runtime Configuration

- `BOT_TOKEN`: Telegram bot token.
- `RANDOM_WEEKEND_BOT_DATA_PATH`: optional path to activities JSON.
- `RANDOM_WEEKEND_BOT_ANCHORS_PATH`: optional path to anchors JSON.
- `RANDOM_WEEKEND_BOT_RADIUS_METERS`: optional walking radius; defaults to `1500`.

## Future Extension Points

- Add a `Geocoder` protocol implementation for real providers.
- Add a database repository implementation.
- Add user history to avoid repeating suggestions.
- Add category filters and mood prompts.
