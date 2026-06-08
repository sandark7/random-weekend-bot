import type { AppConfig } from "../config.js";
import type { GeocodedAddress, Geocoder } from "./geocoder.js";
import {
  DEFAULT_SUPPORTED_CITY,
  SUPPORTED_CITIES,
  containsComparablePhrase,
  findSupportedCityByName,
  normalizeCityComparable,
  type BoundingBox,
  type SupportedCity,
  type SupportedCityId
} from "./supportedCities.js";

export type LocationInputKind = "exact_address" | "area_or_metro" | "poi" | "unknown";
export type LocationConfidence = "good" | "medium" | "low";

export type ResolvedLocation =
  | {
      status: "ok" | "needs_confirmation";
      confidence: Exclude<LocationConfidence, "low">;
      kind: Exclude<LocationInputKind, "unknown">;
      label: string;
      lat: number;
      lon: number;
      query: string;
      citySlug: SupportedCityId;
    }
  | {
      status: "failed";
      confidence: "low";
      kind: LocationInputKind;
      reason: string;
    };

type ExactAddressParts = {
  city: SupportedCity;
  street: string;
  streetName: string;
  streetType: string;
  houseNumber: string;
  label: string;
  queries: string[];
};

type KnownLocation = {
  label: string;
  aliases: string[];
  lat: number;
  lon: number;
  cityId: SupportedCityId;
};

const defaultCity = DEFAULT_SUPPORTED_CITY;

const preciseAddresstypes = new Set([
  "house",
  "building",
  "address",
  "amenity",
  "shop",
  "tourism",
  "office",
  "leisure"
]);

const preciseCategories = new Set([
  "building",
  "amenity",
  "shop",
  "tourism",
  "office",
  "leisure"
]);

export const knownLocations: KnownLocation[] = [
  {
    label: "Павелецкая",
    aliases: ["павелецкая", "павелецкий вокзал", "метро павелецкая", "paveletskaya"],
    lat: 55.73178,
    lon: 37.63674,
    cityId: "moscow"
  },
  {
    label: "Белорусская",
    aliases: ["белорусская", "метро белорусская", "белорусский вокзал", "belorusskaya"],
    lat: 55.77639,
    lon: 37.58459,
    cityId: "moscow"
  },
  {
    label: "Патриаршие пруды",
    aliases: ["патрики", "патриаршие", "патриаршие пруды", "patriki"],
    lat: 55.76383,
    lon: 37.59231,
    cityId: "moscow"
  },
  {
    label: "Цветной бульвар",
    aliases: ["цветной", "цветной бульвар", "метро цветной бульвар"],
    lat: 55.77163,
    lon: 37.6206,
    cityId: "moscow"
  },
  {
    label: "Москва-Сити",
    aliases: ["москва-сити", "москва сити", "деловой центр", "выставочная", "moscow city"],
    lat: 55.74754,
    lon: 37.5349,
    cityId: "moscow"
  },
  {
    label: "Чистые пруды",
    aliases: ["чистые пруды", "чистопрудный", "метро чистые пруды"],
    lat: 55.76515,
    lon: 37.63869,
    cityId: "moscow"
  },
  {
    label: "Зарядье",
    aliases: ["зарядье", "варварка", "китай-город"],
    lat: 55.75125,
    lon: 37.62896,
    cityId: "moscow"
  },
  {
    label: "Пятницкая",
    aliases: ["пятницкая", "новокузнецкая", "третьяковская"],
    lat: 55.73961,
    lon: 37.62812,
    cityId: "moscow"
  },
  {
    label: "Краснодар, центр",
    aliases: ["краснодар центр", "центр краснодара", "центр краснодар"],
    lat: 45.03547,
    lon: 38.97531,
    cityId: "krasnodar"
  },
  {
    label: "Краснодар, Красная улица",
    aliases: ["красная", "улица красная", "краснодар красная", "красная улица"],
    lat: 45.03547,
    lon: 38.97531,
    cityId: "krasnodar"
  },
  {
    label: "Парк Краснодар",
    aliases: ["парк краснодар", "парк галицкого", "галицкого", "стадион краснодар"],
    lat: 45.04211,
    lon: 39.03212,
    cityId: "krasnodar"
  }
];

