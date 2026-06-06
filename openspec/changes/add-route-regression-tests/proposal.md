# Add Route Regression Tests

## Intent

Add focused route-planning regression coverage so route templates, time rules, replacement rules, and imported place data can evolve without silently producing weak or broken routes.

## Scope

- Add deterministic route-map tests for route invariants across supported durations.
- Add edge-case tests for arrival-time availability, overnight hours, weak partial routes, and replacement boundaries.
- Add smoke tests against the current imported CSV data for Moscow and Krasnodar.

## Success Criteria

- The route builder returns only routes that satisfy duration, step, distance, openness, uniqueness, and category-transition invariants.
- Replacement tests cover first, middle, and last step behavior.
- Real imported data can build short routes in both Moscow and Krasnodar.
- `npm run verify` passes.
