## 1. Validate Incoming CSV

- [x] Check incoming CSV headers and row counts.
- [x] Validate schema, category refs, place refs, duplicate ids, duplicate links, primary categories, coordinates, and opening hours.

## 2. Merge Data

- [x] Append Krasnodar places to `data/import/places.csv`.
- [x] Append Krasnodar category links to `data/import/place_categories.csv`.
- [x] Keep `data/import/categories.csv` unchanged if category names match.

## 3. Validation

- [x] Extend CSV coordinate validation to supported city bboxes.
- [x] Run `npm run validate:csv`.
- [x] Run fresh SQLite `db:migrate` and `db:import` smoke test.
- [x] Run `npm run verify`.
