# Delta for Route Regression Coverage

## ADDED Requirements

### Requirement: Route Invariant Regression Tests

The test suite MUST verify route builder invariants across beta route durations.

#### Scenario: Valid routes across durations

- GIVEN a deterministic set of nearby places
- WHEN routes are built for 2, 3, 5, and 8 hours
- THEN each route satisfies minimum step count, fill ratio, max overrun, max transition walk time, open-for-visit checks, unique places, and no adjacent duplicate primary category.

### Requirement: Route Time Regression Tests

The test suite MUST verify route choices use arrival time and visit duration.

#### Scenario: Arrival-time availability

- GIVEN one candidate is open at route start but closed by arrival
- AND another candidate opens before arrival and stays open for the visit
- WHEN the route reaches that slot
- THEN the route selects the candidate that is valid at arrival.

#### Scenario: Overnight venue

- GIVEN a venue has an overnight interval with `next_day=true`
- WHEN an evening route reaches it
- THEN the venue remains eligible for the planned visit.

### Requirement: Route Replacement Regression Tests

The test suite MUST verify point replacement keeps the surrounding route coherent.

#### Scenario: Replace first or last step

- GIVEN a stored route
- WHEN the first or last step is replaced
- THEN only the selected step changes
- AND all route transitions and arrival times are recalculated.

#### Scenario: Reject bad bridge

- GIVEN a replacement candidate is too far from the previous or next route point
- WHEN replacement is attempted
- THEN replacement returns no result.

### Requirement: Imported Route Data Smoke Tests

The test suite MUST verify that current imported CSV data remains usable for routes.

#### Scenario: Short city routes from real data

- GIVEN current `data/import` is imported into SQLite
- WHEN a 2-hour route is built from central Moscow and central Krasnodar coordinates
- THEN both routes are produced and satisfy core invariants.
