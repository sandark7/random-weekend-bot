import type { PlaceSuggestion } from "../shared/types.js";
import {
  ROUTE_SCENARIO_POOL,
  SCENARIO_CATEGORIES,
  type PlaceScenario,
  type PlaceScenarioKey,
  type RouteDurationHours
} from "./scenarios.js";

export const MAX_ROUTE_WALK_MINUTES = 20;
export const WALKING_METERS_PER_MINUTE = 70;
export const WALKING_ROUTE_FACTOR = 1.25;
export const MAX_ROUTE_TRANSITION_METERS = Math.floor(
  (MAX_ROUTE_WALK_MINUTES * WALKING_METERS_PER_MINUTE) / WALKING_ROUTE_FACTOR
);
export const MIN_ROUTE_FILL_RATIO = 0.65;
export const MAX_ROUTE_OVERRUN_MINUTES = 25;
const DRINK_ALLOWED_FROM_MINUTES = 17 * 60;
const BREAKFAST_ALLOWED_UNTIL_MINUTES = 14 * 60;

const DEFAULT_VISIT_DURATION_MINUTES = 45;
const CATEGORY_VISIT_DURATION_MINUTES: Record<string, number> = {
  coffee: 35,
  breakfast: 45,
  quick_bite: 35,
  restaurant: 90,
  fine_dining: 120,
  bar: 60,
  cocktail_bar: 60,
  wine_bar: 60,
  pub: 60,
  culture: 90,
  landmark: 20,
  park: 45,
  viewpoint: 20,
  activity: 90,
  bathhouse: 150
};

type RouteScoringStep = {
  scenario: PlaceScenario;
  suggestion: PlaceSuggestion;
  walkMinutes: number;
  visitDurationMinutes: number;
};

export function allowedRouteScenarios(arrival: Date, remainingMinutes: number): PlaceScenarioKey[] {
  const minutes = moscowMinutes(arrival);
  const evening = minutes >= 17 * 60;
  return ROUTE_SCENARIO_POOL.filter((scenarioKey) => {
    if (scenarioKey === "drink" && minutes < DRINK_ALLOWED_FROM_MINUTES) return false;
    if (scenarioKey === "coffee_snack" && evening) return remainingMinutes <= 90;
    return minScenarioVisitDurationMinutes(scenarioKey) <= remainingMinutes + MAX_ROUTE_OVERRUN_MINUTES;
  });
}

export function routeCandidateAllowed(
  suggestion: PlaceSuggestion,
  arrival: Date,
  state: {
    lastPrimaryCategory: string | null;
    usedFineDining: number;
    usedBathhouse: number;
  }
): boolean {
  const primary = primaryCategorySlug(suggestion);
  if (primary && primary === state.lastPrimaryCategory) return false;
  if (hasCategory(suggestion, "fine_dining") && state.usedFineDining >= 1) return false;
  if (hasCategory(suggestion, "bathhouse") && state.usedBathhouse >= 1) return false;

  const minutes = moscowMinutes(arrival);
  if (minutes < DRINK_ALLOWED_FROM_MINUTES && hasAnyCategory(suggestion, SCENARIO_CATEGORIES.drink)) return false;
  if (minutes >= BREAKFAST_ALLOWED_UNTIL_MINUTES && hasCategory(suggestion, "breakfast")) return false;

  return true;
}

export function routeScore(route: RouteScoringStep[], targetMinutes: number): number {
  const total = routeDuration(route);
  const fillRatio = total / targetMinutes;
  const fillPenalty = fillRatio < MIN_ROUTE_FILL_RATIO ? (MIN_ROUTE_FILL_RATIO - fillRatio) * 100 : 0;
  const overrunPenalty = total > targetMinutes + MAX_ROUTE_OVERRUN_MINUTES ? (total - targetMinutes) * 2 : 0;
  const categoryVariety = new Set(route.map((step) => primaryCategorySlug(step.suggestion))).size;
  return route.length * 20 + categoryVariety * 5 - Math.abs(targetMinutes - total) * 0.25 - fillPenalty - overrunPenalty;
}

export function routeDuration(route: RouteScoringStep[]): number {
  return route.reduce((sum, step) => sum + step.walkMinutes + step.visitDurationMinutes, 0);
}

export function minRouteSteps(durationHours: RouteDurationHours): number {
  if (durationHours <= 2) return 2;
  if (durationHours <= 3) return 3;
  if (durationHours <= 5) return 4;
  return 7;
}

export function walkingMinutes(distanceMeters: number): number {
  return Math.max(1, Math.round((distanceMeters / WALKING_METERS_PER_MINUTE) * WALKING_ROUTE_FACTOR));
}

export function placeVisitDurationMinutes(suggestion: PlaceSuggestion): number {
  const primary = primaryCategorySlug(suggestion);
  if (primary && CATEGORY_VISIT_DURATION_MINUTES[primary]) {
    return CATEGORY_VISIT_DURATION_MINUTES[primary];
  }

  for (const category of suggestion.categories) {
    const duration = CATEGORY_VISIT_DURATION_MINUTES[category.slug];
    if (duration) {
      return duration;
    }
  }

  return DEFAULT_VISIT_DURATION_MINUTES;
}

export function primaryCategorySlug(suggestion: PlaceSuggestion): string | null {
  return suggestion.categories.find((category) => category.isPrimary)?.slug ?? suggestion.categories[0]?.slug ?? null;
}

export function hasCategory(suggestion: PlaceSuggestion, slug: string): boolean {
  return suggestion.categories.some((category) => category.slug === slug);
}

function hasAnyCategory(suggestion: PlaceSuggestion, slugs: readonly string[]): boolean {
  return suggestion.categories.some((category) => slugs.includes(category.slug));
}

function minScenarioVisitDurationMinutes(scenarioKey: PlaceScenarioKey): number {
  return Math.min(
    ...SCENARIO_CATEGORIES[scenarioKey].map((categorySlug) => (
      CATEGORY_VISIT_DURATION_MINUTES[categorySlug] ?? DEFAULT_VISIT_DURATION_MINUTES
    ))
  );
}

function moscowMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}
