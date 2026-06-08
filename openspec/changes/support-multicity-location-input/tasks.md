## 1. Specs

- [x] Add multi-city text-location requirements.

## 2. Runtime

- [x] Add supported city contexts for Moscow and Krasnodar.
- [x] Add `places.city_slug` runtime metadata and import inference from coordinates.
- [x] Add persistent SQLite geocode cache with negative caching.
- [x] Make geocoder query normalization aware of supported city names.
- [x] Resolve exact and loose locations with city-specific bbox validation.
- [x] Preserve existing Moscow behavior.
- [x] Share supported city definitions between runtime and CSV validation.
- [x] Reduce bare-address fallback latency across supported cities.
- [x] Add city slug to safe location, place, route, route-replacement, random, and feedback analytics payloads.
- [x] Add city counts to `analytics:summary`.
- [x] Update user-facing copy for Moscow and Krasnodar.
- [x] Replace hard route templates with scoring profiles plus route constraints.
- [x] Add whole-route pedestrian Yandex Maps link to route output.

## 3. Tests

- [x] Add Krasnodar exact-address resolver tests.
- [x] Add geocoder normalization tests for Krasnodar.
- [x] Add tests for city-aware labels and city slug analytics.
- [x] Add persistent geocode cache tests.
- [x] Add migration/import tests for `city_slug` and `geocode_cache`.
- [x] Add Krasnodar bot-flow smoke tests for category search and route building.
- [x] Add multi-point Yandex Maps route link tests.
- [x] Add bot-flow coverage for whole-route map link.
- [x] Keep route planner regression tests green with scoring profiles.
- [x] Run targeted tests.
- [x] Run `npm run typecheck`, `npm test`, `npm run build`, and sandbox-safe CSV validation via `node --import tsx scripts/validateCsv.ts`.
- [ ] Run `npm run verify` outside the Codex sandbox if the local `tsx` CLI IPC pipe is permitted.
