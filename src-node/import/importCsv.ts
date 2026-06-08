import { parse } from "csv-parse/sync";
import { eq, notInArray, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { ensureRuntimeDirectories, loadConfig, type AppConfig } from "../config.js";
import { openDatabase } from "../db/client.js";
import { runMigrations } from "../db/migrate.js";
import { categories, placeCategories, places } from "../db/schema.js";
import {
  findSupportedCityByCoordinates,
  findSupportedCityById,
  isInsideBoundingBox,
  type SupportedCityId
} from "../geo/supportedCities.js";
import { createLogger } from "../logger.js";
import {
  categoryCsvRowSchema,
  parseOpeningHoursCell,
  placeCategoryCsvRowSchema,
  placeCsvRowSchema,
  type CategoryCsvRow,
  type PlaceCategoryCsvRow,
  type PlaceCsvRow
} from "./csvSchemas.js";

type ImportResult = {
  categories: number;
  places: number;
  placeCategories: number;
};

export function importCsv(config: AppConfig): ImportResult {
  ensureRuntimeDirectories(config);
  runMigrations(config);

  const handle = openDatabase(config);
  try {
    const categoryRows = readCsv(resolve(config.IMPORT_DIR, "categories.csv"), categoryCsvRowSchema);
    const placeRows = readCsv(resolve(config.IMPORT_DIR, "places.csv"), placeCsvRowSchema);
    const placeCategoryRows = readCsv(
      resolve(config.IMPORT_DIR, "place_categories.csv"),
      placeCategoryCsvRowSchema
    );

    validateImportGraph(categoryRows, placeRows, placeCategoryRows);

    handle.sqlite.transaction(() => {
      upsertCategories(handle.db, categoryRows);
      deleteCategoriesAbsentFromCsv(handle.db, categoryRows);
      deletePlacesAbsentFromCsv(handle.db, placeRows);
      upsertPlaces(handle.db, placeRows);
      replacePlaceCategories(handle.db);
      upsertPlaceCategories(handle.db, placeCategoryRows);
    })();

    return {
      categories: categoryRows.length,
      places: placeRows.length,
      placeCategories: placeCategoryRows.length
    };
  } finally {
    handle.close();
  }
}

function deletePlacesAbsentFromCsv(db: ReturnType<typeof openDatabase>["db"], rows: PlaceCsvRow[]): void {
  const externalIds = rows.map((row) => row.external_id);
  if (externalIds.length === 0) {
    return;
  }

  db.delete(places)
    .where(notInArray(places.externalId, externalIds))
    .run();
}

function deleteCategoriesAbsentFromCsv(db: ReturnType<typeof openDatabase>["db"], rows: CategoryCsvRow[]): void {
  const slugs = rows.map((row) => row.slug);
  if (slugs.length === 0) {
    return;
  }

  db.delete(categories)
    .where(notInArray(categories.slug, slugs))
    .run();
}

function readCsv<T extends z.ZodTypeAny>(filePath: string, schema: T): Array<z.infer<T>> {
  const content = readFileSync(filePath, "utf8");
  const records = parse(content, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as unknown[];

  return records.map((record, index) => {
    const parsed = schema.safeParse(record);
    if (!parsed.success) {
      throw new Error(formatZodCsvError(filePath, index + 2, parsed.error));
    }
    return parsed.data;
  });
}

function validateImportGraph(
  categoryRows: CategoryCsvRow[],
  placeRows: PlaceCsvRow[],
  placeCategoryRows: PlaceCategoryCsvRow[]
): void {
  assertUnique(categoryRows.map((row) => row.slug), "categories.slug");
  assertUnique(placeRows.map((row) => row.external_id), "places.external_id");

  const categorySlugs = new Set(categoryRows.map((row) => row.slug));
  const placeExternalIds = new Set(placeRows.map((row) => row.external_id));
  const categoriesByPlace = new Map<string, PlaceCategoryCsvRow[]>();
  const placeCategoryPairs = new Set<string>();

  for (const row of placeCategoryRows) {
    if (!placeExternalIds.has(row.place_external_id)) {
      throw new Error(`Unknown place_external_id in place_categories.csv: ${row.place_external_id}`);
    }

    if (!categorySlugs.has(row.category_slug)) {
      throw new Error(`Unknown category_slug in place_categories.csv: ${row.category_slug}`);
    }

    const pairKey = `${row.place_external_id}::${row.category_slug}`;
    if (placeCategoryPairs.has(pairKey)) {
      throw new Error(
        `Duplicate place/category pair in place_categories.csv: ${row.place_external_id} / ${row.category_slug}`
      );
    }
    placeCategoryPairs.add(pairKey);

    const existing = categoriesByPlace.get(row.place_external_id) ?? [];
    existing.push(row);
    categoriesByPlace.set(row.place_external_id, existing);
  }

  for (const row of placeRows) {
    const placeCategoriesForPlace = categoriesByPlace.get(row.external_id) ?? [];

    if (placeCategoriesForPlace.length === 0) {
      throw new Error(`Place has no categories in place_categories.csv: ${row.external_id}`);
    }

    const primaryCount = placeCategoriesForPlace.filter((category) => category.is_primary).length;

    if (primaryCount !== 1) {
      throw new Error(
        `Place must have exactly one primary category in place_categories.csv: ${row.external_id}`
      );
    }

    if (row.city_slug && row.latitude !== null && row.longitude !== null) {
      const city = findSupportedCityById(row.city_slug);
      if (!city || !isInsideBoundingBox(row.latitude, row.longitude, city.bbox)) {
        throw new Error(`Place city_slug does not match coordinates in places.csv: ${row.external_id}`);
      }
    }
  }
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`Duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
}

function upsertCategories(db: ReturnType<typeof openDatabase>["db"], rows: CategoryCsvRow[]): void {
  for (const row of rows) {
    db.insert(categories)
      .values({
        slug: row.slug,
        name: row.name
      })
      .onConflictDoUpdate({
        target: categories.slug,
        set: {
          name: row.name
        }
      })
      .run();
  }
}

function upsertPlaces(db: ReturnType<typeof openDatabase>["db"], rows: PlaceCsvRow[]): void {
  for (const row of rows) {
    const openingHoursJson = parseOpeningHoursCell(row.opening_hours_json);
    const citySlug = resolvePlaceCitySlug(row);

    db.insert(places)
      .values({
        externalId: row.external_id,
        displayName: row.display_name,
        description: row.description,
        address: row.address,
        latitude: row.latitude,
        longitude: row.longitude,
        citySlug,
        openingHoursText: row.opening_hours_text,
        openingHoursJson,
        source: row.source,
        sourceUrl: row.source_url,
        isActive: row.is_active,
        updatedAt: sql`CURRENT_TIMESTAMP`
      })
      .onConflictDoUpdate({
        target: places.externalId,
        set: {
          displayName: row.display_name,
          description: row.description,
          address: row.address,
          latitude: row.latitude,
          longitude: row.longitude,
          citySlug,
          openingHoursText: row.opening_hours_text,
          openingHoursJson,
          source: row.source,
          sourceUrl: row.source_url,
          isActive: row.is_active,
          updatedAt: sql`CURRENT_TIMESTAMP`
        }
      })
      .run();
  }
}

function resolvePlaceCitySlug(row: PlaceCsvRow): SupportedCityId | null {
  if (row.city_slug) {
    return row.city_slug;
  }

  return findSupportedCityByCoordinates(row.latitude, row.longitude)?.id ?? null;
}

function upsertPlaceCategories(db: ReturnType<typeof openDatabase>["db"], rows: PlaceCategoryCsvRow[]): void {
  const placeByExternalId = new Map(db.select().from(places).all().map((place) => [place.externalId, place.id]));
  const categoryBySlug = new Map(db.select().from(categories).all().map((category) => [category.slug, category.id]));

  for (const row of rows) {
    const placeId = placeByExternalId.get(row.place_external_id);
    const categoryId = categoryBySlug.get(row.category_slug);

    if (!placeId) {
      throw new Error(`Unknown place external_id for place category: ${row.place_external_id}`);
    }
    if (!categoryId) {
      throw new Error(`Unknown category slug for place category: ${row.category_slug}`);
    }

    if (row.is_primary) {
      db.update(placeCategories)
        .set({
          isPrimary: false
        })
        .where(eq(placeCategories.placeId, placeId))
        .run();
    }

    db.insert(placeCategories)
      .values({
        placeId,
        categoryId,
        isPrimary: row.is_primary
      })
      .onConflictDoUpdate({
        target: [placeCategories.placeId, placeCategories.categoryId],
        set: {
          isPrimary: row.is_primary
        }
      })
      .run();
  }
}

function replacePlaceCategories(db: ReturnType<typeof openDatabase>["db"]): void {
  db.delete(placeCategories).run();
}

function formatZodCsvError(filePath: string, line: number, error: z.ZodError): string {
  const issues = error.issues
    .map((issue) => `${issue.path.join(".") || "row"}: ${issue.message}`)
    .join("; ");
  return `${filePath}:${line}: ${issues}`;
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  const config = loadConfig();
  const logger = createLogger(config);
  const result = importCsv(config);
  logger.info(result, "csv_import_complete");
}
