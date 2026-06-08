import { z } from "zod";
import type Database from "better-sqlite3";
import type { AppConfig } from "../config.js";
import type { AppLogger } from "../logger.js";
import {
  containsComparablePhrase,
  findSupportedCityByName,
  hasSupportedCityName,
  normalizeCityComparable,
  type SupportedCityId
} from "./supportedCities.js";

export type GeocodedAddress = {
  query: string;
  displayName: string;
  lat: number;
  lon: number;
  cached: boolean;
  name?: string;
  category?: string;
  type?: string;
  addresstype?: string;
  address?: Record<string, string>;
};

export type GeocodeSearchOptions = {
  limit?: number;
  layer?: string;
  cityBias?: string;
  citySlug?: SupportedCityId;
  viewbox?: string | null;
  bounded?: boolean;
};

export type Geocoder = {
  geocode(query: string): Promise<GeocodedAddress | null>;
  search(query: string, options?: GeocodeSearchOptions): Promise<GeocodedAddress[]>;
};

type CacheRow = GeocodedAddress[];

const maxInMemoryCacheEntries = 500;
const GEOCODE_CACHE_PROVIDER = "nominatim";

const nominatimResultSchema = z
  .object({
    display_name: z.string().min(1),
    lat: z.string().min(1),
    lon: z.string().min(1),
    name: z.string().optional(),
    category: z.string().optional(),
    type: z.string().optional(),
    addresstype: z.string().optional(),
    address: z.record(z.string(), z.string()).optional()
  })
  .passthrough();

const nominatimResponseSchema = z.array(nominatimResultSchema);

export class NominatimGeocoder implements Geocoder {
  private lastRequestAt = 0;
  private readonly cache = new Map<string, CacheRow>();
  private readonly persistentCache: PersistentGeocodeCache | null;

  constructor(
    private readonly config: Pick<
      AppConfig,
      | "GEOCODER_URL"
      | "GEOCODER_USER_AGENT"
      | "GEOCODER_ACCEPT_LANGUAGE"
      | "GEOCODER_COUNTRY_CODES"
      | "GEOCODER_CITY_BIAS"
      | "GEOCODER_VIEWBOX"
      | "GEOCODER_BOUNDED"
      | "GEOCODER_TIMEOUT_MS"
      | "GEOCODER_MIN_INTERVAL_MS"
    >,
    private readonly logger: AppLogger,
    cacheDb?: Database.Database
  ) {
    this.persistentCache = cacheDb ? createPersistentGeocodeCache(cacheDb, logger) : null;
  }

  async geocode(query: string): Promise<GeocodedAddress | null> {
    const results = await this.search(query, { limit: 1, layer: "address" });
    return results[0] ?? null;
  }

  async search(query: string, options: GeocodeSearchOptions = {}): Promise<GeocodedAddress[]> {
    const cityBias = options.cityBias ?? this.config.GEOCODER_CITY_BIAS;
    const normalizedQuery = normalizeAddressQuery(query, cityBias);
    if (!normalizedQuery) {
      return [];
    }

    const limit = Math.max(options.limit ?? 5, 1);
    const cacheOptions = {
      ...options,
      cityBias,
      citySlug: options.citySlug ?? findSupportedCityByName(cityBias)?.id
    };
    const cacheKey = cacheKeyFor(normalizedQuery, cacheOptions);
    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached.map((result) => ({ ...result, cached: true }));
    }
    const persistentCached = this.persistentCache?.get(cacheKey);
    if (persistentCached) {
      this.saveCached(cacheKey, persistentCached);
      return persistentCached.map((result) => ({ ...result, cached: true }));
    }

    await this.waitForRateLimit();

    const url = new URL(this.config.GEOCODER_URL);
    url.searchParams.set("q", normalizedQuery);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("accept-language", this.config.GEOCODER_ACCEPT_LANGUAGE);

    if (options.layer) {
      url.searchParams.set("layer", options.layer);
    }

    if (this.config.GEOCODER_COUNTRY_CODES) {
      url.searchParams.set("countrycodes", this.config.GEOCODER_COUNTRY_CODES);
    }
    const viewbox = options.viewbox === null
      ? null
      : options.viewbox ?? this.config.GEOCODER_VIEWBOX;
    if (viewbox) {
      url.searchParams.set("viewbox", viewbox);
      url.searchParams.set("bounded", (options.bounded ?? this.config.GEOCODER_BOUNDED) ? "1" : "0");
    }

    const response = await fetch(url, {
      headers: {
        "User-Agent": this.config.GEOCODER_USER_AGENT,
        "Accept-Language": this.config.GEOCODER_ACCEPT_LANGUAGE
      },
      signal: AbortSignal.timeout(this.config.GEOCODER_TIMEOUT_MS)
    });
    this.lastRequestAt = Date.now();

    if (!response.ok) {
      this.logger.warn({ statusCode: response.status, query: normalizedQuery }, "geocoder_http_error");
      return [];
    }

