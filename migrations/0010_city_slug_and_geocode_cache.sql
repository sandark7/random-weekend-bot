ALTER TABLE places ADD COLUMN city_slug TEXT;

UPDATE places
SET city_slug = CASE
  WHEN latitude BETWEEN 55.45 AND 56.05 AND longitude BETWEEN 37.15 AND 38.10 THEN 'moscow'
  WHEN latitude BETWEEN 44.85 AND 45.20 AND longitude BETWEEN 38.75 AND 39.25 THEN 'krasnodar'
  ELSE NULL
END
WHERE city_slug IS NULL;

CREATE INDEX IF NOT EXISTS idx_places_city_slug ON places(city_slug);

CREATE TABLE IF NOT EXISTS geocode_cache (
  provider TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  query TEXT NOT NULL,
  city_slug TEXT,
  status TEXT NOT NULL CHECK(status IN ('ok', 'not_found')),
  results_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(provider, cache_key)
);

CREATE INDEX IF NOT EXISTS idx_geocode_cache_city_slug
ON geocode_cache(city_slug);

CREATE INDEX IF NOT EXISTS idx_geocode_cache_last_used_at
ON geocode_cache(last_used_at);

CREATE INDEX IF NOT EXISTS idx_geocode_cache_status
ON geocode_cache(status);
