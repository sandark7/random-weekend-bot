import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRoute } from "../src-node/bot/createBot.js";
import type { PlaceRepository } from "../src-node/db/placeRepository.js";
import type { PlaceSuggestion } from "../src-node/shared/types.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("route planner", () => {
  it("does not use drink categories in the morning", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const route = buildRoute(makeCategoryRepo(), {
      start: { lat: 55.75, lon: 37.61 },
      radiusMeters: 1500,
      now: new Date("2026-05-24T06:00:00Z"),
      excludePlaceIds: [],
      durationHours: 2
    });

    expect(route).not.toBeNull();
    expect(route?.flatMap((step) => step.suggestion.categories.map((category) => category.slug))).not.toEqual(
      expect.arrayContaining(["bar", "cocktail_bar", "wine_bar", "pub"])
    );
  });

  it("does not use breakfast places in the evening", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const route = buildRoute(makeCategoryRepo(), {
      start: { lat: 55.75, lon: 37.61 },
      radiusMeters: 1500,
      now: new Date("2026-05-24T16:00:00Z"),
      excludePlaceIds: [],
      durationHours: 2
    });

    expect(route).not.toBeNull();
    expect(route?.flatMap((step) => step.suggestion.categories.map((category) => category.slug))).not.toContain(
      "breakfast"
    );
  });

  it("does not repeat the same primary category consecutively", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const route = buildRoute(makeCategoryRepo(), {
      start: { lat: 55.75, lon: 37.61 },
      radiusMeters: 1500,
      now: new Date("2026-05-24T12:00:00Z"),
      excludePlaceIds: [],
      durationHours: 5
    });

    expect(route).not.toBeNull();
    for (let index = 1; index < (route?.length ?? 0); index += 1) {
      expect(route?.[index]?.suggestion.categories[0]?.slug).not.toBe(route?.[index - 1]?.suggestion.categories[0]?.slug);
    }
  });

  it("filters transitions longer than twenty walking minutes", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    let nextPlaceId = 1;
    const repo = {
      findNearby: (options: { lat: number; lon: number; categorySlug?: string }) => [
        makeSuggestion({
          placeId: nextPlaceId++,
          slug: options.categorySlug ?? "restaurant",
          lat: options.lat + 0.05,
          lon: options.lon + 0.05,
          distanceMeters: 2_000
        }),
        makeSuggestion({
          placeId: nextPlaceId++,
          slug: options.categorySlug ?? "restaurant",
          lat: options.lat + 0.001,
          lon: options.lon + 0.001,
          distanceMeters: 800
        })
      ]
    } as unknown as PlaceRepository;

    const route = buildRoute(repo, {
      start: { lat: 55.75, lon: 37.61 },
      radiusMeters: 3000,
      now: new Date("2026-05-24T12:00:00Z"),
      excludePlaceIds: [],
      durationHours: 2
    });

    expect(route).not.toBeNull();
    expect(route?.every((step) => step.walkMinutes <= 20)).toBe(true);
    expect(route?.every((step) => step.suggestion.distanceMeters <= 1600)).toBe(true);
  });

  it("uses the previous picked place as the origin for the next route step", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    let nextPlaceId = 1;
    const repo = {
      findNearby: (options: { lat: number; lon: number; categorySlug?: string }) => [
        makeSuggestion({
          placeId: nextPlaceId++,
          slug: options.categorySlug ?? "restaurant",
          lat: options.lat + 0.001,
          lon: options.lon + 0.001
        })
      ]
    } as unknown as PlaceRepository;

    const start = { lat: 55.75, lon: 37.61 };
    const route = buildRoute(repo, {
      start,
      radiusMeters: 1500,
      now: new Date("2026-05-24T14:00:00Z"),
      excludePlaceIds: [],
      durationHours: 3
    });

    expect(route).not.toBeNull();
    expect(route?.length).toBeGreaterThan(1);
    expect(route?.[0]?.origin).toEqual(start);
    expect(route?.[1]?.origin).toEqual({
      lat: route?.[0]?.suggestion.lat,
      lon: route?.[0]?.suggestion.lon
    });
  });
});

function makeCategoryRepo(): PlaceRepository {
  let nextPlaceId = 1;
  return {
    findNearby: (options: { lat: number; lon: number; categorySlug?: string }) => [
      makeSuggestion({
        placeId: nextPlaceId++,
        slug: options.categorySlug ?? "restaurant",
        lat: options.lat + 0.001,
        lon: options.lon + 0.001
      })
    ]
  } as unknown as PlaceRepository;
}

function makeSuggestion(options: {
  placeId: number;
  slug: string;
  lat: number;
  lon: number;
  distanceMeters?: number;
}): PlaceSuggestion {
  return {
    placeId: options.placeId,
    name: `Place ${options.placeId}`,
    categories: [{ slug: options.slug, name: options.slug, isPrimary: true }],
    description: "Описание",
    address: "Адрес",
    lat: options.lat,
    lon: options.lon,
    distanceMeters: options.distanceMeters ?? 100,
    openingHoursText: "Ежедневно 00:00-23:59",
    openingHoursJson: {
      timezone: "Europe/Moscow",
      weekly: {
        sun: [{ from: "00:00", to: "23:59" }]
      }
    }
  };
}
