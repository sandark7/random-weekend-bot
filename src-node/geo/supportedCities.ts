export type BoundingBox = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
};

export type SupportedCityId = "moscow" | "krasnodar";

export type SupportedCity = {
  id: SupportedCityId;
  label: string;
  aliases: string[];
  bbox: BoundingBox;
  viewbox: string;
};

export const SUPPORTED_CITIES: readonly SupportedCity[] = [
  {
    id: "moscow",
    label: "Москва",
    aliases: ["москва", "москве", "москвы", "moscow"],
    bbox: {
      minLat: 55.45,
      maxLat: 56.05,
      minLon: 37.15,
      maxLon: 38.1
    },
    viewbox: "37.15,56.05,38.10,55.45"
  },
  {
    id: "krasnodar",
    label: "Краснодар",
    aliases: ["краснодар", "краснодаре", "краснодара", "krasnodar"],
    bbox: {
      minLat: 44.85,
      maxLat: 45.2,
      minLon: 38.75,
      maxLon: 39.25
    },
    viewbox: "38.75,45.20,39.25,44.85"
  }
];

export const DEFAULT_SUPPORTED_CITY = SUPPORTED_CITIES[0]!;

export function findSupportedCityByName(input: string | undefined): SupportedCity | null {
  const comparable = normalizeCityComparable(input ?? "");
  if (!comparable) {
    return null;
  }

  return SUPPORTED_CITIES.find((city) => (
    city.aliases.some((alias) => containsComparablePhrase(comparable, normalizeCityComparable(alias)))
  )) ?? null;
}

export function hasSupportedCityName(input: string): boolean {
  const comparable = normalizeCityComparable(input);
  return SUPPORTED_CITIES.some((city) => (
    city.aliases.some((alias) => containsComparablePhrase(comparable, normalizeCityComparable(alias)))
  ));
}

export function findSupportedCityById(cityId: string | null | undefined): SupportedCity | null {
  return SUPPORTED_CITIES.find((city) => city.id === cityId) ?? null;
}

export function findSupportedCityByCoordinates(
  lat: number | null | undefined,
  lon: number | null | undefined
): SupportedCity | null {
  if (lat === null || lat === undefined || lon === null || lon === undefined) {
    return null;
  }

  return SUPPORTED_CITIES.find((city) => isInsideBoundingBox(lat, lon, city.bbox)) ?? null;
}

export function isInsideBoundingBox(lat: number, lon: number, bbox: BoundingBox): boolean {
  return (
    lat >= bbox.minLat &&
    lat <= bbox.maxLat &&
    lon >= bbox.minLon &&
    lon <= bbox.maxLon
  );
}

export function containsComparablePhrase(value: string, phrase: string): boolean {
  if (!value || !phrase) {
    return false;
  }

  return value === phrase ||
    value.startsWith(`${phrase} `) ||
    value.endsWith(` ${phrase}`) ||
    value.includes(` ${phrase} `);
}

export function normalizeCityComparable(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[«»"']/g, "")
    .replace(/[.,:;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
