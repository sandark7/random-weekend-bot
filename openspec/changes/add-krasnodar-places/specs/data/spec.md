# Delta for Multi-City Import Data

## ADDED Requirements

### Requirement: Supported City Coordinates

CSV validation MUST accept coordinates for supported city datasets, not only Moscow.

Supported city bboxes include:

- Moscow: lat `55.45..56.05`, lon `37.15..38.10`
- Krasnodar: lat `44.85..45.20`, lon `38.75..39.25`

#### Scenario: Validate Krasnodar places

- GIVEN `places.csv` contains a Krasnodar place
- AND its coordinates are inside the Krasnodar bbox
- WHEN CSV validation runs
- THEN the coordinate check passes

### Requirement: Curated Krasnodar Places

The runtime import dataset MAY include curated Krasnodar places when they follow the same physical-place and category-link rules as Moscow places.

#### Scenario: Merge Krasnodar place rows

- GIVEN incoming Krasnodar places have unique `external_id` values
- AND every place has valid coordinates, opening hours JSON, source fields, and category links
- WHEN they are merged into `data/import`
- THEN the merged dataset remains importable into SQLite
- AND every place still has exactly one primary category
