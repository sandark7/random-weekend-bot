import type { PlaceRepository } from "../db/placeRepository.js";
import {
  haversineDistanceMeters,
  type Coordinates
} from "../geo/distance.js";
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

type RouteStepSeed = Pick<RouteStep, "scenario" | "suggestion">;

export type ReplaceRouteStepResult = {
  route: RouteStep[];
  oldStep: RouteStep;
  newStep: RouteStep;
};

type RouteScoringProfile = readonly Partial<Record<PlaceScenarioKey, number>>[];
type NearbyCache = Map<string, PlaceSuggestion[]>;

const ROUTE_CANDIDATE_POOL_SIZE = 3;

const ROUTE_SCORING_PROFILES: Record<RouteDurationHours, readonly RouteScoringProfile[]> = {
  2: [
    [
      { coffee_snack: 9, see: 8, activity: 4 },
      { activity: 10, eat: 9, see: 6, drink: 6 }
    ],
    [
      { see: 9, coffee_snack: 7, activity: 4 },
      { eat: 10, activity: 8, drink: 7, see: 5 }
    ],
    [
      { activity: 8, see: 8, coffee_snack: 5 },
      { eat: 10, drink: 8, see: 5 }
    ],
    [
      { eat: 9, see: 7, coffee_snack: 6 },
      { see: 10, activity: 8, coffee_snack: 6 }
    ]
  ],
  3: [
    [
      { coffee_snack: 9, see: 8 },
      { see: 10, activity: 8 },
      { eat: 10, drink: 8, activity: 6 }
    ],
    [
      { see: 10, coffee_snack: 7 },
      { activity: 9, see: 8 },
      { eat: 10, drink: 8, relax: 6 }
    ],
    [
      { coffee_snack: 8, see: 8 },
      { eat: 9, activity: 8, see: 7 },
      { drink: 10, relax: 8, eat: 6 }
    ]
  ],
  5: [
    [
      { coffee_snack: 9, see: 8 },
      { see: 10, activity: 7 },
      { activity: 10, see: 8 },
      { eat: 10, activity: 5 },
      { drink: 10, relax: 8, see: 5 }
    ],
    [
      { see: 10, coffee_snack: 7 },
      { coffee_snack: 8, activity: 7, see: 7 },
      { activity: 10, see: 8 },
      { eat: 10 },
      { drink: 10, relax: 8, see: 5 }
    ],
    [
      { coffee_snack: 8, see: 8 },
      { activity: 10, see: 7 },
      { see: 9, activity: 8 },
      { eat: 10, activity: 5 },
      { drink: 10, relax: 8 }
    ]
  ],
  8: [
    [
      { coffee_snack: 9, see: 8 },
      { see: 10, activity: 7 },
      { activity: 10, see: 7 },
      { eat: 10 },
      { see: 10, activity: 7 },
      { activity: 10, relax: 9, see: 6 },
      { drink: 10, relax: 9, see: 5 }
    ],
    [
      { see: 10, coffee_snack: 8 },
      { activity: 10, see: 8 },
      { see: 10, activity: 7 },
      { eat: 10 },
      { activity: 10, see: 7 },
      { see: 9, relax: 8, activity: 7 },
      { drink: 10, relax: 9, see: 5 }
    ],
    [
      { coffee_snack: 9, see: 8 },
      { see: 10, activity: 7 },
      { activity: 10 },
      { eat: 10 },
      { see: 10, activity: 7 },
      { relax: 10, activity: 8, see: 6 },
      { drink: 10, see: 7 }
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
  const profiles = ROUTE_SCORING_PROFILES[options.durationHours];
  const nearbyCache: NearbyCache = new Map();

  for (let attempt = 0; attempt < 48; attempt += 1) {
    const profile = profiles[attempt % profiles.length];
    const route = buildRouteFromScoringProfile(repo, {
      profile,
      start: options.start,
      now: options.now,
      targetMinutes,
      radiusMeters: transitionRadiusMeters,
      excludePlaceIds: options.excludePlaceIds,
      nearbyCache,
      attempt
    });

    if (routeIsAcceptable(route, targetMinutes, options.durationHours)) {
      attempts.push(route);
    }
  }

  return attempts.sort((left, right) => routeScore(right, targetMinutes) - routeScore(left, targetMinutes))[0] ?? null;
}

export function replaceRouteStep(
  repo: PlaceRepository,
  options: {
    route: RouteStep[];
    stepIndex: number;
    radiusMeters: number;
    excludePlaceIds: number[];
    durationHours: RouteDurationHours;
  }
): ReplaceRouteStepResult | null {
  const oldStep = options.route[options.stepIndex];
  if (!oldStep) {
    return null;
  }

  const start = options.route[0]?.origin;
  const startedAt = options.route[0]?.arrival;
  if (!start || !startedAt) {
    return null;
  }

  const previousStep = options.route[options.stepIndex - 1];
  const nextStep = options.route[options.stepIndex + 1];
  const origin = previousStep
    ? { lat: previousStep.suggestion.lat, lon: previousStep.suggestion.lon }
    : start;
  const routePlaceIds = options.route.map((step) => step.suggestion.placeId);
  const otherSteps = options.route.filter((_, index) => index !== options.stepIndex);
  const usedFineDining = otherSteps.filter((step) => hasCategory(step.suggestion, "fine_dining")).length;
  const usedBathhouse = otherSteps.filter((step) => hasCategory(step.suggestion, "bathhouse")).length;
  const lastPrimaryCategory = previousStep ? primaryCategorySlug(previousStep.suggestion) : null;
  const nextPrimaryCategory = nextStep ? primaryCategorySlug(nextStep.suggestion) : null;
  const transitionRadiusMeters = Math.min(options.radiusMeters, MAX_ROUTE_TRANSITION_METERS);
  const scenario = oldStep.scenario;

  const picked = pickReplacementCandidate([])
    ?? pickReplacementCandidate(options.excludePlaceIds);
  if (!picked) {
    return null;
  }

  const seeds = options.route.map((step, index): RouteStepSeed => ({
    scenario: step.scenario,
    suggestion: index === options.stepIndex ? picked.suggestion : step.suggestion
  }));
  const route = recalculateRouteSteps(seeds, start, startedAt);

  if (!routeIsAcceptable(route, options.durationHours * 60, options.durationHours)) {
    return null;
  }

  if (!route.every((step) => (
    step.walkMinutes <= MAX_ROUTE_WALK_MINUTES &&
    isOpenForDuration(step.suggestion.openingHoursJson, step.arrival, step.visitDurationMinutes) === true
  ))) {
    return null;
  }

  const newStep = route[options.stepIndex];
  if (!newStep) {
    return null;
  }

  return {
    route,
    oldStep,
    newStep
  };

  function pickReplacementCandidate(extraExcludePlaceIds: number[]): {
    suggestion: PlaceSuggestion;
    walkMinutes: number;
    visitDurationMinutes: number;
    nextWalkMinutes: number;
  } | null {
    const excludedPlaceIds = new Set([...routePlaceIds, ...extraExcludePlaceIds]);
    const candidates = findNearbyByCategories(repo, {
      lat: origin.lat,
      lon: origin.lon,
      radiusMeters: transitionRadiusMeters,
      categorySlugs: scenario.categories,
      now: oldStep.arrival,
      limit: 500
    })
      .filter((suggestion) => !excludedPlaceIds.has(suggestion.placeId))
      .filter((suggestion) => routeCandidateAllowed(suggestion, oldStep.arrival, {
        lastPrimaryCategory,
        usedFineDining,
        usedBathhouse
      }))
      .filter((suggestion) => primaryCategorySlug(suggestion) !== nextPrimaryCategory)
      .map((suggestion) => {
        const walkMinutes = walkingMinutes(suggestion.distanceMeters);
        const visitDurationMinutes = placeVisitDurationMinutes(suggestion);
        const nextWalkMinutes = nextStep
          ? walkingMinutes(haversineDistanceMeters(
              { lat: suggestion.lat, lon: suggestion.lon },
              { lat: nextStep.suggestion.lat, lon: nextStep.suggestion.lon }
            ))
          : 0;

        return {
          suggestion,
          walkMinutes,
          visitDurationMinutes,
          nextWalkMinutes
        };
      })
      .filter((candidate) => candidate.walkMinutes <= MAX_ROUTE_WALK_MINUTES)
      .filter((candidate) => candidate.nextWalkMinutes <= MAX_ROUTE_WALK_MINUTES)
      .filter((candidate) => (
        isOpenForDuration(
          candidate.suggestion.openingHoursJson,
          oldStep.arrival,
          candidate.visitDurationMinutes
        ) === true
      ))
      .sort((left, right) => (
        replacementCandidateRank(left.suggestion, left.visitDurationMinutes, oldStep) -
        replacementCandidateRank(right.suggestion, right.visitDurationMinutes, oldStep)
      ));

    const topCandidates = candidates.slice(0, ROUTE_CANDIDATE_POOL_SIZE);
    return topCandidates[Math.floor(Math.random() * topCandidates.length)] ?? null;
  }
}

export function recalculateRouteSteps(
  steps: RouteStepSeed[],
  start: Coordinates,
  startedAt: Date
): RouteStep[] {
  const route: RouteStep[] = [];
  let origin = start;
  let elapsedMinutes = 0;

  for (const step of steps) {
    const distanceMeters = Math.round(
      haversineDistanceMeters(origin, { lat: step.suggestion.lat, lon: step.suggestion.lon })
    );
    const suggestion = {
      ...step.suggestion,
      distanceMeters
    };
    const walkMinutes = walkingMinutes(distanceMeters);
    const visitDurationMinutes = placeVisitDurationMinutes(suggestion);
    const arrival = addMinutes(startedAt, elapsedMinutes);

    route.push({
      scenario: step.scenario,
      suggestion,
      origin,
      arrival,
      walkMinutes,
      visitDurationMinutes
    });

    elapsedMinutes += walkMinutes + visitDurationMinutes;
    origin = {
      lat: suggestion.lat,
      lon: suggestion.lon
    };
  }

  return route;
}

function buildRouteFromScoringProfile(
  repo: PlaceRepository,
  options: {
    profile: RouteScoringProfile;
    start: Coordinates;
    now: Date;
    targetMinutes: number;
    radiusMeters: number;
    excludePlaceIds: number[];
    attempt: number;
    initialState?: {
      elapsedMinutes: number;
      lastPrimaryCategory: string | null;
      lastScenarioKey: PlaceScenarioKey | null;
      usedFineDining: number;
      usedBathhouse: number;
    };
    nearbyCache?: NearbyCache;
  }
): RouteStep[] {
  const steps: RouteStep[] = [];
  const usedPlaceIds = new Set(options.excludePlaceIds);

  let origin = options.start;
  let elapsedMinutes = options.initialState?.elapsedMinutes ?? 0;
  let lastPrimaryCategory: string | null = options.initialState?.lastPrimaryCategory ?? null;
  let lastScenarioKey: PlaceScenarioKey | null = options.initialState?.lastScenarioKey ?? null;
  let usedFineDining = options.initialState?.usedFineDining ?? 0;
  let usedBathhouse = options.initialState?.usedBathhouse ?? 0;

  for (let stepIndex = 0; stepIndex < options.profile.length; stepIndex += 1) {
    const profileStep = options.profile[stepIndex] ?? {};
    const arrival = addMinutes(options.now, elapsedMinutes);
    const remainingMinutes = options.targetMinutes - elapsedMinutes;

    if (remainingMinutes <= 0) {
      break;
    }

    const picked = pickScoredRouteStep(repo, {
      profileStep,
      origin,
      arrival,
      remainingMinutes,
      radiusMeters: options.radiusMeters,
      usedPlaceIds,
      lastPrimaryCategory,
      lastScenarioKey,
      usedFineDining,
      usedBathhouse,
      stepIndex,
      targetStepCount: options.profile.length,
      attempt: options.attempt,
      nearbyCache: options.nearbyCache
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

function pickScoredRouteStep(
  repo: PlaceRepository,
  options: {
    profileStep: Partial<Record<PlaceScenarioKey, number>>;
    origin: Coordinates;
    arrival: Date;
    remainingMinutes: number;
    radiusMeters: number;
    usedPlaceIds: Set<number>;
    lastPrimaryCategory: string | null;
    lastScenarioKey: PlaceScenarioKey | null;
    usedFineDining: number;
    usedBathhouse: number;
    stepIndex: number;
    targetStepCount: number;
    attempt: number;
    nearbyCache?: NearbyCache;
  }
): { scenario: PlaceScenario; suggestion: PlaceSuggestion; walkMinutes: number; visitDurationMinutes: number } | null {
  const allowedScenarioKeys = new Set(allowedRouteScenarios(options.arrival, options.remainingMinutes));
  const scenarioKeys = profileScenarioKeys(options.profileStep)
    .filter((scenarioKey) => allowedScenarioKeys.has(scenarioKey));

  const candidates: Array<{
    scenario: PlaceScenario;
    suggestion: PlaceSuggestion;
    walkMinutes: number;
    visitDurationMinutes: number;
    score: number;
  }> = [];

  for (const scenarioKey of scenarioKeys) {
    if (scenarioKey === options.lastScenarioKey) {
      continue;
    }

    const scenario = PLACE_SCENARIOS[scenarioKey];

    const ranked = cachedFindNearbyByCategories(repo, {
      lat: options.origin.lat,
      lon: options.origin.lon,
      radiusMeters: options.radiusMeters,
      categorySlugs: scenario.categories,
      now: options.arrival,
      limit: 500
    }, options.nearbyCache)
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
      .map((candidate) => ({
        scenario,
        suggestion: candidate.suggestion,
        walkMinutes: candidate.walkMinutes,
        visitDurationMinutes: candidate.visitDurationMinutes,
        score: scoreRouteCandidate(candidate.suggestion, scenario, {
          profileWeight: options.profileStep[scenarioKey] ?? 0,
          stepIndex: options.stepIndex,
          targetStepCount: options.targetStepCount,
          remainingMinutes: options.remainingMinutes,
          walkMinutes: candidate.walkMinutes,
          visitDurationMinutes: candidate.visitDurationMinutes
        })
      }));

    candidates.push(...ranked);
  }

  const topCandidates = candidates
    .sort((left, right) => right.score - left.score)
    .slice(0, ROUTE_CANDIDATE_POOL_SIZE);
  const picked = topCandidates[options.attempt % Math.max(topCandidates.length, 1)];
  return picked
    ? {
        scenario: picked.scenario,
        suggestion: picked.suggestion,
        walkMinutes: picked.walkMinutes,
        visitDurationMinutes: picked.visitDurationMinutes
      }
    : null;
}

function profileScenarioKeys(profileStep: Partial<Record<PlaceScenarioKey, number>>): PlaceScenarioKey[] {
  return Object.entries(profileStep)
    .filter(([, weight]) => (weight ?? 0) > 0)
    .sort((left, right) => (right[1] ?? 0) - (left[1] ?? 0))
    .map(([scenarioKey]) => scenarioKey as PlaceScenarioKey);
}

function scoreRouteCandidate(
  suggestion: PlaceSuggestion,
  scenario: PlaceScenario,
  options: {
    profileWeight: number;
    stepIndex: number;
    targetStepCount: number;
    remainingMinutes: number;
    walkMinutes: number;
    visitDurationMinutes: number;
  }
): number {
  const stepBudget = options.remainingMinutes / Math.max(options.targetStepCount - options.stepIndex, 1);
  const durationPenalty = Math.abs((options.walkMinutes + options.visitDurationMinutes) - stepBudget) * 0.8;
  const distancePenalty = suggestion.distanceMeters / 250;
  const scenarioDurationPenalty = Math.abs(options.visitDurationMinutes - scenario.durationMinutes) * 0.15;

  return options.profileWeight * 100 - durationPenalty - distancePenalty - scenarioDurationPenalty;
}

function cachedFindNearbyByCategories(
  repo: PlaceRepository,
  options: {
    lat: number;
    lon: number;
    radiusMeters: number;
    categorySlugs: readonly string[];
    now: Date;
    limit: number;
  },
  cache: NearbyCache | undefined
): PlaceSuggestion[] {
  if (!cache) {
    return findNearbyByCategories(repo, options);
  }

  const key = [
    options.lat.toFixed(6),
    options.lon.toFixed(6),
    options.radiusMeters,
    options.categorySlugs.join(","),
    options.now.toISOString(),
    options.limit
  ].join("|");
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const suggestions = findNearbyByCategories(repo, options);
  cache.set(key, suggestions);
  return suggestions;
}

function routeCandidateRank(suggestion: PlaceSuggestion, scenario: PlaceScenario): number {
  const visitDuration = placeVisitDurationMinutes(suggestion);
  return Math.abs(visitDuration - scenario.durationMinutes) * 10 + suggestion.distanceMeters / 1000;
}

function replacementCandidateRank(
  suggestion: PlaceSuggestion,
  visitDurationMinutes: number,
  oldStep: RouteStep
): number {
  return Math.abs(visitDurationMinutes - oldStep.visitDurationMinutes) * 10 + suggestion.distanceMeters / 1000;
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
