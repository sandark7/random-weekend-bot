import type { ResolvedLocation } from "../geo/locationResolver.js";
import type { PlaceScenarioKey, RouteDurationHours } from "../recommendation/scenarios.js";
import type { PlaceSuggestion } from "../shared/types.js";

const RECENT_PLACE_HISTORY_LIMIT = 30;

export type PendingConfirmation = {
  status: "needs_confirmation";
  confidence: "medium";
  kind: Exclude<ResolvedLocation, { status: "failed" }>["kind"];
  label: string;
  lat: number;
  lon: number;
  query: string;
  createdAt: number;
};

export type RouteStart = {
  placeId?: number;
  lat: number;
  lon: number;
  label: string;
};

export type LastAction =
  | { type: "scenario"; scenario: PlaceScenarioKey }
  | { type: "random" }
  | { type: "route"; durationHours: RouteDurationHours; routeStart?: RouteStart };

export type LastResultKind = "place" | "route" | null;

export type StoredRouteStep = {
  placeId: number;
  name: string;
  scenarioKey: PlaceScenarioKey;
  suggestion: PlaceSuggestion;
};

export type StoredRoute = {
  durationHours: RouteDurationHours;
  routeStart?: RouteStart;
  start: RouteStart;
  startedAtIso: string;
  steps: StoredRouteStep[];
};

export type LastLocation = {
  lat: number;
  lon: number;
  label: string;
  radiusMeters: number;
  recentPlaceIds: number[];
  lastAction: LastAction | null;
  lastSuggestedPlace: RouteStart | null;
  pendingRouteStart: RouteStart | null;
  lastRoute: StoredRoute | null;
  pendingRouteReplacement: boolean;
  pendingRouteReplacementExcludePlaceId: number | null;
  lastResultKind: LastResultKind;
  updatedAt: number;
};

export function appendRecentPlaceId(recentPlaceIds: number[], placeId: number): number[] {
  return [...recentPlaceIds.filter((recentPlaceId) => recentPlaceId !== placeId), placeId].slice(
    -RECENT_PLACE_HISTORY_LIMIT
  );
}

export function appendRecentPlaceIds(recentPlaceIds: number[], placeIds: number[]): number[] {
  return placeIds.reduce((recent, placeId) => appendRecentPlaceId(recent, placeId), recentPlaceIds);
}
