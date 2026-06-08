import { parse } from "csv-parse/sync";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import {
  categoryCsvRowSchema,
  parseOpeningHoursCell,
  placeCategoryCsvRowSchema,
  placeCsvRowSchema
} from "../src-node/import/csvSchemas.js";
import {
  SUPPORTED_CITIES,
  findSupportedCityById,
  isInsideBoundingBox
} from "../src-node/geo/supportedCities.js";

type CsvRow = Record<string, string>;

type CliOptions = {
  dir: string;
  report?: string;
};

const VALIDATION_HEADERS = ["check", "status", "count", "details"];

function main(): void {
  const options = parseCliOptions(process.argv.slice(2));
  const categories = readCsv(join(options.dir, "categories.csv"));
  const places = readCsv(join(options.dir, "places.csv"));
  const placeCategories = readCsv(join(options.dir, "place_categories.csv"));
  const metadata = existsSync(join(options.dir, "day_place_metadata.csv"))
    ? readCsv(join(options.dir, "day_place_metadata.csv"))
    : [];

  const report = validate(categories, places, placeCategories, metadata);
  const hasFailures = report.some((row) => row.status === "failed");

  if (options.report) {
    writeCsv(options.report, VALIDATION_HEADERS, report);
  }

  process.stdout.write(`${JSON.stringify({
    dir: options.dir,
    categories: categories.length,
    places: places.length,
    placeCategories: placeCategories.length,
    metadata: metadata.length,
    failedChecks: report.filter((row) => row.status === "failed").map((row) => row.check)
  }, null, 2)}\n`);

  if (hasFailures) {
    process.exit(1);
  }
}

function validate(categories: CsvRow[], places: CsvRow[], placeCategories: CsvRow[], metadata: CsvRow[]): CsvRow[] {
  const report: CsvRow[] = [];
  const categorySlugs = new Set(categories.map((row) => row.slug));
  const placeIds = new Set(places.map((row) => row.external_id));
  const linkKeys = placeCategories.map((row) => `${row.place_external_id}::${row.category_slug}`);

  const categoryParseErrors = categories
    .map((row, index) => ({ index, result: categoryCsvRowSchema.safeParse(row) }))
    .filter((item) => !item.result.success);
  const placeParseErrors = places
    .map((row, index) => ({ index, result: placeCsvRowSchema.safeParse(row) }))
    .filter((item) => !item.result.success);
  const linkParseErrors = placeCategories
    .map((row, index) => ({ index, result: placeCategoryCsvRowSchema.safeParse(row) }))
    .filter((item) => !item.result.success);

  add(report, "categories_schema", categoryParseErrors.length === 0, categoryParseErrors.length, formatErrors(categoryParseErrors));
  add(report, "places_schema", placeParseErrors.length === 0, placeParseErrors.length, formatErrors(placeParseErrors));
  add(report, "place_categories_schema", linkParseErrors.length === 0, linkParseErrors.length, formatErrors(linkParseErrors));
  add(report, "unique_places_external_id", uniqueCount(places.map((row) => row.external_id)) === places.length, places.length, "");
  add(report, "unique_categories_slug", uniqueCount(categories.map((row) => row.slug)) === categories.length, categories.length, "");
  add(report, "unique_place_category_pair", uniqueCount(linkKeys) === linkKeys.length, linkKeys.length, "");
  add(
    report,
    "place_category_refs_exist",
    placeCategories.every((row) => placeIds.has(row.place_external_id) && categorySlugs.has(row.category_slug)),
    placeCategories.length,
    ""
  );
  add(
    report,
    "places_have_category",
    places.every((place) => placeCategories.some((category) => category.place_external_id === place.external_id)),
    places.length,
    ""
  );
  add(
    report,
    "one_primary_category_per_place",
    places.every((place) =>
      placeCategories.filter((category) => (
        category.place_external_id === place.external_id &&
        normalizeBooleanText(category.is_primary) === "true"
      )).length === 1
    ),
    places.length,
    ""
  );
  add(
    report,
    "coords_inside_supported_city_bbox_when_present",
    places.every((row) => {
      const lat = parseNullableNumber(row.latitude);
      const lon = parseNullableNumber(row.longitude);
      return lat === null || lon === null || isInsideSupportedCityBbox(lat, lon);
    }),
    places.length,
    ""
  );
  add(
    report,
    "city_slug_matches_coords_when_present",
    places.every((row) => {
      const citySlug = normalizeNullableText(row.city_slug);
      if (!citySlug) {
        return true;
      }

      const city = findSupportedCityById(citySlug);
      const lat = parseNullableNumber(row.latitude);
      const lon = parseNullableNumber(row.longitude);
      return Boolean(city) && (
        lat === null ||
        lon === null ||
        isInsideBoundingBox(lat, lon, city!.bbox)
      );
    }),
    places.length,
    ""
  );
  add(
    report,
    "opening_hours_json_valid_when_present",
    places.every((row) => {
      if (!row.opening_hours_json) {
        return true;
      }
      try {
        parseOpeningHoursCell(row.opening_hours_json);
        return true;
      } catch {
        return false;
      }
    }),
    places.length,
    ""
  );

  if (metadata.length > 0) {
    add(
      report,
      "day_metadata_refs_exist",
      metadata.every((row) => placeIds.has(row.place_external_id)),
      metadata.length,
      ""
    );
    add(
      report,
      "day_metadata_values_valid",
      metadata.every((row) =>
        /^\d+$/.test(row.visit_duration_min) &&
        ["indoor", "outdoor", "mixed"].includes(row.indoor_outdoor) &&
        ["true", "false", "unknown"].includes(row.weather_sensitive) &&
        ["true", "false", "unknown"].includes(row.requires_ticket) &&
        ["true", "false", "unknown"].includes(row.requires_booking) &&
        ["morning", "day", "afternoon", "evening", "any"].includes(row.best_time_of_day) &&
        ["short_city_stop", "day_activity", "long_activity", "outdoor_pause", "evening_finish"].includes(row.day_slot)
      ),
      metadata.length,
      ""
    );
  }

  return report;
}