export class LocationResolver {
  private readonly defaultCity: SupportedCity;

  constructor(
    private readonly geocoder: Geocoder,
    config: Pick<AppConfig, "GEOCODER_VIEWBOX" | "GEOCODER_CITY_BIAS">,
    private readonly locations = knownLocations
  ) {
    this.defaultCity = findSupportedCityByName(config.GEOCODER_CITY_BIAS) ?? defaultCity;
  }

  async resolve(input: string): Promise<ResolvedLocation> {
    const text = normalizeText(input);
    if (!text) {
      return {
        status: "failed",
        confidence: "low",
        kind: "unknown",
        reason: "empty"
      };
    }

    const cityContexts = cityContextsForInput(text, this.defaultCity);
    const exactAddresses = cityContexts
      .map((city) => parseExactAddress(text, city))
      .filter((address): address is ExactAddressParts => Boolean(address));
    if (exactAddresses.length > 0) {
      const result = await this.resolveExactAddresses(exactAddresses);
      if (result) {
        return result;
      }

      return {
        status: "failed",
        confidence: "low",
        kind: "exact_address",
        reason: "no_exact_address_match"
      };
    }

    const known = findKnownLocation(text, this.locations);
    if (known) {
      return {
        status: "ok",
        confidence: "good",
        kind: "area_or_metro",
        label: known.label,
        lat: known.lat,
        lon: known.lon,
        query: known.label,
        citySlug: known.cityId
      };
    }

    const kind = classifyLocationInput(text);
    if (kind === "area_or_metro" || kind === "poi") {
      return this.resolveLooseLocation(text, kind);
    }

    return {
      status: "failed",
      confidence: "low",
      kind,
      reason: "unclassified"
    };
  }

  private async resolveExactAddresses(addresses: ExactAddressParts[]): Promise<ResolvedLocation | null> {
    let firstPlausible: { address: ExactAddressParts; candidate: GeocodedAddress; query: string } | null = null;
    const maxQueryCount = Math.max(...addresses.map((address) => address.queries.length));

    for (let queryIndex = 0; queryIndex < maxQueryCount; queryIndex += 1) {
      for (const address of addresses) {
        const query = address.queries[queryIndex];
        if (!query) {
          continue;
        }

        const candidates = await this.geocoder.search(query, geocoderOptionsForCity(address.city, { limit: 8 }));
        const exact = candidates.find((candidate) => this.isExactAddressMatch(candidate, address));
        if (exact) {
          return {
            status: "ok",
            confidence: "good",
            kind: "exact_address",
            label: formatCandidateAddressLabel(exact, address),
            lat: exact.lat,
            lon: exact.lon,
            query,
            citySlug: address.city.id
          };
        }

        const plausible = candidates.find((candidate) => this.isPlausibleAddressCandidate(candidate, address));
        if (plausible && !firstPlausible) {
          firstPlausible = { address, candidate: plausible, query };
        }
      }
    }

    if (firstPlausible) {
      return {
        status: "needs_confirmation",
        confidence: "medium",
        kind: "exact_address",
        label: formatCandidateAddressLabel(firstPlausible.candidate, firstPlausible.address),
        lat: firstPlausible.candidate.lat,
        lon: firstPlausible.candidate.lon,
        query: firstPlausible.query,
        citySlug: firstPlausible.address.city.id
      };
    }

    return null;
  }

