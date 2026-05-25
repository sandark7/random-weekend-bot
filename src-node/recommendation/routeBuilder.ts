import type { PlaceRepository } from "../db/placeRepository.js";
import type { Coordinates } from "../geo/distance.js";
import { isOpenForDuration } from "../shared/openingHours.js";
import type { PlaceSuggestion } from "../shared/types.js";
import { findNearbyByCategories } from "./nearby.js";
import {
  PLACE_SCENARIOS,
  type PlaceScenario,
  type PlaceScenarioKey,
  type RouteDurationHours
} from "./scenarios.js";
import {
  MAX_ROUTE_OVERRUN_MINUTES,
  MAX_ROUTE_TRANSITION_METERS,
  MAX_ROUTE_WALK_MINUTES,
  MIN_ROUTE_FILL_RATIO,
  allowedRouteScenarios,
  hasCategory,
  minRouteSteps,
  placeVisitDurationMinutes,
  primaryCategorySlug,
  routeCandidateAllowed,
  routeDuration,
  routeScore,
  walkingMinutes
} from "./routeRules.js";

export type RouteStep = {
  scenario: PlaceScenario;
  suggestion: PlaceSuggestion;
  origin: Coordinates;
  arrival: Date;
  walkMinutes: number;
  visitDurationMinutes: number;
};

type RouteTemplateSlot = readonly PlaceScenarioKey[];
type RouteTemplate = readonly RouteTemplateSlot[];

const ROUTE_CANDIDATE_POOL_SIZE = 3;

const ROUTE_TEMPLATES: Record<RouteDurationHours, readonly RouteTemplate[]> = {
  2: [
    [
      ["coffee_snack"],
      ["see"]
    ],
    [
      ["coffee_snack"],
      ["activity", "see"]
    ],
    [
      ["see"],
      ["coffee_snack"]
    ],
    [
      ["see"],
      ["eat", "activity"]
    ],
    [
      ["see"],
      ["drink"]
    ]
  ],
  3: [
    [
      ["coffee_snack"],
      ["see"],
      ["eat"]
    ],
    [
      ["see"],
      ["coffee_snack"],
      ["eat", "drink"]
    ],
    [
      ["coffee_snack", "see"],
      ["activity", "see"],
      ["eat", "drink"]
    ]
  ],
  5: [
    [
      ["coffee_snack"],
      ["see"],
      ["activity", "see"],
      ["eat"],
      ["drink"]
    ],
    [
      ["see"],
      ["coffee_snack"],
      ["see", "activity"],
      ["eat"],
      ["drink"]
    ],
    [
      ["coffee_snack", "see"],
      ["activity"],
      ["see"],
      ["eat"],
      ["drink"]
    ]
  ],
  8: [
    [
      ["coffee_snack"],
      ["see"],
      ["activity"],
      ["eat"],
      ["see"],
      ["activity", "relax"],
      ["drink", "relax", "see"]
    ],
    [
      ["coffee_snack", "see"],
      ["activity", "see"],
      ["see"],
      ["eat"],
      ["activity"],
      ["see"],
      ["drink", "relax", "see"]
    ],
    [
      ["coffee_snack"],
      ["see"],
      ["activity"],
      ["eat"],
      ["see"],
      ["relax"],
      ["drink", "see"]
    ]
  ]
};

export function buildRoute(
  repo: PlaceRepository,
  options: {
    start: Coordinates;
    radiusMeters: number;
    now: Date;
    excludePlaceIds: number[];
    durationHours: RouteDurationHours;
  }
): RouteStep[] | null {
  const targetMinutes = options.durationHours * 60;
  const transitionRadiusMeters = Math.min(options.radiusMeters, MAX_ROUTE_TRANSITION_METERS);
  const attempts: RouteStep[][] = [];
  const templates = ROUTE_TEMPLATES[options.durationHours];

  for (let attempt = 0; attempt < 36; attempt += 1) {
    const template = templates[attempt % templates.length];
    const route = buildRouteFromTemplate(repo, {
      template,
      start: options.start,
      now: options.now,
      targetMinutes,
      radiusMeters: transitionRadiusMeters,
      excludePlaceIds: options.excludePlaceIds
    });

    if (routeIsAcceptable(route, targetMinutes, options.durationHours)) {
      attempts.push(route);
    }
  }

  return attempts.sort((left, right) => routeScore(right, targetMinutes) - routeScore(left, targetMinutes))[0] ?? null;
}

