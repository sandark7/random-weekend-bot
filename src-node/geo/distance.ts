export type Coordinates = {
  lat: number;
  lon: number;
};

const EARTH_RADIUS_METERS = 6_371_000;

export function haversineDistanceMeters(a: Coordinates, b: Coordinates): number {
  const lat1 = toRadians(a.lat);
  const lon1 = toRadians(a.lon);
  const lat2 = toRadians(b.lat);
  const lon2 = toRadians(b.lon);
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

export function boundingBox(center: Coordinates, radiusMeters: number): {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
} {
  const latDelta = radiusMeters / 111_320;
  const lonDelta =
    radiusMeters / (111_320 * Math.cos(toRadians(center.lat)) || 1);
  return {
    minLat: center.lat - latDelta,
    maxLat: center.lat + latDelta,
    minLon: center.lon - lonDelta,
    maxLon: center.lon + lonDelta
  };
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

