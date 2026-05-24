# Delta for TypeScript Runtime

## ADDED Requirements

### Requirement: Lightweight Container Runtime

The runtime MUST fit a small VM by using a single Node.js container and a SQLite
file in a Docker volume.

#### Scenario: Start container

- GIVEN `.env` contains a bot token
- WHEN the operator runs `docker compose up bot`
- THEN the Node.js application starts
- AND stores runtime data under `/app/data`

### Requirement: Telegram Bot

The runtime MUST use grammY to handle Telegram updates.

#### Scenario: User requests random activity

- GIVEN SQLite contains active open places
- WHEN the user requests a random activity
- THEN the bot returns one suitable place with name, category, address, and
  description

#### Scenario: User enters address text

- GIVEN the user cannot share GPS location from Telegram Desktop
- WHEN the user sends a Moscow street address with house number
- THEN the bot classifies it as an exact address
- AND geocodes a normalized Moscow query
- AND accepts the result only when city, street, house number, bbox, and precision match
- AND searches places by distance from the resolved coordinates
- AND returns a nearby suitable place

#### Scenario: User enters area or landmark text

- GIVEN the user sends an area, metro, or known landmark without a house number
- WHEN it matches a known local alias
- THEN the bot resolves it without external geocoding
- AND uses a short label such as `Павелецкая`

#### Scenario: Geocoder result needs confirmation

- GIVEN the geocoder returns a plausible but not exact result
- WHEN the bot cannot fully validate the location
- THEN the bot asks the user to confirm the short label
- AND does not show the raw geocoder display name

### Requirement: Address Geocoding

The runtime MUST resolve user-entered Moscow addresses through a configurable
Nominatim-compatible geocoder.

#### Scenario: Geocode address responsibly

- GIVEN a user sends an address text message
- WHEN the address is geocoded
- THEN the request includes an application User-Agent
- AND the lookup is biased to Moscow
- AND repeated identical lookups in the same process use an in-memory cache
  instead of another external request

### Requirement: HTTP Server

The runtime MUST expose a Fastify server for health checks and optional Telegram
webhooks.

#### Scenario: Health check

- WHEN `GET /healthz` is called
- THEN the server returns an OK response

### Requirement: Structured Logs

The runtime MUST emit JSON logs with pino.

#### Scenario: Bot update handled

- WHEN a Telegram update is processed
- THEN logs include user id, chat id, command or message type, duration, and
  error details when present