  private async resolveLooseLocation(
    text: string,
    kind: "area_or_metro" | "poi"
  ): Promise<ResolvedLocation> {
    for (const city of cityContextsForInput(text, this.defaultCity)) {
      const candidates = await this.geocoder.search(
        looseLocationQuery(text, city),
        geocoderOptionsForCity(city, { limit: 3 })
      );
      const candidate = candidates.find((item) => isInBoundingBox(item, city.bbox) && isCityResult(item, city));
      if (candidate) {
        return {
          status: "needs_confirmation",
          confidence: "medium",
          kind,
          label: formatLooseLocationLabel(candidate, text, city),
          lat: candidate.lat,
          lon: candidate.lon,
          query: candidate.query,
          citySlug: city.id
        };
      }
    }

    return {
      status: "failed",
      confidence: "low",
      kind,
      reason: "no_loose_location_match"
    };
  }

  private isExactAddressMatch(candidate: GeocodedAddress, address: ExactAddressParts): boolean {
    return (
      this.isPlausibleAddressCandidate(candidate, address) &&
      houseNumberMatches(candidate, address.houseNumber)
    );
  }

  private isPlausibleAddressCandidate(candidate: GeocodedAddress, address: ExactAddressParts): boolean {
    return (
      isCityResult(candidate, address.city) &&
      isInBoundingBox(candidate, address.city.bbox) &&
      isPreciseResult(candidate) &&
      streetMatches(candidate, address) &&
      !hasDifferentHouseNumber(candidate, address.houseNumber)
    );
  }
}

export function classifyLocationInput(input: string): LocationInputKind {
  const text = normalizeText(input);
  if (!text) {
    return "unknown";
  }

  if (parseExactAddress(text)) {
    return "exact_address";
  }

  if (findKnownLocation(text, knownLocations) || isAreaOrMetroLike(text)) {
    return "area_or_metro";
  }

  if (text.length >= 3) {
    return "poi";
  }

  return "unknown";
}

export function parseExactAddress(input: string, city: SupportedCity = defaultCity): ExactAddressParts | null {
  const withoutCity = stripCityFromAddressInput(normalizeText(input), city)
    .replace(/[,.]+/g, " ")
    .trim();
  const match = /^(.+?)\s+(?:д(?:ом)?\.?\s*)?(\d+[а-яa-z]?(?:[/-]\d+)?(?:\s*(?:с|стр|строение|к|корп|корпус)\.?\s*\d+[а-яa-z]?)?)$/iu.exec(
    withoutCity
  );

  if (!match) {
    return null;
  }

  const street = normalizeText(match[1]);
  const houseNumber = normalizeHouseNumber(match[2]);
  if (!street || !houseNumber || isMetroYearPhrase(street, houseNumber)) {
    return null;
  }

  const streetType = inferStreetType(street);
  const streetName = stripStreetType(street);
  if (!streetName) {
    return null;
  }

  const streetForQuery = `${streetName} ${streetType}`;
  const label = `${city.label}, ${streetForQuery}, ${houseNumber}`;
  const queries = uniqueStrings([
    label,
    `${city.label}, ${streetType} ${streetName}, ${houseNumber}`,
    `${city.label}, ${streetName}, ${houseNumber}`,
    `${streetType} ${streetName}, ${houseNumber}, ${city.label}`,
    `${streetName}, ${houseNumber}, ${city.label}`
  ]);

  return {
    city,
    street,
    streetName,
    streetType,
    houseNumber,
    label,
    queries
  };
}

function findKnownLocation(input: string, locations: KnownLocation[]): KnownLocation | null {
  const text = normalizeComparable(input);
  return locations.find((location) => (
    location.aliases.some((alias) => normalizeComparable(alias) === text)
  )) ?? null;
}

function cityContextsForInput(input: string, preferredCity: SupportedCity): SupportedCity[] {
  const explicitCity = findSupportedCityByName(input);
  if (explicitCity) {
    return [explicitCity];
  }

  return [
    preferredCity,
    ...SUPPORTED_CITIES.filter((city) => city.id !== preferredCity.id)
  ];
}