function readCsv(filePath: string): CsvRow[] {
  return parse(readFileSync(filePath, "utf8"), {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as CsvRow[];
}

function writeCsv(filePath: string, headers: string[], rows: CsvRow[]): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(
    filePath,
    `${[
      headers.join(","),
      ...rows.map((row) => headers.map((header) => formatCsvCell(row[header] ?? "")).join(","))
    ].join("\n")}\n`,
    "utf8"
  );
}

function add(rows: CsvRow[], check: string, ok: boolean, count: number, details: string): void {
  rows.push({
    check,
    status: ok ? "ok" : "failed",
    count: String(count),
    details
  });
}

function formatErrors(items: Array<{ index: number }>): string {
  return items.slice(0, 5).map((item) => `line ${item.index + 2}`).join("; ");
}

function formatCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function normalizeBooleanText(value: string | undefined): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "y", "да"].includes(normalized) ? "true" : "false";
}

function parseNullableNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeNullableText(value: string | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function isInsideSupportedCityBbox(lat: number, lon: number): boolean {
  return SUPPORTED_CITIES.some((city) => (
    isInsideBoundingBox(lat, lon, city.bbox)
  ));
}

function uniqueCount(values: string[]): number {
  return new Set(values).size;
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    dir: "./data/import"
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    switch (arg) {
      case "--dir":
        options.dir = requireValue(arg, next);
        index += 1;
        break;
      case "--report":
        options.report = requireValue(arg, next);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.dir = resolve(options.dir);
  options.report = options.report ? resolve(options.report) : undefined;
  return options;
}

function requireValue(arg: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) {
    throw new Error(`${arg} requires a value`);
  }
  return value;
}

main();
