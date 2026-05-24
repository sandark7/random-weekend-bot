import type Database from "better-sqlite3";
import type { AppConfig } from "../config.js";
import { boundingBox, haversineDistanceMeters } from "../geo/distance.js";
import { isOpenNow, parseOpeningHoursJson } from "../shared/openingHours.js";
import type { CategorySlug, OpeningHoursJson, PlaceSuggestion } from "../shared/types.js";

type PlaceRow = {
  placeId: number;
  name: string;
  categoriesJson: string;
  description: string | null;
  address: string | null;
  latitude: number;
  longitude: number;
  openingHoursText: string | null;
  openingHoursJson: string | OpeningHoursJson | null;
};

type NearbyOptions = {
  lat: number;
  lon: number;
  radiusMeters?: number;
  now?: Date;
  categorySlug?: CategorySlug;
  limit?: number;
};

type RandomOptions = {
  now?: Date;
  categorySlug?: CategorySlug;
  limit?: number;
};

type PlaceCategorySummary = {
  slug: CategorySlug;
  name: string;
  isPrimary: boolean;
};

export class PlaceRepository {
  private readonly radiusMeters: number;

  constructor(
    private readonly sqlite: Database.Database,
    config: Pick<AppConfig, "SEARCH_RADIUS_METERS">
  ) {
    this.radiusMeters = config.SEARCH_RADIUS_METERS;
  }

  findNearby(options: NearbyOptions): PlaceSuggestion[] {
    const radiusMeters = options.radiusMeters ?? this.radiusMeters;
    const now = options.now ?? new Date();
    const box = boundingBox({ lat: options.lat, lon: options.lon }, radiusMeters);

    const categoryClause = options.categorySlug
      ? `
        AND EXISTS (
          SELECT 1
          FROM place_categories pc_filter
          JOIN categories c_filter ON c_filter.id = pc_filter.category_id
          WHERE pc_filter.place_id = p.id AND c_filter.slug = @categorySlug
        )
      `
      : "";
    const rows = this.sqlite
      .prepare(
        `
        SELECT
          p.id AS placeId,
          p.display_name AS name,
          p.description AS description,
          p.address AS address,
          p.latitude AS latitude,
          p.longitude AS longitude,
          p.opening_hours_text AS openingHoursText,
          p.opening_hours_json AS openingHoursJson,
          (
            SELECT json_group_array(
              json_object(
                'slug', c.slug,
                'name', c.name,
                'isPrimary', pc.is_primary
              )
            )
            FROM place_categories pc
            JOIN categories c ON c.id = pc.category_id
            WHERE pc.place_id = p.id
            ORDER BY pc.is_primary DESC, c.name
          ) AS categoriesJson
        FROM places p
        WHERE p.is_active = 1
          AND p.latitude IS NOT NULL
          AND p.longitude IS NOT NULL
          AND p.opening_hours_json IS NOT NULL
          AND p.latitude BETWEEN @minLat AND @maxLat
          AND p.longitude BETWEEN @minLon AND @maxLon
          ${categoryClause}
        LIMIT @limit
        `
      )
      .all({
        minLat: box.minLat,
        maxLat: box.maxLat,
        minLon: box.minLon,
        maxLon: box.maxLon,
        categorySlug: options.categorySlug,
        limit: Math.max(options.limit ?? 100, 1)
      }) as PlaceRow[];

    return rows
      .map((row) => this.toSuggestion(row, options.lat, options.lon))
      .filter((suggestion) => suggestion.distanceMeters <= radiusMeters)
      .filter((suggestion) => isOpenNow(suggestion.openingHoursJson, now) === true)
      .sort((left, right) => left.distanceMeters - right.distanceMeters);
  }

  suggestNearby(options: NearbyOptions): PlaceSuggestion | null {
    const suggestions = this.findNearby(options);
    if (suggestions.length === 0) {
      return null;
    }

    return suggestions[Math.floor(Math.random() * suggestions.length)];
  }

  randomOpenPlace(options: RandomOptions = {}): PlaceSuggestion | null {
    const now = options.now ?? new Date();
    const categoryClause = options.categorySlug
      ? `
        AND EXISTS (
          SELECT 1
          FROM place_categories pc_filter
          JOIN categories c_filter ON c_filter.id = pc_filter.category_id
          WHERE pc_filter.place_id = p.id AND c_filter.slug = @categorySlug
        )
      `
      : "";
    const rows = this.sqlite
      .prepare(
        `
        SELECT
          p.id AS placeId,
          p.display_name AS name,
          p.description AS description,
          p.address AS address,
          p.latitude AS latitude,
          p.longitude AS longitude,
          p.opening_hours_text AS openingHoursText,
          p.opening_hours_json AS openingHoursJson,
          (
            SELECT json_group_array(
              json_object(
                'slug', c.slug,
                'name', c.name,
                'isPrimary', pc.is_primary
              )
            )
            FROM place_categories pc
            JOIN categories c ON c.id = pc.category_id
            WHERE pc.place_id = p.id
            ORDER BY pc.is_primary DESC, c.name
          ) AS categoriesJson
        FROM places p
        WHERE p.is_active = 1
          AND p.latitude IS NOT NULL
          AND p.longitude IS NOT NULL
          AND p.opening_hours_json IS NOT NULL
          ${categoryClause}
        ORDER BY RANDOM()
        LIMIT @limit
        `
      )
      .all({
        categorySlug: options.categorySlug,
        limit: Math.max(options.limit ?? 200, 1)
      }) as PlaceRow[];

    const suggestions = rows
      .map((row) => this.toSuggestion(row, row.latitude, row.longitude))
      .filter((suggestion) => isOpenNow(suggestion.openingHoursJson, now) === true);

    if (suggestions.length === 0) {
      return null;
    }

    return suggestions[Math.floor(Math.random() * suggestions.length)];
  }

  private toSuggestion(row: PlaceRow, originLat: number, originLon: number): PlaceSuggestion {
    return {
      placeId: row.placeId,
      name: row.name,
      categories: parseCategories(row.categoriesJson),
      description: row.description,
      address: row.address,
      lat: row.latitude,
      lon: row.longitude,
      distanceMeters: Math.round(
        haversineDistanceMeters(
          { lat: originLat, lon: originLon },
          { lat: row.latitude, lon: row.longitude }
        )
      ),
      openingHoursText: row.openingHoursText,
      openingHoursJson: parseOpeningHoursJson(row.openingHoursJson)
    };
  }
}

function parseCategories(value: string | null): PlaceCategorySummary[] {
  if (!value) {
    return [];
  }

  const parsed = JSON.parse(value) as Array<{
    slug: CategorySlug;
    name: string;
    isPrimary: 0 | 1 | boolean;
  }>;

  return parsed.map((category) => ({
    slug: category.slug,
    name: category.name,
    isPrimary: category.isPrimary === true || category.isPrimary === 1
  }));
}
