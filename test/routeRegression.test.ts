import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src-node/config.js";
import { openDatabase } from "../src-node/db/client.js";
import type { PlaceRepository } from "../src-node/db/placeRepository.js";
import { PlaceRepository as SqlitePlaceRepository } from "../src-node/db/placeRepository.js";
import { haversineDistanceMeters, type Coordinates } from "../src-node/geo/distance.js";
import { importCsv } from "../src-node/import/importCsv.js";
import {
  buildRoute,
  recalculateRouteSteps,
  replaceRouteStep,
  type RouteStep
} from "../src-node/recommendation/routeBuilder.js";
import {
  MAX_ROUTE_OVERRUN_MINUTES,
  MAX_ROUTE_WALK_MINUTES,
  MIN_ROUTE_FILL_RATIO,
  minRouteSteps,
  placeVisitDurationMinutes,
  primaryCategorySlug,
  routeDuration
} from "../src-node/recommendation/routeRules.js";
import { PLACE_SCENARIOS, type RouteDurationHours } from "../src-node/recommendation/scenarios.js";
import { isOpenForDuration, isOpenNow } from "../src-node/shared/openingHours.js";
import type { OpeningHoursJson, PlaceSuggestion } from "../src-node/shared/types.js";

const tempDirs: string[] = [];
const start = { lat: 55.75, lon: 37.61 };

