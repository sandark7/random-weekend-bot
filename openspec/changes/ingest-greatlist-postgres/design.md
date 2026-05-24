# Design: GreatList PostgreSQL Ingestion

## Storage

Use PostgreSQL with PostGIS. A venue can have many physical addresses, so the
model is:

- `places`: logical venue/project.
- `place_locations`: concrete address branches with coordinates.
- `geocoding_cache`: one row per normalized address query.
- `import_runs`: audit trail for scraper runs.

`place_locations.geog` is a `geography(Point, 4326)` column with a GiST index.
Radius queries use `ST_DWithin(..., meters)` and order by `ST_Distance(...)`.

## GreatList Parsing

The importer starts from `https://greatlist.ru/msk/`, discovers links under
`/msk/restaurant/` and `/msk/hotel/`, and then parses each detail page.

Only factual metadata is stored. Long editorial descriptions are intentionally
left out.

## Geocoding Strategy

Use an interface:

```text
Address text -> normalized query -> cache lookup -> provider -> cache write
```

The default provider is Nominatim-compatible:

- query: `Москва, <address>, Россия` for Moscow addresses;
- `countrycodes=ru`;
- `format=jsonv2`;
- `limit=1`;
- descriptive `User-Agent`;
- single-threaded requests with a configurable interval.

For regular or large imports, run a local Nominatim/Photon/Pelias instance and
point `CITYDATEBOT_NOMINATIM_URL` to it. The public Nominatim service should be
used only deliberately and respectfully.

## Quality Control

Geocoding results are marked with a status:

- `resolved`: coordinates are available;
- `not_found`: provider returned no result;
- `error`: provider failed;
- `pending`: address imported but not geocoded.

Later admin tools can expose pending rows for manual correction.

