import { describe, expect, it } from "vitest";
import type { GeocodedAddress, Geocoder, GeocodeSearchOptions } from "../src-node/geo/geocoder.js";
import {
  classifyLocationInput,
  LocationResolver,
  parseExactAddress
} from "../src-node/geo/locationResolver.js";

describe("LocationResolver", () => {
  it("classifies street-and-house input as an exact address", () => {
    expect(classifyLocationInput("Тверская 7")).toBe("exact_address");
    expect(parseExactAddress("Тверская 7")).toMatchObject({
      houseNumber: "7",
      label: "Москва, Тверская улица, 7",
      queries: expect.arrayContaining([
        "Москва, Тверская улица, 7",
        "Москва, улица Тверская, 7",
        "Москва, Тверская, 7"
      ])
    });
  });

  it("does not treat metro names with years as house addresses", () => {
    expect(classifyLocationInput("метро 1905 года")).toBe("area_or_metro");
    expect(classifyLocationInput("улица 1905 года 2")).toBe("exact_address");
  });

  it("rejects a first geocoder result when the house number does not match", async () => {
    const geocoder = new FakeGeocoder([
      candidate({
        displayName: "6 с7, Тверская улица, Москва, Россия",
        lat: 55.7601,
        lon: 37.6101,
        address: {
          city: "Москва",
          road: "Тверская улица",
          house_number: "6 с7"
        }
      }),
      candidate({
        displayName: "7, Тверская улица, Москва, Россия",
        lat: 55.7597,
        lon: 37.6111,
        address: {
          city: "Москва",
          road: "Тверская улица",
          house_number: "7"
        }
      })
    ]);
    const result = await makeResolver(geocoder).resolve("Тверская 7");

    expect(geocoder.requests[0]).toMatchObject({
      query: "Москва, Тверская улица, 7",
      options: { limit: 8 }
    });
    expect(result).toMatchObject({
      status: "ok",
      confidence: "good",
      label: "Москва, Тверская улица, 7",
      lat: 55.7597,
      lon: 37.6111
    });
  });

  it("resolves an explicit Krasnodar exact address without Moscow bias", async () => {
    const geocoder = new FakeGeocoder([
      candidate({
        displayName: "50, Красная улица, Краснодар, Краснодарский край, Россия",
        lat: 45.0353,
        lon: 38.9752,
        address: {
          city: "Краснодар",
          road: "Красная улица",
          house_number: "50"
        }
      })
    ]);
    const result = await makeResolver(geocoder).resolve("Краснодар, Красная 50");

    expect(geocoder.requests[0]).toMatchObject({
      query: "Краснодар, Красная улица, 50",
      options: {
        cityBias: "Краснодар",
        viewbox: "38.75,45.20,39.25,44.85",
        bounded: true,
        limit: 8
      }
    });
    expect(geocoder.requests.map((request) => request.query).join("\n")).not.toContain("Москва");
    expect(result).toMatchObject({
      status: "ok",
      confidence: "good",
      label: "Краснодар, Красная улица, 50",
      lat: 45.0353,
      lon: 38.9752,
      citySlug: "krasnodar"
    });
  });

  it("can fall back from Moscow to Krasnodar for a bare supported-city address", async () => {
    const geocoder = new FakeGeocoder({
      "Краснодар, Красная улица, 50": [
        candidate({
          displayName: "50, Красная улица, Краснодар, Краснодарский край, Россия",
          lat: 45.0353,
          lon: 38.9752,
          address: {
            city: "Краснодар",
            road: "Красная улица",
            house_number: "50"
          }
        })
      ]
    });
    const result = await makeResolver(geocoder).resolve("Красная 50");

    expect(geocoder.requests.some((request) => request.query === "Москва, Красная улица, 50")).toBe(true);
    expect(geocoder.requests.some((request) => request.query === "Краснодар, Красная улица, 50")).toBe(true);
    expect(geocoder.requests.slice(0, 2).map((request) => request.query)).toEqual([
      "Москва, Красная улица, 50",
      "Краснодар, Красная улица, 50"
    ]);
    expect(result).toMatchObject({
      status: "ok",
      confidence: "good",
      label: "Краснодар, Красная улица, 50",
      citySlug: "krasnodar"
    });
  });

  it("fails exact addresses when only a different house is found", async () => {
    const geocoder = new FakeGeocoder([
      candidate({
        displayName: "6 с7, Тверская улица, Москва, Россия",
        address: {
          city: "Москва",
          road: "Тверская улица",
          house_number: "6 с7"
        }
      })
    ]);
    const result = await makeResolver(geocoder).resolve("Тверская 7");

    expect(result).toMatchObject({
      status: "failed",
      confidence: "low",
      kind: "exact_address"
    });
  });

  it("accepts a building suffix when the user entered the base house number", async () => {
    const geocoder = new FakeGeocoder([
      candidate({
        displayName: "17 с1, улица Покровка, Москва, Россия",
        address: {
          city: "Москва",
          road: "улица Покровка",
          house_number: "17 с1"
        }
      })
    ]);
    const result = await makeResolver(geocoder).resolve("Покровка 17");

    expect(result).toMatchObject({
      status: "ok",
      confidence: "good",
      label: "Москва, улица Покровка, 17 с1"
    });
  });

  it("asks for confirmation when an exact address result has no house number", async () => {
    const geocoder = new FakeGeocoder([
      candidate({
        displayName: "Тверская улица, Москва, Россия",
        address: {
          city: "Москва",
          road: "Тверская улица"
        }
      })
    ]);
    const result = await makeResolver(geocoder).resolve("Тверская 7");

    expect(result).toMatchObject({
      status: "needs_confirmation",
      confidence: "medium",
      label: "Москва, Тверская улица"
    });
  });

  it("uses known locations before geocoding area input", async () => {
    const geocoder = new FakeGeocoder([]);
    const result = await makeResolver(geocoder).resolve("Павелецкая");

    expect(result).toMatchObject({
      status: "ok",
      confidence: "good",
      kind: "area_or_metro",
      label: "Павелецкая"
    });
    expect(geocoder.requests).toEqual([]);
  });

  it("returns a short label for loose geocoder matches", async () => {
    const geocoder = new FakeGeocoder([
      candidate({
        displayName: "Some long raw address, район Арбат, Москва, Россия",
        name: "Some POI",
        address: {
          city: "Москва",
          amenity: "Some POI"
        }
      })
    ]);
    const result = await makeResolver(geocoder).resolve("Some POI");

    expect(result).toMatchObject({
      status: "needs_confirmation",
      label: "Москва, Some POI",
      citySlug: "moscow"
    });
  });

  it("uses detected city context for loose Krasnodar locations", async () => {
    const geocoder = new FakeGeocoder([
      candidate({
        displayName: "Парк Краснодар, Краснодар, Краснодарский край, Россия",
        name: "Парк Краснодар",
        lat: 45.0421,
        lon: 39.0321,
        address: {
          city: "Краснодар",
          leisure: "Парк Краснодар"
        }
      })
    ]);
    const result = await makeResolver(geocoder).resolve("Краснодар парк Галицкого");

    expect(geocoder.requests[0]).toMatchObject({
      query: "Краснодар, парк Галицкого",
      options: {
        cityBias: "Краснодар",
        viewbox: "38.75,45.20,39.25,44.85",
        bounded: true,
        limit: 3
      }
    });
    expect(result).toMatchObject({
      status: "needs_confirmation",
      confidence: "medium",
      label: "Парк Краснодар",
      citySlug: "krasnodar"
    });
  });
});