afterEach(() => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("route regression suite", () => {
  it.each([2, 3, 5, 8] as const)("builds a valid %s-hour route on a deterministic map", (durationHours) => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const repo = makeArrayRouteRepo(makeRouteMapPlaces());

    const route = buildRoute(repo, {
      start,
      radiusMeters: 1500,
      now: new Date("2026-06-06T07:00:00Z"),
      excludePlaceIds: [],
      durationHours
    });

    assertValidRoute(route, durationHours);
  });

  it("uses arrival time rather than route start time for candidate availability", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const route = buildRoute(makeArrayRouteRepo([
      place({ id: 1, slug: "coffee", name: "Morning coffee", lat: 55.753, lon: 37.613 }),
      place({ id: 2, slug: "landmark", name: "Short city stop", lat: 55.756, lon: 37.616 }),
      place({
        id: 3,
        slug: "restaurant",
        name: "Open only at route start",
        lat: 55.759,
        lon: 37.619,
        hours: dailyHours("13:00", "13:20")
      }),
      place({
        id: 4,
        slug: "restaurant",
        name: "Open at arrival",
        lat: 55.7595,
        lon: 37.6195,
        hours: dailyHours("13:30", "16:30")
      })
    ]), {
      start,
      radiusMeters: 1500,
      now: new Date("2026-06-06T10:00:00Z"),
      excludePlaceIds: [],
      durationHours: 3
    });

    assertValidRoute(route, 3);
    expect(route?.map((step) => step.suggestion.placeId)).toContain(4);
    expect(route?.map((step) => step.suggestion.placeId)).not.toContain(3);
  });

  it("keeps overnight venues eligible for evening routes", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const route = buildRoute(makeArrayRouteRepo([
      place({ id: 1, slug: "landmark", name: "Evening city stop", lat: 55.755, lon: 37.615 }),
      place({
        id: 2,
        slug: "bar",
        name: "Overnight bar",
        lat: 55.76,
        lon: 37.62,
        hours: dailyHours("18:00", "02:00", true)
      })
    ]), {
      start,
      radiusMeters: 1500,
      now: new Date("2026-06-06T18:30:00Z"),
      excludePlaceIds: [],
      durationHours: 2
    });

    assertValidRoute(route, 2);
    expect(route?.map((step) => step.suggestion.placeId)).toContain(2);
  });

  it("returns null instead of a weak partial route", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const route = buildRoute(makeArrayRouteRepo([
      place({ id: 1, slug: "coffee", name: "Only coffee", lat: 55.753, lon: 37.613 }),
      place({ id: 2, slug: "landmark", name: "Only landmark", lat: 55.756, lon: 37.616 })
    ]), {
      start,
      radiusMeters: 1500,
      now: new Date("2026-06-06T07:00:00Z"),
      excludePlaceIds: [],
      durationHours: 5
    });

    expect(route).toBeNull();
  });

  it("keeps route query count bounded on deterministic maps", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const stats = { calls: 0 };
    const route = buildRoute(makeArrayRouteRepo(makeRouteMapPlaces(), stats), {
      start,
      radiusMeters: 1500,
      now: new Date("2026-06-06T07:00:00Z"),
      excludePlaceIds: [],
      durationHours: 5
    });

    assertValidRoute(route, 5);
    expect(stats.calls).toBeLessThanOrEqual(80);
  });

  it("replaces the first route step and recalculates following origins", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const originalRoute = recalculateRouteSteps([
      { scenario: PLACE_SCENARIOS.coffee_snack, suggestion: place({ id: 1, slug: "coffee", lat: 55.753, lon: 37.613 }) },
      { scenario: PLACE_SCENARIOS.see, suggestion: place({ id: 2, slug: "landmark", lat: 55.756, lon: 37.616 }) },
      { scenario: PLACE_SCENARIOS.eat, suggestion: place({ id: 3, slug: "restaurant", lat: 55.759, lon: 37.619 }) }
    ], start, new Date("2026-06-06T10:00:00Z"));

    const result = replaceRouteStep(makeArrayRouteRepo([
      place({ id: 99, slug: "coffee", name: "Replacement coffee", lat: 55.754, lon: 37.614 })
    ]), {
      route: originalRoute,
      stepIndex: 0,
      radiusMeters: 1500,
      excludePlaceIds: [],
      durationHours: 3
    });

    expect(result).not.toBeNull();
    expect(result?.route.map((step) => step.suggestion.placeId)).toEqual([99, 2, 3]);
    expect(result?.route[1]?.origin).toEqual({
      lat: result?.route[0]?.suggestion.lat,
      lon: result?.route[0]?.suggestion.lon
    });
  });

  it("replaces the last route step without changing earlier points", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const originalRoute = recalculateRouteSteps([
      { scenario: PLACE_SCENARIOS.coffee_snack, suggestion: place({ id: 1, slug: "coffee", lat: 55.751, lon: 37.611 }) },
      { scenario: PLACE_SCENARIOS.see, suggestion: place({ id: 2, slug: "landmark", lat: 55.752, lon: 37.612 }) },
      { scenario: PLACE_SCENARIOS.activity, suggestion: place({ id: 3, slug: "activity", lat: 55.753, lon: 37.613 }) },
      { scenario: PLACE_SCENARIOS.eat, suggestion: place({ id: 4, slug: "restaurant", lat: 55.754, lon: 37.614 }) },
      { scenario: PLACE_SCENARIOS.drink, suggestion: place({ id: 5, slug: "bar", lat: 55.755, lon: 37.615 }) }
    ], start, new Date("2026-06-06T14:00:00Z"));

    const result = replaceRouteStep(makeArrayRouteRepo([
      place({ id: 100, slug: "bar", name: "Replacement bar", lat: 55.7555, lon: 37.6155 })
    ]), {
      route: originalRoute,
      stepIndex: 4,
      radiusMeters: 1500,
      excludePlaceIds: [],
      durationHours: 5
    });

    expect(result).not.toBeNull();
    expect(result?.route.map((step) => step.suggestion.placeId)).toEqual([1, 2, 3, 4, 100]);
  });

  it("rejects a replacement candidate that is too far from the previous point", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const originalRoute = recalculateRouteSteps([
      { scenario: PLACE_SCENARIOS.coffee_snack, suggestion: place({ id: 1, slug: "coffee", lat: 55.753, lon: 37.613 }) },
      { scenario: PLACE_SCENARIOS.eat, suggestion: place({ id: 2, slug: "restaurant", lat: 55.756, lon: 37.616 }) },
      { scenario: PLACE_SCENARIOS.drink, suggestion: place({ id: 3, slug: "bar", lat: 55.759, lon: 37.619 }) }
    ], start, new Date("2026-06-06T14:00:00Z"));

    const result = replaceRouteStep(makeArrayRouteRepo([
      place({
        id: 101,
        slug: "restaurant",
        name: "Too far from previous",
        lat: 55.79,
        lon: 37.69
      })
    ]), {
      route: originalRoute,
      stepIndex: 1,
      radiusMeters: 1500,
      excludePlaceIds: [],
      durationHours: 3
    });

    expect(result).toBeNull();
  });

  it.each([
    ["Moscow", { lat: 55.729, lon: 37.636 }],
    ["Krasnodar", { lat: 45.035, lon: 38.975 }]
  ] as const)("builds a short route from imported %s data", (_city, cityStart) => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const tempDir = mkdtempSync(join(tmpdir(), "random-weekend-route-regression-"));
    tempDirs.push(tempDir);
    const config = makeTestConfig(join(tempDir, "bot.sqlite"));
    importCsv(config);

    const handle = openDatabase(config);
    try {
      const repo = new SqlitePlaceRepository(handle.sqlite, config);
      const route = buildRoute(repo, {
        start: cityStart,
        radiusMeters: 1500,
        now: new Date("2026-06-06T09:00:00Z"),
        excludePlaceIds: [],
        durationHours: 2
      });

      assertValidRoute(route, 2);
    } finally {
      handle.close();
    }
  });
});

