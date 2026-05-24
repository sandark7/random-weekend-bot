PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS venues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  description TEXT,
  yandex_rating REAL,
  yandex_maps_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS venue_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id INTEGER NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  address TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  opening_hours_text TEXT,
  opening_hours_json TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(venue_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_venues_category_id ON venues(category_id);
CREATE INDEX IF NOT EXISTS idx_venues_active ON venues(is_active);
CREATE INDEX IF NOT EXISTS idx_venue_locations_lat_lon ON venue_locations(lat, lon);
CREATE INDEX IF NOT EXISTS idx_venue_locations_active ON venue_locations(is_active);
