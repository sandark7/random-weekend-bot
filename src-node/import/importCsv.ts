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
  const primaryByPlace = new Map<string, number>();

  for (const row of placeCategoryRows) {
    if (!placeExternalIds.has(row.place_external_id)) {
      throw new Error(`Unknown place_external_id in place_categories.csv: ${row.place_external_id}`);
    }
    if (!categorySlugs.has(row.category_slug)) {
      throw new Error(`Unknown category_slug in place_categories.csv: ${row.category_slug}`);
    }
    if (row.is_primary) {
      primaryByPlace.set(row.place_external_id, (primaryByPlace.get(row.place_external_id) ?? 0) + 1);
    }
  }

  for (const row of placeRows) {
    if (!placeCategoryRows.some((category) => category.place_external_id === row.external_id)) {
      throw new Error(`Place has no categories in place_categories.csv: ${row.external_id}`);
    }
  }

  for (const [externalId, primaryCount] of primaryByPlace) {
    if (primaryCount > 1) {
      throw new Error(`Place has more than one primary category: ${externalId}`);
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
        name: row.name,
        type: row.type
      })
      .onConflictDoUpdate({
        target: categories.slug,
        set: {
          name: row.name,
          type: row.type
        }
      })
      .run();
  }
}

function upsertPlaces(db: ReturnType<typeof openDatabase>["db"], rows: PlaceCsvRow[]): void {
  for (const row of rows) {
    const openingHoursJson = parseOpeningHoursCell(row.opening_hours_json);

    db.insert(places)
      .values({
        externalId: row.external_id,
        displayName: row.display_name,
        description: row.description,
        address: row.address,
        latitude: row.latitude,
        longitude: row.longitude,
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