function assertValidRoute(route: RouteStep[] | null, durationHours: RouteDurationHours): asserts route is RouteStep[] {
  if (!route) {
    throw new Error(`Expected a ${durationHours}-hour route to be built`);
  }

  expect(route.length).toBeGreaterThanOrEqual(minRouteSteps(durationHours));

  const targetMinutes = durationHours * 60;
  const durationMinutes = routeDuration(route);
  expect(durationMinutes).toBeGreaterThanOrEqual(targetMinutes * MIN_ROUTE_FILL_RATIO);
  expect(durationMinutes).toBeLessThanOrEqual(targetMinutes + MAX_ROUTE_OVERRUN_MINUTES);

  const placeIds = route.map((step) => step.suggestion.placeId);
  expect(new Set(placeIds).size).toBe(placeIds.length);

  for (const step of route) {
    expect(step.walkMinutes).toBeLessThanOrEqual(MAX_ROUTE_WALK_MINUTES);
    expect(isOpenForDuration(step.suggestion.openingHoursJson, step.arrival, step.visitDurationMinutes)).toBe(true);
    expect(step.visitDurationMinutes).toBe(placeVisitDurationMinutes(step.suggestion));
  }

  for (let index = 1; index < route.length; index += 1) {
    expect(primaryCategorySlug(route[index]?.suggestion)).not.toBe(primaryCategorySlug(route[index - 1]?.suggestion));
  }
}

function makeArrayRouteRepo(
  places: PlaceSuggestion[],
  stats?: { calls: number }
): PlaceRepository {
  return {
    findNearby: (query: {
      lat: number;
      lon: number;
      radiusMeters?: number;
      categorySlug?: string;
      now?: Date;
      limit?: number;
    }) => {
      if (stats) {
        stats.calls += 1;
      }
      const radiusMeters = query.radiusMeters ?? 1500;
      return places
        .filter((suggestion) => !query.categorySlug || suggestion.categories.some((category) => category.slug === query.categorySlug))
        .map((suggestion) => ({
          ...suggestion,
          distanceMeters: Math.round(haversineDistanceMeters(
            { lat: query.lat, lon: query.lon },
            { lat: suggestion.lat, lon: suggestion.lon }
          ))
        }))
        .filter((suggestion) => suggestion.distanceMeters <= radiusMeters)
        .filter((suggestion) => query.now ? isOpenNow(suggestion.openingHoursJson, query.now) === true : true)
        .sort((left, right) => left.distanceMeters - right.distanceMeters)
        .slice(0, query.limit ?? 100);
    }
  } as unknown as PlaceRepository;
}

