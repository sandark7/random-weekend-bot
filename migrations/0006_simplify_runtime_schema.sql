PRAGMA foreign_keys = ON;

CREATE TABLE places_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  address TEXT,
  latitude REAL,
  longitude REAL,
  opening_hours_text TEXT,
  opening_hours_json TEXT,
  source TEXT,
  source_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((latitude IS NULL AND longitude IS NULL) OR (latitude IS NOT NULL AND longitude IS NOT NULL)),
  CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
  CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180))
);

INSERT INTO places_new (
  id,
  external_id,
  display_name,
  description,
  address,
  latitude,
  longitude,
  opening_hours_text,
  opening_hours_json,
  source,
  source_url,
  is_active,
  created_at,
  updated_at
)
SELECT
  id,
  external_id,
  display_name,
  description,
  address,
  latitude,
  longitude,
  opening_hours_text,
  opening_hours_json,
  source,
  source_url,
  is_active,
  created_at,
  updated_at
FROM places;

CREATE TEMP TABLE place_categories_copy AS
SELECT pc.place_id, pc.category_id, pc.is_primary
FROM place_categories pc
JOIN places p ON p.id = pc.place_id
JOIN categories c ON c.id = pc.category_id;

DROP TABLE place_categories;
DROP TABLE places;

ALTER TABLE places_new RENAME TO places;

CREATE TABLE place_categories (
  place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  is_primary INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(place_id, category_id)
);

INSERT INTO place_categories (place_id, category_id, is_primary)
SELECT place_id, category_id, is_primary
FROM place_categories_copy;

DROP TABLE place_categories_copy;

CREATE INDEX idx_places_active ON places(is_active);
CREATE INDEX idx_places_lat_lon ON places(latitude, longitude);
CREATE INDEX idx_place_categories_category_id ON place_categories(category_id);

CREATE UNIQUE INDEX idx_place_categories_one_primary
ON place_categories(place_id)
WHERE is_primary = 1;
