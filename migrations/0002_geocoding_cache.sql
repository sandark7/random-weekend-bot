PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS geocoding_cache (
  provider TEXT NOT NULL,
  query TEXT NOT NULL,
  display_name TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(provider, query)
);

CREATE INDEX IF NOT EXISTS idx_geocoding_cache_last_used_at ON geocoding_cache(last_used_at);