function makeRouteMapPlaces(): PlaceSuggestion[] {
  return [
    place({ id: 1, slug: "coffee", name: "Coffee 1", lat: 55.753, lon: 37.613 }),
    place({ id: 2, slug: "quick_bite", name: "Quick bite 1", lat: 55.754, lon: 37.614 }),
    place({ id: 3, slug: "landmark", name: "Landmark 1", lat: 55.756, lon: 37.616 }),
    place({ id: 4, slug: "viewpoint", name: "Viewpoint 1", lat: 55.757, lon: 37.617 }),
    place({ id: 12, slug: "park", name: "Park 1", lat: 55.758, lon: 37.618 }),
    place({ id: 13, slug: "culture", name: "Culture 1", lat: 55.7585, lon: 37.6185 }),
    place({ id: 5, slug: "activity", name: "Activity 1", lat: 55.759, lon: 37.619 }),
    place({ id: 6, slug: "activity", name: "Activity 2", lat: 55.76, lon: 37.62 }),
    place({ id: 14, slug: "activity", name: "Activity 3", lat: 55.761, lon: 37.621 }),
    place({ id: 7, slug: "restaurant", name: "Restaurant 1", lat: 55.762, lon: 37.622 }),
    place({ id: 8, slug: "fine_dining", name: "Fine dining 1", lat: 55.763, lon: 37.623 }),
    place({ id: 15, slug: "restaurant", name: "Restaurant 2", lat: 55.764, lon: 37.624 }),
    place({ id: 9, slug: "bar", name: "Bar 1", lat: 55.765, lon: 37.625 }),
    place({ id: 10, slug: "pub", name: "Pub 1", lat: 55.766, lon: 37.626 }),
    place({ id: 16, slug: "wine_bar", name: "Wine bar 1", lat: 55.7665, lon: 37.6265 }),
    place({ id: 11, slug: "bathhouse", name: "Bathhouse 1", lat: 55.767, lon: 37.627 })
  ];
}

function place(options: {
  id: number;
  slug: string;
  name?: string;
  lat: number;
  lon: number;
  distanceMeters?: number;
  hours?: OpeningHoursJson;
}): PlaceSuggestion {
  return {
    placeId: options.id,
    name: options.name ?? `Place ${options.id}`,
    categories: [{ slug: options.slug, name: options.slug, isPrimary: true }],
    description: "Regression place",
    address: "Regression address",
    lat: options.lat,
    lon: options.lon,
    citySlug: options.lat < 50 ? "krasnodar" : "moscow",
    distanceMeters: options.distanceMeters ?? Math.round(haversineDistanceMeters(start, {
      lat: options.lat,
      lon: options.lon
    })),
    openingHoursText: "Ежедневно 00:00-23:59",
    openingHoursJson: options.hours ?? dailyHours("00:00", "23:59")
  };
}

function dailyHours(from: string, to: string, nextDay = false): OpeningHoursJson {
  return {
    timezone: "Europe/Moscow",
    weekly: {
      mon: [{ from, to, next_day: nextDay }],
      tue: [{ from, to, next_day: nextDay }],
      wed: [{ from, to, next_day: nextDay }],
      thu: [{ from, to, next_day: nextDay }],
      fri: [{ from, to, next_day: nextDay }],
      sat: [{ from, to, next_day: nextDay }],
      sun: [{ from, to, next_day: nextDay }]
    }
  };
}

function makeTestConfig(databasePath: string): AppConfig {
  return {
    NODE_ENV: "test",
    BOT_TOKEN: "test-token",
    BOT_MODE: "polling",
    HOST: "127.0.0.1",
    PORT: 3000,
    DATABASE_PATH: databasePath,
    IMPORT_DIR: resolve("data/import"),
    SEARCH_RADIUS_METERS: 1500,
    GEOCODER_URL: "https://nominatim.openstreetmap.org/search",
    GEOCODER_USER_AGENT: "random-weekend-route-regression/0.2",
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