function geocoderOptionsForCity(
  city: SupportedCity,
  options: { limit?: number; layer?: string }
): { limit?: number; layer?: string; cityBias: string; citySlug: SupportedCityId; viewbox: string; bounded: boolean } {
  return {
    ...options,
    cityBias: city.label,
    citySlug: city.id,
    viewbox: city.viewbox,
    bounded: true
  };
}

function looseLocationQuery(input: string, city: SupportedCity): string {
  const stripped = stripCityFromAddressInput(input, city);
  return stripped ? `${city.label}, ${stripped}` : city.label;
}

function stripCityFromAddressInput(input: string, city: SupportedCity): string {
  let text = normalizeText(input);
  for (const alias of [...city.aliases].sort((left, right) => right.length - left.length)) {
    const aliasPattern = escapeRegExp(alias).replace(/\s+/g, "\\s+");
    text = text
      .replace(new RegExp(`^(?:г\\.?\\s*|город\\s*)?${aliasPattern}(?:\\s*,\\s*|\\s+)`, "iu"), "")
      .replace(new RegExp(`(?:\\s*,\\s*|\\s+)(?:г\\.?\\s*|город\\s*)?${aliasPattern}$`, "iu"), "")
      .replace(new RegExp(`^(?:г\\.?\\s*|город\\s*)?${aliasPattern}$`, "iu"), "")
      .trim();
  }

  return normalizeText(text);
}

function isAreaOrMetroLike(input: string): boolean {
  const text = normalizeComparable(input);
  return (
    /^(м|метро)\s+/.test(text) ||
    /(район|парк|пруды|бульвар|площадь|вокзал|сити)$/.test(text)
  );
}

function streetMatches(candidate: GeocodedAddress, address: ExactAddressParts): boolean {
  const expected = normalizeStreetForCompare(address.streetName);
  const values = [
    candidate.address?.road,
    candidate.address?.pedestrian,
    candidate.address?.footway,
    candidate.address?.cycleway,
    candidate.address?.neighbourhood,
    candidate.address?.suburb
  ].filter(Boolean) as string[];

  if (values.some((value) => streetNamesMatch(expected, normalizeStreetForCompare(value)))) {
    return true;
  }

  return normalizeStreetForCompare(candidate.displayName).includes(expected);
}

function streetNamesMatch(expected: string, actual: string): boolean {
  if (!expected || !actual) {
    return false;
  }
  return actual === expected || actual.includes(expected) || expected.includes(actual);
}

function houseNumberMatches(candidate: GeocodedAddress, expectedHouseNumber: string): boolean {
  const candidateHouseNumber = getCandidateHouseNumber(candidate);
  const candidateNormalized = normalizeHouseNumber(candidateHouseNumber);
  return (
    candidateNormalized === expectedHouseNumber ||
    candidateHouseNumberExtendsExpected(candidateNormalized, expectedHouseNumber)
  );
}

function hasDifferentHouseNumber(candidate: GeocodedAddress, expectedHouseNumber: string): boolean {
  const candidateHouseNumber = getCandidateHouseNumber(candidate);
  const candidateNormalized = normalizeHouseNumber(candidateHouseNumber);
  return (
    Boolean(candidateHouseNumber) &&
    candidateNormalized !== expectedHouseNumber &&
    !candidateHouseNumberExtendsExpected(candidateNormalized, expectedHouseNumber)
  );
}

function getCandidateHouseNumber(candidate: GeocodedAddress): string {
  if (candidate.address?.house_number) {
    return candidate.address.house_number;
  }

  const firstDisplayPart = candidate.displayName.split(",")[0]?.trim() ?? "";
  return /^\d/.test(firstDisplayPart) ? firstDisplayPart : "";
}

function isCityResult(candidate: GeocodedAddress, city: SupportedCity): boolean {
  const address = candidate.address;
  const values = [
    address?.city,
    address?.town,
    address?.municipality,
    address?.state,
    candidate.displayName
  ].map((value) => normalizeComparable(value ?? ""));

  return city.aliases.some((alias) => {
    const normalizedAlias = normalizeComparable(alias);
    return values.some((value) => containsComparablePhrase(value, normalizedAlias));
  });
}

