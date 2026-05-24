CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS import_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source text NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    status text NOT NULL DEFAULT 'running',
    places_seen integer NOT NULL DEFAULT 0,
    locations_seen integer NOT NULL DEFAULT 0,
    error text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS places (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source text NOT NULL,
    source_id text NOT NULL,
    title text NOT NULL,
    category text,
    source_url text NOT NULL,
    website_url text,
    is_candidate boolean NOT NULL DEFAULT false,
    active boolean NOT NULL DEFAULT true,
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source, source_id)
);

CREATE TABLE IF NOT EXISTS geocoding_cache (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider text NOT NULL,
    normalized_query text NOT NULL,
    request_query text NOT NULL,
    status text NOT NULL,
    latitude double precision,
    longitude double precision,
    confidence double precision,
    raw_response jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, normalized_query)
);

CREATE TABLE IF NOT EXISTS place_locations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    place_id uuid NOT NULL REFERENCES places(id) ON DELETE CASCADE,
    source_location_id text NOT NULL,
    address text NOT NULL,
    normalized_address text NOT NULL,
    phone text,
    hours text,
    geocoding_status text NOT NULL DEFAULT 'pending',
    geocoding_provider text,
    latitude double precision,
    longitude double precision,
    geog geography(Point, 4326),
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (place_id, source_location_id)
);

CREATE INDEX IF NOT EXISTS idx_places_source_id
    ON places (source, source_id);

CREATE INDEX IF NOT EXISTS idx_place_locations_place_id
    ON place_locations (place_id);

CREATE INDEX IF NOT EXISTS idx_place_locations_geog
    ON place_locations USING gist (geog)
    WHERE geog IS NOT NULL AND active;

CREATE INDEX IF NOT EXISTS idx_geocoding_cache_query
    ON geocoding_cache (provider, normalized_query);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS places_set_updated_at ON places;
CREATE TRIGGER places_set_updated_at
BEFORE UPDATE ON places
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS place_locations_set_updated_at ON place_locations;
CREATE TRIGGER place_locations_set_updated_at
BEFORE UPDATE ON place_locations
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS geocoding_cache_set_updated_at ON geocoding_cache;
CREATE TRIGGER geocoding_cache_set_updated_at
BEFORE UPDATE ON geocoding_cache
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION nearby_place_locations(
    user_latitude double precision,
    user_longitude double precision,
    radius_meters integer DEFAULT 1500,
    max_results integer DEFAULT 20
)
RETURNS TABLE (
    place_id uuid,
    location_id uuid,
    title text,
    category text,
    address text,
    latitude double precision,
    longitude double precision,
    distance_meters double precision,
    source_url text,
    website_url text
) AS $$
    WITH user_point AS (
        SELECT ST_SetSRID(ST_MakePoint(user_longitude, user_latitude), 4326)::geography AS geog
    )
    SELECT
        p.id,
        pl.id,
        p.title,
        p.category,
        pl.address,
        pl.latitude,
        pl.longitude,
        ST_Distance(pl.geog, user_point.geog) AS distance_meters,
        p.source_url,
        p.website_url
    FROM place_locations pl
    JOIN places p ON p.id = pl.place_id
    CROSS JOIN user_point
    WHERE p.active
      AND pl.active
      AND pl.geog IS NOT NULL
      AND ST_DWithin(pl.geog, user_point.geog, radius_meters)
    ORDER BY distance_meters ASC
    LIMIT max_results;
$$ LANGUAGE sql STABLE;

