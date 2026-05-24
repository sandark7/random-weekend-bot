# Delta for SQLite Place Data

## ADDED Requirements

### Requirement: CSV Staging Data

Place data MUST be staged through CSV before importing into SQLite.

#### Scenario: Import curated data

- GIVEN `categories.csv`, `places.csv`, and `place_categories.csv`
- WHEN the importer runs
- THEN rows are validated with Zod
- AND valid place rows are upserted into SQLite
- AND category links are replaced from the current CSV set
- AND places absent from the current CSV set are deleted from SQLite

### Requirement: Physical Place Rows

Each row in `places.csv` MUST represent one concrete physical point.

#### Scenario: Store chain branches

- GIVEN a chain has multiple branches
- WHEN the data is staged
- THEN each branch is represented as a separate `places.csv` row
- AND `external_id` is unique for that physical point

### Requirement: Place Categories

Categories MUST be stored in a separate reference table and linked through
`place_categories.csv`.

#### Scenario: Multiple categories

- GIVEN a place is both a restaurant and breakfast place
- WHEN the importer runs
- THEN both category links are stored
- AND at most one category link is marked primary

### Requirement: Import Referential Integrity

Imported category links MUST reference existing places and categories.

#### Scenario: Missing reference

- GIVEN `place_categories.csv` references an unknown place or category
- WHEN the importer validates the rows
- THEN the import fails before writing partial data

### Requirement: Coordinates

Latitude and longitude MUST be handled as one coordinate pair.

#### Scenario: Coordinate validation

- GIVEN a place row contains only one coordinate component
- WHEN the importer validates the row
- THEN the import fails

### Requirement: Opening Hours

Each place MUST store opening hours as text and MAY store parsed JSON.

#### Scenario: Filter open places

- GIVEN a place has parsed opening hours JSON
- WHEN the bot searches for nearby places
- THEN the runtime can filter out places closed at the current Moscow time

#### Scenario: Unknown hours are excluded

- GIVEN a place has no parsed opening hours JSON
- WHEN the bot searches for suggestions
- THEN the place is not eligible for the result set

#### Scenario: Overnight intervals

- GIVEN an opening hours JSON interval crosses midnight
- WHEN the importer validates the row
- THEN the interval must contain `next_day=true`

### Requirement: Nearby Search

The runtime MUST find nearby places without PostGIS.

#### Scenario: Nearby search

- GIVEN user latitude, longitude, and radius
- WHEN the repository searches places
- THEN it first applies a latitude/longitude bounding box
- AND then computes haversine distance in application code
