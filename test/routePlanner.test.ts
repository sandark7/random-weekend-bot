import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlaceRepository } from "../src-node/db/placeRepository.js";
import { buildRoute } from "../src-node/recommendation/routeBuilder.js";
import {
  MAX_ROUTE_TRANSITION_METERS,
  placeVisitDurationMinutes,
  routeCandidateAllowed,
  routeDuration,
  walkingMinutes
} from "../src-node/recommendation/routeRules.js";
import { PLACE_SCENARIOS } from "../src-node/recommendation/scenarios.js";
import type { PlaceSuggestion } from "../src-node/shared/types.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("route planner", () => {
  it("uses primary category duration instead of scenario duration", () => {
    const landmark = makeSuggestion({ placeId: 1, slug: "landmark", lat: 55.75, lon: 37.61 });
    const viewpoint = makeSuggestion({ placeId: 2, slug: "viewpoint", lat: 55.75, lon: 37.61 });
    const culture = makeSuggestion({ placeId: 3, slug: "culture", lat: 55.75, lon: 37.61 });
    const park = makeSuggestion({ placeId: 4, slug: "park", lat: 55.75, lon: 37.61 });

    expect(placeVisitDurationMinutes(landmark)).toBe(20);
    expect(placeVisitDurationMinutes(viewpoint)).toBe(20);
    expect(placeVisitDurationMinutes(culture)).toBe(90);
    expect(placeVisitDurationMinutes(park)).toBe(45);
    expect(routeDuration([
      {
        scenario: PLACE_SCENARIOS.see,
        suggestion: landmark,
        walkMinutes: 5,
        visitDurationMinutes: placeVisitDurationMinutes(landmark)
      }
    ])).toBe(25);
  });

  it("keeps transition radius aligned with walking time model", () => {
    expect(MAX_ROUTE_TRANSITION_METERS).toBe(1120);
    expect(walkingMinutes(MAX_ROUTE_TRANSITION_METERS)).toBeLessThanOrEqual(20);
  });

  it("does not start a route with drinks even in the evening", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const route = buildRoute(makeCategoryRepo(), {
      start: { lat: 55.75, lon: 37.61 },
      radiusMeters: 1500,
      now: new Date("2026-05-24T16:00:00Z"),
      excludePlaceIds: [],
      durationHours: 2
    });

    expect(route).not.toBeNull();
    expect(route?.[0]?.scenario.key).not.toBe("drink");
  });

  it("does not allow drink places before 17:00", () => {
    const bar = makeSuggestion({ placeId: 1, slug: "bar", lat: 55.75, lon: 37.61 });
    const state = {
      lastPrimaryCategory: null,
      usedFineDining: 0,
      usedBathhouse: 0
    };

    expect(routeCandidateAllowed(bar, new Date("2026-05-24T13:59:00Z"), state)).toBe(false);
    expect(routeCandidateAllowed(bar, new Date("2026-05-24T14:00:00Z"), state)).toBe(true);
  });

  it("does not allow breakfast places after 14:00", () => {
    const breakfast = makeSuggestion({ placeId: 1, slug: "breakfast", lat: 55.75, lon: 37.61 });
    const state = {
      lastPrimaryCategory: null,
      usedFineDining: 0,
      usedBathhouse: 0
    };

    expect(routeCandidateAllowed(breakfast, new Date("2026-05-24T10:59:00Z"), state)).toBe(true);
    expect(routeCandidateAllowed(breakfast, new Date("2026-05-24T11:00:00Z"), state)).toBe(false);
  });

  it("does not skip early template slots and start a five-hour route with food", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const route = buildRoute(makeCategoryRepo({ unavailableCategories: ["coffee", "breakfast", "quick_bite"] }), {
      start: { lat: 55.75, lon: 37.61 },
      radiusMeters: 1500,
      now: new Date("2026-05-24T10:00:00Z"),
      excludePlaceIds: [],
      durationHours: 5
    });

    expect(route).not.toBeNull();
    expect(route?.[0]?.scenario.key).not.toBe("eat");
  });

  it("keeps drinks as a route ending, not a middle beat", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const route = buildRoute(makeCategoryRepo({ unavailableCategories: ["culture"] }), {
      start: { lat: 55.75, lon: 37.61 },
      radiusMeters: 1500,
      now: new Date("2026-05-24T11:00:00Z"),
      excludePlaceIds: [],
      durationHours: 5
    });

    expect(route).not.toBeNull();
    const drinkIndex = route?.findIndex((step) => step.scenario.key === "drink") ?? -1;
    expect(drinkIndex).toBeGreaterThanOrEqual(0);
    expect(drinkIndex).toBe((route?.length ?? 0) - 1);
  });

  it("puts food before drinks when both are present", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const route = buildRoute(makeCategoryRepo({ unavailableCategories: ["culture"] }), {
      start: { lat: 55.75, lon: 37.61 },
      radiusMeters: 1500,
      now: new Date("2026-05-24T11:00:00Z"),
      excludePlaceIds: [],
      durationHours: 5
    });

    expect(route).not.toBeNull();
    const eatIndex = route?.findIndex((step) => step.scenario.key === "eat") ?? -1;
    const drinkIndex = route?.findIndex((step) => step.scenario.key === "drink") ?? -1;
    expect(eatIndex).toBeGreaterThanOrEqual(0);
    expect(drinkIndex).toBeGreaterThanOrEqual(0);
    expect(eatIndex).toBeLessThan(drinkIndex);
  });

  it("builds seven-step routes for eight-hour requests", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const route = buildRoute(makeCategoryRepo(), {
      start: { lat: 55.75, lon: 37.61 },
      radiusMeters: 1500,
      now: new Date("2026-05-24T07:00:00Z"),
      excludePlaceIds: [],
      durationHours: 8
    });

    expect(route).not.toBeNull();
    expect(route).toHaveLength(7);
  });

  it("does not repeat the same scenario consecutively", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const route = buildRoute(makeCategoryRepo(), {
      start: { lat: 55.75, lon: 37.61 },
      radiusMeters: 1500,
      now: new Date("2026-05-24T14:00:00Z"),
      excludePlaceIds: [],
      durationHours: 5
    });

    expect(route).not.toBeNull();
    for (let index = 1; index < (route?.length ?? 0); index += 1) {
      expect(route?.[index]?.scenario.key).not.toBe(route?.[index - 1]?.scenario.key);
    }
  });

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

  it("does not use breakfast places after 14:00", () => {
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
    const requestedRadii: number[] = [];
    const repo = {
      findNearby: (options: { lat: number; lon: number; radiusMeters?: number; categorySlug?: string }) => {
        requestedRadii.push(options.radiusMeters ?? 0);
        return [
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
        ];
      }
    } as unknown as PlaceRepository;

    const route = buildRoute(repo, {
      start: { lat: 55.75, lon: 37.61 },
      radiusMeters: 3000,
      now: new Date("2026-05-24T12:00:00Z"),
      excludePlaceIds: [],
      durationHours: 2
    });

    expect(route).not.toBeNull();
    expect(requestedRadii.length).toBeGreaterThan(0);
    expect(requestedRadii.every((radiusMeters) => radiusMeters <= MAX_ROUTE_TRANSITION_METERS)).toBe(true);
    expect(route?.every((step) => step.walkMinutes <= 20)).toBe(true);
    expect(route?.every((step) => step.suggestion.distanceMeters <= MAX_ROUTE_TRANSITION_METERS)).toBe(true);
  });

  it("uses the previous picked place as the origin for the next route step", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);

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
      now: new Date("2026-05-24T10:00:00Z"),
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

function makeCategoryRepo(options: { unavailableCategories?: string[] } = {}): PlaceRepository {
  let nextPlaceId = 1;
  const unavailableCategories = new Set(options.unavailableCategories ?? []);
  return {
    findNearby: (query: { lat: number; lon: number; categorySlug?: string }) => {
      if (query.categorySlug && unavailableCategories.has(query.categorySlug)) {
        return [];
      }

      return [
        makeSuggestion({
          placeId: nextPlaceId++,
          slug: query.categorySlug ?? "restaurant",
          lat: query.lat + 0.001,
          lon: query.lon + 0.001
        })
      ];
    }
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