    const payload = nominatimResponseSchema.parse(await response.json());
    if (payload.length === 0) {
      this.logger.info({ query: normalizedQuery }, "geocoder_no_results");
      this.saveCached(cacheKey, []);
      this.persistentCache?.save({
        cacheKey,
        query: normalizedQuery,
        citySlug: cacheOptions.citySlug ?? null,
        status: "not_found",
        results: []
      });
      return [];
    }

    const results = payload.flatMap((item) => {
      const lat = Number(item.lat);
      const lon = Number(item.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        this.logger.warn({ query: normalizedQuery, lat: item.lat, lon: item.lon }, "geocoder_invalid_coordinates");
        return [];
      }

      return [{
        query: normalizedQuery,
        displayName: item.display_name,
        lat,
        lon,
        cached: false,
        name: item.name,
        category: item.category,
        type: item.type,
        addresstype: item.addresstype,
        address: item.address
      }];
    });

    this.saveCached(cacheKey, results);
    this.persistentCache?.save({
      cacheKey,
      query: normalizedQuery,
      citySlug: cacheOptions.citySlug ?? null,
      status: "ok",
      results
    });
    return results;
  }

  private getCached(query: string): CacheRow | null {
    return this.cache.get(query) ?? null;
  }

  private saveCached(query: string, results: GeocodedAddress[]): void {
    if (!this.cache.has(query) && this.cache.size >= maxInMemoryCacheEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(query, results);
  }

  private async waitForRateLimit(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    const waitMs = this.config.GEOCODER_MIN_INTERVAL_MS - elapsed;
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

function cacheKeyFor(query: string, options: GeocodeSearchOptions): string {
  return JSON.stringify({
    query,
    limit: options.limit ?? 5,
    layer: options.layer ?? "",
    cityBias: options.cityBias ?? "",
    citySlug: options.citySlug ?? "",
    viewbox: options.viewbox ?? "",
    bounded: options.bounded ?? ""
  });
}

type PersistentCacheStatus = "ok" | "not_found";

type PersistentCacheRow = {
  status: PersistentCacheStatus;
  results_json: string;
};

class PersistentGeocodeCache {
  private readonly selectStatement: Database.Statement;
  private readonly touchStatement: Database.Statement;
  private readonly upsertStatement: Database.Statement;

  constructor(
    private readonly db: Database.Database,
    private readonly logger: AppLogger
  ) {
    this.selectStatement = this.db.prepare(`
      SELECT status, results_json
      FROM geocode_cache
      WHERE provider = ? AND cache_key = ?
    `);
    this.touchStatement = this.db.prepare(`
      UPDATE geocode_cache
      SET last_used_at = CURRENT_TIMESTAMP
      WHERE provider = ? AND cache_key = ?
    `);
    this.upsertStatement = this.db.prepare(`
      INSERT INTO geocode_cache (
        provider,
        cache_key,
        query,
        city_slug,
        status,
        results_json,
        created_at,
        updated_at,
        last_used_at
      )
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(provider, cache_key) DO UPDATE SET
        query = excluded.query,
        city_slug = excluded.city_slug,
        status = excluded.status,
        results_json = excluded.results_json,
        updated_at = CURRENT_TIMESTAMP,
        last_used_at = CURRENT_TIMESTAMP
    `);
  }

  get(cacheKey: string): GeocodedAddress[] | null {
    try {
      const row = this.selectStatement.get(GEOCODE_CACHE_PROVIDER, cacheKey) as PersistentCacheRow | undefined;
      if (!row) {
        return null;
      }

      this.touchStatement.run(GEOCODE_CACHE_PROVIDER, cacheKey);
      if (row.status === "not_found") {
        return [];
      }

      const parsed = JSON.parse(row.results_json) as GeocodedAddress[];
      return parsed.map((result) => ({ ...result, cached: true }));
    } catch (error) {
      this.logger.warn({ error }, "geocode_cache_read_failed");
      return null;
    }
  }

  save(options: {
    cacheKey: string;
    query: string;
    citySlug: SupportedCityId | null;
    status: PersistentCacheStatus;
    results: GeocodedAddress[];
  }): void {
    try {
      this.upsertStatement.run(
        GEOCODE_CACHE_PROVIDER,
        options.cacheKey,
        options.query,
        options.citySlug,
        options.status,
        JSON.stringify(options.results.map((result) => ({ ...result, cached: false })))
      );
    } catch (error) {
      this.logger.warn({ error }, "geocode_cache_write_failed");
    }
  }
}

function createPersistentGeocodeCache(
  db: Database.Database,
  logger: AppLogger
): PersistentGeocodeCache | null {
  try {
    return new PersistentGeocodeCache(db, logger);
  } catch (error) {
    logger.warn({ error }, "geocode_cache_init_failed");
    return null;
  }
}

export function normalizeAddressQuery(query: string, cityBias: string): string {
  const normalized = query.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }

  const comparable = normalizeComparable(normalized);
  const hasCity = hasSupportedCityName(comparable) ||
    containsComparablePhrase(comparable, normalizeCityComparable(cityBias));
  return hasCity ? normalized : `${normalized}, ${cityBias}`;
}

function normalizeComparable(value: string): string {
  return normalizeCityComparable(value);
}