class FakeGeocoder implements Geocoder {
  readonly requests: Array<{ query: string; options?: GeocodeSearchOptions }> = [];

  constructor(private readonly results: GeocodedAddress[] | Record<string, GeocodedAddress[]>) {}

  async geocode(query: string): Promise<GeocodedAddress | null> {
    return (await this.search(query, { limit: 1 }))[0] ?? null;
  }

  async search(query: string, options?: GeocodeSearchOptions): Promise<GeocodedAddress[]> {
    this.requests.push({ query, options });
    if (Array.isArray(this.results)) {
      return this.results;
    }

    return this.results[query] ?? [];
  }
}

function makeResolver(geocoder: Geocoder): LocationResolver {
  return new LocationResolver(geocoder, {
    GEOCODER_CITY_BIAS: "Москва",
    GEOCODER_VIEWBOX: "37.15,56.05,38.10,55.45"
  });
}

function candidate(overrides: Partial<GeocodedAddress>): GeocodedAddress {
  return {
    query: "query",
    displayName: "7, Тверская улица, Москва, Россия",
    lat: 55.7597,
    lon: 37.6111,
    cached: false,
    category: "building",
    type: "yes",
    addresstype: "building",
    address: {
      city: "Москва",
      road: "Тверская улица",
      house_number: "7"
    },
    ...overrides
  };
}