function buildRouteFromTemplate(
  repo: PlaceRepository,
  options: {
    template: RouteTemplate;
    start: Coordinates;
    now: Date;
    targetMinutes: number;
    radiusMeters: number;
    excludePlaceIds: number[];
  }
): RouteStep[] {
  const steps: RouteStep[] = [];
  const usedPlaceIds = new Set(options.excludePlaceIds);

  let origin = options.start;
  let elapsedMinutes = 0;
  let lastPrimaryCategory: string | null = null;
  let lastScenarioKey: PlaceScenarioKey | null = null;
  let usedFineDining = 0;
  let usedBathhouse = 0;

  for (const slot of options.template) {
    const arrival = addMinutes(options.now, elapsedMinutes);
    const remainingMinutes = options.targetMinutes - elapsedMinutes;

    if (remainingMinutes <= 0) {
      break;
    }

    const picked = pickRouteStepForSlot(repo, {
      scenarioKeys: slot,
      origin,
      arrival,
      remainingMinutes,
      radiusMeters: options.radiusMeters,
      usedPlaceIds,
      lastPrimaryCategory,
      lastScenarioKey,
      usedFineDining,
      usedBathhouse
    });

    if (!picked) {
      break;
    }

    const { scenario, suggestion, walkMinutes, visitDurationMinutes } = picked;

    steps.push({
      scenario,
      suggestion,
      origin,
      arrival,
      walkMinutes,
      visitDurationMinutes
    });

    usedPlaceIds.add(suggestion.placeId);
    lastPrimaryCategory = primaryCategorySlug(suggestion);
    lastScenarioKey = scenario.key;

    if (hasCategory(suggestion, "fine_dining")) {
      usedFineDining += 1;
    }

    if (hasCategory(suggestion, "bathhouse")) {
      usedBathhouse += 1;
    }

    origin = {
      lat: suggestion.lat,
      lon: suggestion.lon
    };

    elapsedMinutes += walkMinutes + visitDurationMinutes;
  }

  return steps;
}

function pickRouteStepForSlot(
  repo: PlaceRepository,
  options: {
    scenarioKeys: RouteTemplateSlot;
    origin: Coordinates;
    arrival: Date;
    remainingMinutes: number;
    radiusMeters: number;
    usedPlaceIds: Set<number>;
    lastPrimaryCategory: string | null;
    lastScenarioKey: PlaceScenarioKey | null;
    usedFineDining: number;
    usedBathhouse: number;
  }
): { scenario: PlaceScenario; suggestion: PlaceSuggestion; walkMinutes: number; visitDurationMinutes: number } | null {
  const allowedScenarioKeys = new Set(allowedRouteScenarios(options.arrival, options.remainingMinutes));
  const scenarioKeys = [...options.scenarioKeys].filter((scenarioKey) => (
    allowedScenarioKeys.has(scenarioKey)
  ));

  for (const scenarioKey of scenarioKeys) {
    if (scenarioKey === options.lastScenarioKey) {
      continue;
    }

    const scenario = PLACE_SCENARIOS[scenarioKey];

    const candidates = findNearbyByCategories(repo, {
      lat: options.origin.lat,
      lon: options.origin.lon,
      radiusMeters: options.radiusMeters,
      categorySlugs: scenario.categories,
      now: options.arrival,
      limit: 500
    })
      .filter((suggestion) => !options.usedPlaceIds.has(suggestion.placeId))
      .filter((suggestion) => routeCandidateAllowed(suggestion, options.arrival, {
        lastPrimaryCategory: options.lastPrimaryCategory,
        usedFineDining: options.usedFineDining,
        usedBathhouse: options.usedBathhouse
      }))
      .map((suggestion) => ({
        suggestion,
        walkMinutes: walkingMinutes(suggestion.distanceMeters),
        visitDurationMinutes: placeVisitDurationMinutes(suggestion)
      }))
      .filter((candidate) => candidate.walkMinutes <= MAX_ROUTE_WALK_MINUTES)
      .filter((candidate) => (
        candidate.walkMinutes + candidate.visitDurationMinutes <=
        options.remainingMinutes + MAX_ROUTE_OVERRUN_MINUTES
      ))
      .filter((candidate) => (
        isOpenForDuration(
          candidate.suggestion.openingHoursJson,
          options.arrival,
          candidate.visitDurationMinutes
        ) === true
      ))
      .sort((left, right) => (
        routeCandidateRank(left.suggestion, scenario) - routeCandidateRank(right.suggestion, scenario)
      ));

    const topCandidates = candidates.slice(0, ROUTE_CANDIDATE_POOL_SIZE);
    const picked = topCandidates[Math.floor(Math.random() * topCandidates.length)];
    if (picked) {
      return {
        scenario,
        suggestion: picked.suggestion,
        walkMinutes: picked.walkMinutes,
        visitDurationMinutes: picked.visitDurationMinutes
      };
    }
  }

  return null;
}

function routeCandidateRank(suggestion: PlaceSuggestion, scenario: PlaceScenario): number {
  const visitDuration = placeVisitDurationMinutes(suggestion);
  return Math.abs(visitDuration - scenario.durationMinutes) * 10 + suggestion.distanceMeters / 1000;
}

function routeIsAcceptable(
  route: RouteStep[],
  targetMinutes: number,
  durationHours: RouteDurationHours
): boolean {
  if (route.length < minRouteSteps(durationHours)) {
    return false;
  }

  const totalMinutes = routeDuration(route);

  if (totalMinutes < targetMinutes * MIN_ROUTE_FILL_RATIO) {
    return false;
  }

  if (totalMinutes > targetMinutes + MAX_ROUTE_OVERRUN_MINUTES) {
    return false;
  }

  return true;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}
