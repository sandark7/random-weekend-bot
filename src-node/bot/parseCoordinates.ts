export type ParsedCoordinates = {
  lat: number;
  lon: number;
};

const coordinatePattern = /(-?\d{1,3}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)/;

export function parseCoordinates(text: string): ParsedCoordinates | null {
  const match = coordinatePattern.exec(text);
  if (!match) {
    return null;
  }

  const first = Number(match[1].replace(",", "."));
  const second = Number(match[2].replace(",", "."));

  if (isValidLat(first) && isValidLon(second)) {
    return { lat: first, lon: second };
  }

  if (isValidLat(second) && isValidLon(first)) {
    return { lat: second, lon: first };
  }

  return null;
}

function isValidLat(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLon(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}