function isInBoundingBox(candidate: GeocodedAddress, bbox: BoundingBox): boolean {
  return (
    candidate.lat >= bbox.minLat &&
    candidate.lat <= bbox.maxLat &&
    candidate.lon >= bbox.minLon &&
    candidate.lon <= bbox.maxLon
  );
}

function isPreciseResult(candidate: GeocodedAddress): boolean {
  return (
    preciseAddresstypes.has(candidate.addresstype ?? "") ||
    preciseCategories.has(candidate.category ?? "")
  );
}

function formatCandidateAddressLabel(candidate: GeocodedAddress, fallback: ExactAddressParts): string {
  const address = candidate.address;
  const city = fallback.city.label;
  const road = address?.road ?? address?.pedestrian ?? `${fallback.streetName} ${fallback.streetType}`;
  const house = address?.house_number;

  return house ? `${city}, ${road}, ${house}` : `${city}, ${road}`;
}

function formatLooseLocationLabel(candidate: GeocodedAddress, fallback: string, city: SupportedCity): string {
  const name = candidate.name?.trim();
  if (name) {
    return labelWithCity(name, city);
  }

  const address = candidate.address;
  const label = (
    address?.subway ??
    address?.railway ??
    address?.neighbourhood ??
    address?.suburb ??
    address?.amenity ??
    normalizeText(fallback)
  );
  return labelWithCity(label, city);
}

function labelWithCity(label: string, city: SupportedCity): string {
  const normalizedLabel = normalizeComparable(label);
  const alreadyHasCity = city.aliases.some((alias) => (
    containsComparablePhrase(normalizedLabel, normalizeComparable(alias))
  ));
  return alreadyHasCity ? label : `${city.label}, ${label}`;
}

function inferStreetType(value: string): string {
  const comparable = normalizeComparable(value);
  if (/(\bпер\b|переулок)/.test(comparable)) {
    return "переулок";
  }
  if (/(\bбул\b|бульвар)/.test(comparable)) {
    return "бульвар";
  }
  if (/(\bпросп\b|проспект)/.test(comparable)) {
    return "проспект";
  }
  if (/(\bнаб\b|набережная)/.test(comparable)) {
    return "набережная";
  }
  if (/(\bпл\b|площадь)/.test(comparable)) {
    return "площадь";
  }
  return "улица";
}

function stripStreetType(value: string): string {
  return normalizeText(value)
    .replace(/^(ул|улица|пер|переулок|бул|бульвар|просп|проспект|наб|набережная|пл|площадь)\.?\s+/i, "")
    .replace(/\s+(ул|улица|пер|переулок|бул|бульвар|просп|проспект|наб|набережная|пл|площадь)\.?$/i, "")
    .trim();
}

function normalizeStreetForCompare(value: string | undefined): string {
  return normalizeComparable(stripStreetType(value ?? ""));
}

function normalizeHouseNumber(value: string | undefined): string {
  return normalizeComparable(value ?? "")
    .replace(/\b(дом|д)\b/g, "")
    .replace(/\b(строение|стр)\b/g, "с")
    .replace(/\b(корпус|корп)\b/g, "к")
    .replace(/\s+/g, "")
    .replace(/\./g, "");
}

function normalizeComparable(value: string): string {
  return normalizeCityComparable(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isMetroYearPhrase(street: string, houseNumber: string): boolean {
  return /^(м|метро)$/i.test(normalizeComparable(street)) || /^\d{4}$/.test(houseNumber);
}

function candidateHouseNumberExtendsExpected(candidate: string, expected: string): boolean {
  return new RegExp(`^${escapeRegExp(expected)}(?:[а-яa-z]|с\\d|к\\d)`).test(candidate);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
