# Delta for Runtime Analytics

## ADDED Requirements

### Requirement: Privacy-Safe Product Analytics

The runtime MUST write product analytics events to SQLite without storing raw Telegram identifiers, raw user address text, exact user coordinates, bot tokens, or raw external tokens.

#### Scenario: User and chat ids are hashed

- GIVEN analytics is enabled
- AND `ANALYTICS_SALT` is configured
- WHEN an event is tracked with a Telegram context
- THEN `analytics_events.user_id_hash` and `analytics_events.chat_id_hash` contain HMAC-SHA256 hashes
- AND raw Telegram ids are not stored

#### Scenario: Payload is sanitized

- GIVEN analytics is enabled
- WHEN an event payload contains `rawText`, `query`, or `locationLabel`
- THEN those keys are removed before writing `payload_json`

#### Scenario: Coordinates are rounded before tracking

- GIVEN a user location is tracked
- WHEN latitude or longitude is included in analytics payloads
- THEN the values are rounded to two decimal places

### Requirement: Best-Effort Analytics Writes

Analytics MUST never break a user-facing bot response.

#### Scenario: Analytics table is missing

- GIVEN analytics is enabled
- AND the SQLite database does not contain `analytics_events`
- WHEN the application creates analytics and tracks an event
- THEN no exception escapes to the caller
- AND pino logs `analytics_write_failed`

#### Scenario: Analytics is disabled

- GIVEN `ANALYTICS_ENABLED=false`
- WHEN product events are tracked
- THEN no analytics rows are written
- AND user-facing bot flows continue normally

#### Scenario: Analytics salt is missing

- GIVEN analytics is enabled
- AND `ANALYTICS_SALT` is not configured
- WHEN an event is tracked
- THEN the event is still written
- AND user and chat hashes are null
- AND pino logs `analytics_salt_missing`

### Requirement: Analytics Migration

The runtime MUST have one canonical migration that creates `analytics_events`.

#### Scenario: Run migrations on a fresh database

- GIVEN a fresh SQLite database
- WHEN migrations are applied
- THEN `analytics_events` exists
- AND analytics indexes exist

### Requirement: Privacy-Conscious Technical Location Logs

Technical logs MAY include operational context, but location-resolution logs MUST NOT include raw user address queries, raw geocoder labels, or exact user coordinates.

#### Scenario: Location resolution is logged

- GIVEN the bot resolves a text location
- WHEN it writes the `location_resolved` technical log
- THEN the log includes status, confidence, and kind
- AND it includes only rounded latitude and longitude
- AND it does not include raw `query` or raw `label`
