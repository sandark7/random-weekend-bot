export const MAX_ROUTE_WALK_MINUTES = 20;
export const WALKING_METERS_PER_MINUTE = 70;
export const WALKING_ROUTE_FACTOR = 1.25;
export const MAX_ROUTE_TRANSITION_METERS = Math.floor(
  (MAX_ROUTE_WALK_MINUTES * WALKING_METERS_PER_MINUTE) / WALKING_ROUTE_FACTOR
);

export function walkingMinutes(distanceMeters: number): number {
  return Math.max(1, Math.round((distanceMeters / WALKING_METERS_PER_MINUTE) * WALKING_ROUTE_FACTOR));
}
