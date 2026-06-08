import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import type { AppConfig } from "../src-node/config.js";
import { NominatimGeocoder, normalizeAddressQuery } from "../src-node/geo/geocoder.js";
import { createLogger } from "../src-node/logger.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("geocoder", () => {
  it("adds Moscow city bias when the user writes only street and house", () => {
    expect(normalizeAddressQuery("Тверская 7", "Москва")).toBe("Тверская 7, Москва");
    expect(normalizeAddressQuery("Тверская 7, Москва", "Москва")).toBe("Тверская 7, Москва");
  });

  it("keeps explicit Krasnodar queries and can add Krasnodar bias", () => {
    expect(normalizeAddressQuery("Красная 50, Краснодар", "Москва")).toBe("Красная 50, Краснодар");
    expect(normalizeAddressQuery("Красная 50", "Краснодар")).toBe("Красная 50, Краснодар");
    expect(normalizeAddressQuery("Краснодарская 5", "Краснодар")).toBe("Краснодарская 5, Краснодар");
  });

  it("geocodes via Nominatim-compatible API and caches repeated lookups", async () => {
    const config = makeConfig();

    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify([
          {
            display_name: "7, Тверская улица, Тверской район, Москва, Россия",
            lat: "55.759700",
            lon: "37.611100"
          }
        ]),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const geocoder = new NominatimGeocoder(config, createLogger(config));
    const first = await geocoder.geocode("Тверская 7");
    const second = await geocoder.geocode("Тверская 7");

    expect(first).toMatchObject({
      query: "Тверская 7, Москва",
      lat: 55.7597,
      lon: 37.6111,
      cached: false
    });
    expect(second).toMatchObject({
      cached: true,
      lat: 55.7597,
      lon: 37.6111
    });
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.searchParams.get("q")).toBe("Тверская 7, Москва");
    expect(url.searchParams.get("countrycodes")).toBe("ru");
    expect(init.headers).toMatchObject({
      "User-Agent": "random-weekend-bot-test/0.2"
    });
  });

  it("uses per-request city bias and viewbox", async () => {
    const config = makeConfig();

    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify([
          {
            display_name: "50, Красная улица, Краснодар, Краснодарский край, Россия",
            lat: "45.035300",
            lon: "38.975200"
          }
        ]),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const geocoder = new NominatimGeocoder(config, createLogger(config));
    const result = await geocoder.search("Красная 50", {
      limit: 3,
      cityBias: "Краснодар",
      viewbox: "38.75,45.20,39.25,44.85",
      bounded: true
    });

    expect(result[0]).toMatchObject({
      query: "Красная 50, Краснодар",
      lat: 45.0353,
      lon: 38.9752
    });

    const [url] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.searchParams.get("q")).toBe("Красная 50, Краснодар");
    expect(url.searchParams.get("viewbox")).toBe("38.75,45.20,39.25,44.85");
    expect(url.searchParams.get("bounded")).toBe("1");
  });

  it("persists successful geocode results in SQLite between geocoder instances", async () => {
    const config = makeConfig();
    const db = createGeocodeCacheDatabase();

    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify([
          {
            display_name: "50, Красная улица, Краснодар, Краснодарский край, Россия",
            lat: "45.035300",
            lon: "38.975200"
          }
        ]),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const firstGeocoder = new NominatimGeocoder(config, createLogger(config), db);
    const first = await firstGeocoder.search("Красная 50", {
      limit: 3,
      cityBias: "Краснодар",
      citySlug: "krasnodar",
      viewbox: "38.75,45.20,39.25,44.85",
      bounded: true
    });

    const secondGeocoder = new NominatimGeocoder(config, createLogger(config), db);
    const second = await secondGeocoder.search("Красная 50", {
      limit: 3,
      cityBias: "Краснодар",
      citySlug: "krasnodar",
      viewbox: "38.75,45.20,39.25,44.85",
      bounded: true
    });

    expect(first[0]).toMatchObject({ cached: false, lat: 45.0353 });
    expect(second[0]).toMatchObject({ cached: true, lat: 45.0353 });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(db.prepare("SELECT status, city_slug AS citySlug FROM geocode_cache").get()).toEqual({
      status: "ok",
      citySlug: "krasnodar"
    });

    db.close();
  });

  it("persists empty geocoder results as negative cache", async () => {
    const config = makeConfig();
    const db = createGeocodeCacheDatabase();
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const geocoder = new NominatimGeocoder(config, createLogger(config), db);
    expect(await geocoder.search("Несуществующее место 123")).toEqual([]);
    expect(await geocoder.search("Несуществующее место 123")).toEqual([]);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(db.prepare("SELECT status FROM geocode_cache").get()).toEqual({ status: "not_found" });

    db.close();
  });
});

function createGeocodeCacheDatabase(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE geocode_cache (
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
  `);
  return db;
}

function makeConfig(): AppConfig {
  return {
    NODE_ENV: "test",
    BOT_TOKEN: "test-token",
    BOT_MODE: "polling",
    HOST: "127.0.0.1",
    PORT: 3000,
    DATABASE_PATH: ":memory:",
    IMPORT_DIR: "data/import",
    SEARCH_RADIUS_METERS: 1500,
    GEOCODER_URL: "https://nominatim.openstreetmap.org/search",
    GEOCODER_USER_AGENT: "random-weekend-bot-test/0.2",
    GEOCODER_ACCEPT_LANGUAGE: "ru",
    GEOCODER_COUNTRY_CODES: "ru",
    GEOCODER_CITY_BIAS: "Москва",
    GEOCODER_VIEWBOX: "37.15,56.05,38.10,55.45",
    GEOCODER_BOUNDED: true,
    GEOCODER_TIMEOUT_MS: 5000,
    GEOCODER_MIN_INTERVAL_MS: 0,
    MAX_TEXT_INPUT_LENGTH: 300,
    CHAT_COOLDOWN_MS: 0,
    ANALYTICS_ENABLED: false,
    ANALYTICS_SALT: undefined,
    APP_VERSION: "test",
    LOG_LEVEL: "silent"
  };
}
