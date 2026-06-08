# Proposal: Support Multi-City Location Input

## Intent

Allow the bot to resolve user-entered text locations for supported cities, starting with Moscow and Krasnodar, instead of forcing every ambiguous address through a Moscow geocoder bias.

## Scope

- Add supported city contexts with label, aliases, bbox, and geocoder viewbox.
- Add explicit runtime city metadata for places and safe city-aware analytics.
- Add persistent SQLite geocode cache to reduce external geocoder calls.
- Resolve exact addresses and loose locations against the detected city context.
- Keep Moscow behavior stable for existing inputs.
- Add regression tests for Krasnodar exact address handling and geocoder query normalization.
- Soften route planning from strict templates to scoring profiles that can adapt to city density while preserving constraints.

## Success Criteria

- `Краснодар, Красная 50` is queried and validated as a Krasnodar address, not a Moscow address.
- Bare Moscow inputs like `Тверская 7` still resolve as Moscow.
- Bare supported-city inputs can fall back across supported cities and only accept results inside a supported city bbox.
- Imported places get `city_slug` when coordinates match a supported city.
- Geocoder responses are reused from persistent SQLite cache on repeated queries.
- Route analytics and summary output expose city-level success/failure signals without storing raw addresses.
- `npm run verify` passes.
