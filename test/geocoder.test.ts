import { afterEach, describe, expect, it, vi } from "vitest";
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
});

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
    LOG_LEVEL: "silent"
  };
}
