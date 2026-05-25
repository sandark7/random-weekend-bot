import type { PlaceRepository } from "../db/placeRepository.js";
import type { PlaceSuggestion } from "../shared/types.js";

export type NearbySuggestionResult = {
  suggestion: PlaceSuggestion;
  radiusMeters: number;
  radiusNote: string;
  resetRecentPlaces: boolean;
};

export function findNearbySuggestion(
  repo: PlaceRepository,
  options: {
    lat: number;
    lon: number;
    radiusMeters: number;
    categorySlugs?: readonly string[];
    excludePlaceIds: number[];
  }
): NearbySuggestionResult | null {
  const fallbackRadiusMeters = Math.max(options.radiusMeters * 2, 2500);
  const primarySuggestions = findNearbyByCategories(repo, {
    lat: options.lat,
    lon: options.lon,
    radiusMeters: options.radiusMeters,
    categorySlugs: options.categorySlugs,
    limit: 500
  });
  const primarySuggestion = pickRandomSuggestion(primarySuggestions, options.excludePlaceIds);
  if (primarySuggestion) {
    return {
      suggestion: primarySuggestion,
      radiusMeters: options.radiusMeters,
      radiusNote: "",
      resetRecentPlaces: false
    };
  }

  if (fallbackRadiusMeters > options.radiusMeters) {
    const fallbackSuggestions = findNearbyByCategories(repo, {
      lat: options.lat,
      lon: options.lon,
      radiusMeters: fallbackRadiusMeters,
      categorySlugs: options.categorySlugs,
      limit: 500
    });
    const fallbackSuggestion = pickRandomSuggestion(fallbackSuggestions, options.excludePlaceIds);
    if (fallbackSuggestion) {
      return {
        suggestion: fallbackSuggestion,
        radiusMeters: fallbackRadiusMeters,
        radiusNote: `В радиусе ${options.radiusMeters} м сейчас пусто, поэтому расширил поиск до ${fallbackRadiusMeters} м.`,
        resetRecentPlaces: false
      };
    }

    const repeatedFallbackSuggestion = pickRandomSuggestion(fallbackSuggestions, []);
    if (repeatedFallbackSuggestion) {
      return {
        suggestion: repeatedFallbackSuggestion,
        radiusMeters: fallbackRadiusMeters,
        radiusNote: "Все открытые места рядом уже показал, начинаю круг заново.",
        resetRecentPlaces: true
      };
    }
  }

  const repeatedPrimarySuggestion = pickRandomSuggestion(primarySuggestions, []);
  if (repeatedPrimarySuggestion) {
    return {
      suggestion: repeatedPrimarySuggestion,
      radiusMeters: options.radiusMeters,
      radiusNote: "Все открытые места рядом уже показал, начинаю круг заново.",
      resetRecentPlaces: true
    };
  }

  return null;
}

export function pickRandomSuggestion(
  suggestions: PlaceSuggestion[],
  excludePlaceIds: number[]
): PlaceSuggestion | null {
  const excluded = new Set(excludePlaceIds);
  const candidates = suggestions.filter((suggestion) => !excluded.has(suggestion.placeId));

  if (candidates.length === 0) {
    return null;
  }

  return candidates[Math.floor(Math.random() * candidates.length)];
}

export function findNearbyByCategories(
  repo: PlaceRepository,
  options: {
    lat: number;
    lon: number;
    radiusMeters: number;
    categorySlugs?: readonly string[];
    now?: Date;
    limit?: number;
  }
): PlaceSuggestion[] {
  if (!options.categorySlugs || options.categorySlugs.length === 0) {
    return repo.findNearby(options);
  }

  const byPlaceId = new Map<number, PlaceSuggestion>();
  for (const categorySlug of options.categorySlugs) {
    const suggestions = repo.findNearby({
      lat: options.lat,
      lon: options.lon,
      radiusMeters: options.radiusMeters,
      now: options.now,
      categorySlug,
      limit: options.limit
    });
    for (const suggestion of suggestions) {
      if (!byPlaceId.has(suggestion.placeId)) {
        byPlaceId.set(suggestion.placeId, suggestion);
      }
    }
  }

  const suggestions = [...byPlaceId.values()];
  const categorySlugs = new Set(options.categorySlugs);
  const primaryMatches = suggestions.filter((suggestion) => (
    suggestion.categories.some((category) => category.isPrimary && categorySlugs.has(category.slug))
  ));
  const sortableSuggestions = primaryMatches.length > 0 ? primaryMatches : suggestions;

  return sortableSuggestions.sort((left, right) => left.distanceMeters - right.distanceMeters);
}
