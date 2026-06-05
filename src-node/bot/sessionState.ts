import type { ResolvedLocation } from "../geo/locationResolver.js";
import type { PlaceScenarioKey, RouteDurationHours } from "../recommendation/scenarios.js";
import type { PlaceSuggestion } from "../shared/types.js";

const RECENT_PLACE_HISTORY_LIMIT = 30;

export type PendingConfirmationIntent = {
  scenarioKey: PlaceScenarioKey;
  categorySlugs?: readonly string[];
  humanLabel: string;
};

export type PendingConfirmation = {
  status: "needs_confirmation";
  confidence: "medium";
  kind: Exclude<ResolvedLocation, { status: "failed" }>["kind"];
  label: string;
  lat: number;
  lon: number;
  query: string;
  createdAt: number;
  intent?: PendingConfirmationIntent;
};

export type RouteStart = {
  placeId?: number;
  lat: number;
  lon: number;
  label: string;
};

export type LastAction =
  | {
      type: "scenario";
      scenario: PlaceScenarioKey;
      categorySlugs?: readonly string[];
      humanLabel?: string;
    }
  | { type: "random" }
  | { type: "route"; durationHours: RouteDurationHours };

export type LastResultKind = "place" | "route" | null;

export type StoredRouteStep = {
  placeId: number;
  name: string;
  scenarioKey: PlaceScenarioKey;
  suggestion: PlaceSuggestion;
};

export type StoredRoute = {
  durationHours: RouteDurationHours;
  start: RouteStart;
  startedAtIso: string;
  steps: StoredRouteStep[];
};

export type PendingFeedbackTarget =
  | { type: "place"; placeId: number; scenario?: PlaceScenarioKey }
  | { type: "route"; durationHours: RouteDurationHours; placeIds: number[] };

export type LastLocation = {
  lat: number;
  lon: number;
  label: string;
  radiusMeters: number;
  recentPlaceIds: number[];
  lastAction: LastAction | null;
  lastSuggestedPlace: RouteStart | null;
  lastRoute: StoredRoute | null;
  pendingRouteReplacement: boolean;
  pendingRouteReplacementExcludePlaceId: number | null;
  pendingFeedbackTarget: PendingFeedbackTarget | null;
  lastResultKind: LastResultKind;
  updatedAt: number;
};

export function appendRecentPlaceId(recentPlaceIds: number[], placeId: number): number[] {
  return [...recentPlaceIds.filter((recentPlaceId) => recentPlaceId !== placeId), placeId].slice(
    -RECENT_PLACE_HISTORY_LIMIT
  );
}
