# Harden Beta Analytics and Natural Language Input

## Why

Beta usage needs product analytics that survives deploy quirks and does not store private raw identifiers or addresses. At the same time, natural-language intent parsing must not steal ordinary location input such as `Парк Горького` or `бар Стрелка`; users should still be able to type a place name as a starting point.

## What Changes

- Add explicit product requirements for privacy-safe SQLite analytics.
- Require analytics writes to be best-effort: failures are logged but never break Telegram replies.
- Require natural-language scenario parsing to activate only when the text contains a clear request marker such as `хочу`, `где`, `найди`, or `посоветуй`.
- Keep bare place names and POI-like text in the normal location resolver path.

## Impact

- Safer beta telemetry with no raw user id, chat id, raw address, or precise user coordinates in analytics payloads.
- Fewer false positives in natural-language parsing.
- More tests around analytics failure modes and natural-language/location boundaries.
