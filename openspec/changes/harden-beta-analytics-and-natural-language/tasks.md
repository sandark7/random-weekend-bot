## 1. Natural Language Input

- [x] Specify that natural-language intent parsing requires an explicit request marker.
- [x] Add parser tests for valid intent + location phrases.
- [x] Add parser tests proving bare locations and POI names stay out of intent parsing.
- [x] Add bot-flow tests proving bare POI text goes to the location resolver unchanged.

## 2. Product Analytics

- [x] Specify privacy-safe analytics payloads.
- [x] Specify best-effort analytics writes that do not break user flows.
- [x] Add analytics tests for hashing, sanitization, disabled mode, missing salt, and missing table behavior.
- [x] Keep a single analytics migration.

## 3. Verification

- [x] Run typecheck.
- [x] Run tests.
- [x] Run build.
- [x] Run CSV validation.

## 4. Beta State Hardening

- [x] Ignore expired location confirmations within the same message update.
- [x] Keep route construction and route replacement out of `recentPlaceIds`.
- [x] Remove hidden fixed-first-step route flow from beta code paths.
- [x] Sanitize location technical logs so they do not include raw address labels or exact coordinates.
- [x] Make nearby SQL selection deterministic before the JS distance filter.
- [x] Add regression tests for stale confirmations, route recent-history isolation, and beta route keyboard behavior.
