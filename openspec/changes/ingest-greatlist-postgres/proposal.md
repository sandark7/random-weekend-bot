# Proposal: Ingest GreatList Into PostgreSQL

## Intent

Move curated venue data from local JSON toward a PostgreSQL/PostGIS database and
seed it from GreatList Moscow pages.

## Scope

In scope:

- PostgreSQL schema for places, place locations, geocoding cache, and import
  runs.
- PostGIS geography points for accurate radius searches in meters.
- GreatList Moscow scraper that imports factual venue metadata: title, category,
  source URL, addresses, phone, hours, and website URL.
- Address-to-coordinate pipeline with a provider abstraction and Nominatim/OSM
  implementation.
- Persistent geocoding cache to avoid repeated provider calls.
- Local Docker Compose config for a PostGIS database.
- SQL query/function for finding nearby venues.

Out of scope:

- Copying long GreatList editorial descriptions into the database.
- Running a production-grade scraping schedule.
- Paid/commercial geocoding providers.
- Migrating the Telegram bot runtime to read from PostgreSQL by default.

## Success Criteria

- The database schema can be created with one migration command.
- The importer can crawl GreatList Moscow pages and upsert place/location rows.
- The geocoder rate-limits and caches results.
- Nearby lookup can use `ST_DWithin` over a spatial index.
- The bot can keep using JSON until a later repository swap.

