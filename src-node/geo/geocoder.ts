import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { AppLogger } from "../logger.js";

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
};

export type Geocoder = {
  geocode(query: string): Promise<GeocodedAddress | null>;
  search(query: string, options?: GeocodeSearchOptions): Promise<GeocodedAddress[]>;
};

type CacheRow = GeocodedAddress[];

const maxInMemoryCacheEntries = 500;

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
    private readonly logger: AppLogger
  ) {}

  async geocode(query: string): Promise<GeocodedAddress | null> {
    const results = await this.search(query, { limit: 1, layer: "address" });
    return results[0] ?? null;
  }

  async search(query: string, options: GeocodeSearchOptions = {}): Promise<GeocodedAddress[]> {
    const normalizedQuery = normalizeAddressQuery(query, this.config.GEOCODER_CITY_BIAS);
    if (!normalizedQuery) {
      return [];
    }

    const limit = Math.max(options.limit ?? 5, 1);
    const cacheKey = cacheKeyFor(normalizedQuery, options);
    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached.map((result) => ({ ...result, cached: true }));
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
    if (this.config.GEOCODER_VIEWBOX) {
      url.searchParams.set("viewbox", this.config.GEOCODER_VIEWBOX);
      url.searchParams.set("bounded", this.config.GEOCODER_BOUNDED ? "1" : "0");
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
    layer: options.layer ?? ""
  });
}

export function normalizeAddressQuery(query: string, cityBias: string): string {
  const normalized = query.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "";
  }

  const hasCity = /москв|moscow/i.test(normalized);
  return hasCity ? normalized : `${normalized}, ${cityBias}`;
}
