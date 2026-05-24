PRAGMA foreign_keys = ON;

ALTER TABLE categories ADD COLUMN type TEXT NOT NULL DEFAULT 'place';

CREATE TABLE IF NOT EXISTS places (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  brand_name TEXT,
  branch_name TEXT,
  description TEXT,
  description_source TEXT,
  address TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  opening_hours_text TEXT,
  opening_hours_json TEXT,
  phone TEXT,
  yandex_rating REAL,
  yandex_reviews_count INTEGER,
  yandex_maps_url TEXT,
  rating_source TEXT,
  rating_updated_at TEXT,
  geocode_provider TEXT,
  geocode_query TEXT,
  geocode_status TEXT,
  geocode_display_name TEXT,
  geocoded_at TEXT,
  source TEXT,
  source_url TEXT,
  fetched_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((latitude IS NULL AND longitude IS NULL) OR (latitude IS NOT NULL AND longitude IS NOT NULL)),
  CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
  CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180)),
  CHECK (latitude IS NULL OR geocode_status IS NOT NULL),
  CHECK (yandex_rating IS NULL OR rating_source IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_places_lat_lon ON places(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_places_active ON places(is_active);
CREATE INDEX IF NOT EXISTS idx_places_brand_name ON places(brand_name);

CREATE TABLE IF NOT EXISTS place_categories (
  place_id INTEGER NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  is_primary INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(place_id, category_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_place_categories_one_primary
ON place_categories(place_id)
WHERE is_primary = 1;

CREATE INDEX IF NOT EXISTS idx_place_categories_category_id ON place_categories(category_id);
