# Add Krasnodar Curated Places

## Intent

Add the curated Krasnodar CSV seed to the runtime import dataset without breaking existing Moscow data, CSV validation, or SQLite import.

## Scope

- Merge Krasnodar `places` and `place_categories` into `data/import`.
- Keep the existing shared category dictionary when incoming categories match.
- Extend CSV coordinate validation from a Moscow-only bbox to supported city bboxes.
- Verify the merged dataset through CSV validation and a fresh SQLite migrate/import smoke test.

## Success Criteria

- Merged CSV contains all current Moscow places plus Krasnodar places.
- New Krasnodar external ids do not collide with existing ids.
- Every Krasnodar place has exactly one primary category.
- Coordinates are inside a supported city bbox.
- `npm run verify` passes.
