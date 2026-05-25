import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "../src-node/config.js";
import { openDatabase } from "../src-node/db/client.js";
import { PlaceRepository } from "../src-node/db/placeRepository.js";
import { categoryCsvRowSchema, placeCsvRowSchema } from "../src-node/import/csvSchemas.js";
import { importCsv } from "../src-node/import/importCsv.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("CSV import and repository", () => {
  it("imports seed CSV and finds a nearby open place", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "random-weekend-bot-"));
    tempDirs.push(tempDir);

    const config = makeTestConfig(join(tempDir, "bot.sqlite"));

    const result = importCsv(config);
    expect(result.places).toBeGreaterThan(0);
    expect(result.placeCategories).toBeGreaterThan(0);

    const handle = openDatabase(config);
    try {
      const repo = new PlaceRepository(handle.sqlite, config);
      const suggestions = repo.findNearby({
        lat: 55.7680130621237,
        lon: 37.6235032917141,
        now: new Date("2026-05-23T09:00:00Z")
      });

      expect(suggestions[0]?.name).toBe("Probka");
      expect(suggestions[0]?.categories[0]).toMatchObject({ slug: "restaurant", isPrimary: true });
      expect(suggestions[0]?.distanceMeters).toBe(0);
    } finally {
      handle.close();
    }
  });

  it("keeps Cafe Pushkin coordinates and mixed opening hours", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "random-weekend-bot-"));
    tempDirs.push(tempDir);

    const config = makeTestConfig(join(tempDir, "bot.sqlite"));
    importCsv(config);

    const handle = openDatabase(config);
    try {
      const row = handle.sqlite
        .prepare(
          "SELECT address, latitude, longitude, opening_hours_json AS openingHoursJson FROM places WHERE external_id = 'greatlist-msk-restaurant-pushkin'"
        )
        .get() as { address: string; latitude: number; longitude: number; openingHoursJson: string } | undefined;

      expect(row?.address).toBe("Тверской бульвар, 26А");
      expect(row?.latitude).toBe(55.76370899997232);
      expect(row?.longitude).toBe(37.60489706922942);
      expect(JSON.parse(row?.openingHoursJson ?? "{}").weekly.mon).toEqual([
        { from: "09:00", to: "00:00", next_day: true }
      ]);
    } finally {
      handle.close();
    }
  });

  it("allows categories to be extended from CSV", () => {
    expect(
      categoryCsvRowSchema.parse({
        slug: "city_cafe",
        name: "Городские кафе"
      })
    ).toEqual({
      slug: "city_cafe",
      name: "Городские кафе"
    });
  });

  it("allows mixed opening hours with all-day weekend intervals", () => {
    expect(() =>
      placeCsvRowSchema.parse({
        external_id: "pushkin-test",
        display_name: "Кафе Пушкинъ",
        description: "",
        address: "Тверской бульвар, 26А",
        latitude: "55.76370899997232",
        longitude: "37.60489706922942",
        opening_hours_text: "Пн-Чт 09:00–00:00; Пт-Вс круглосуточно",
        opening_hours_json: JSON.stringify({
          timezone: "Europe/Moscow",
          weekly: {
            mon: [{ from: "09:00", to: "00:00", next_day: true }],
            tue: [{ from: "09:00", to: "00:00", next_day: true }],
            wed: [{ from: "09:00", to: "00:00", next_day: true }],
            thu: [{ from: "09:00", to: "00:00", next_day: true }],
            fri: [{ from: "00:00", to: "00:00", next_day: true }],
            sat: [{ from: "00:00", to: "00:00", next_day: true }],
            sun: [{ from: "00:00", to: "00:00", next_day: true }]
          }
        }),
        source: "test",
        source_url: "",
        is_active: "true"
      })
    ).not.toThrow();
  });

  it("allows source-only place rows before enrichment", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "random-weekend-bot-"));
    tempDirs.push(tempDir);

    const config = makeTestConfig(join(tempDir, "bot.sqlite"));
    const result = importCsv(config);

    expect(result.places).toBeGreaterThan(6);
  });

  it("deletes places and replaces category links that are absent from the latest CSV import", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "random-weekend-bot-"));
    tempDirs.push(tempDir);

    const importDir = join(tempDir, "import");
    const config = makeTestConfig(join(tempDir, "bot.sqlite"), importDir);

    writeMinimalImportDir(importDir, "first-place", "Первое место");
    importCsv(config);

    writeMinimalImportDir(importDir, "second-place", "Второе место");
    importCsv(config);

    const handle = openDatabase(config);
    try {
      const rows = handle.sqlite
        .prepare("SELECT external_id AS externalId, is_active AS isActive FROM places ORDER BY external_id")
        .all() as Array<{ externalId: string; isActive: 0 | 1 }>;
      const categoryLinks = handle.sqlite.prepare("SELECT COUNT(*) AS count FROM place_categories").get() as {
        count: number;
      };

      expect(rows).toEqual([
        { externalId: "second-place", isActive: 1 }
      ]);
      expect(categoryLinks.count).toBe(1);
    } finally {
      handle.close();
    }
  });

  it("deletes categories that are absent from the latest CSV import", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "random-weekend-bot-"));
    tempDirs.push(tempDir);

    const importDir = join(tempDir, "import");
    const config = makeTestConfig(join(tempDir, "bot.sqlite"), importDir);

    writeMinimalImportDir(importDir, "test-place", "Тестовое место", [
      ["restaurant", "Ресторан"],
      ["city_cafe", "Городские кафе"]
    ], [
      ["test-place", "restaurant", "true"],
      ["test-place", "city_cafe", "false"]
    ]);
    importCsv(config);

    writeMinimalImportDir(importDir, "test-place", "Тестовое место");
    importCsv(config);

    const handle = openDatabase(config);
    try {
      const categorySlugs = handle.sqlite
        .prepare("SELECT slug FROM categories ORDER BY slug")
        .all() as Array<{ slug: string }>;
      const categoryLinks = handle.sqlite.prepare("SELECT COUNT(*) AS count FROM place_categories").get() as {
        count: number;
      };

      expect(categorySlugs).toEqual([{ slug: "restaurant" }]);
      expect(categoryLinks.count).toBe(1);
    } finally {
      handle.close();
    }
  });

  it("rejects duplicate place/category pairs before writing to SQLite", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "random-weekend-bot-"));
    tempDirs.push(tempDir);

    const importDir = join(tempDir, "import");
    const config = makeTestConfig(join(tempDir, "bot.sqlite"), importDir);

    writeMinimalImportDir(importDir, "test-place", "Тестовое место", [["restaurant", "Ресторан"]], [
      ["test-place", "restaurant", "true"],
      ["test-place", "restaurant", "false"]
    ]);

    expect(() => importCsv(config)).toThrow(/Duplicate place\/category pair/);
  });
});

function makeTestConfig(databasePath: string, importDir = resolve("data/import")): AppConfig {
  return {
    NODE_ENV: "test",
    BOT_TOKEN: "test-token",
    BOT_MODE: "polling",
    HOST: "127.0.0.1",
    PORT: 3000,
    DATABASE_PATH: databasePath,
    IMPORT_DIR: importDir,
    SEARCH_RADIUS_METERS: 1500,
    GEOCODER_URL: "https://nominatim.openstreetmap.org/search",
    GEOCODER_USER_AGENT: "random-weekend-bot-test/0.2",
    GEOCODER_ACCEPT_LANGUAGE: "ru",
    GEOCODER_COUNTRY_CODES: "ru",
    GEOCODER_CITY_BIAS: "Москва",
    GEOCODER_VIEWBOX: "37.15,56.05,38.10,55.45",
    GEOCODER_BOUNDED: true,
    GEOCODER_TIMEOUT_MS: 5000,
    GEOCODER_MIN_INTERVAL_MS: 0,
    MAX_TEXT_INPUT_LENGTH: 300,
    CHAT_COOLDOWN_MS: 0,
    LOG_LEVEL: "silent"
  };
}

function writeMinimalImportDir(
  importDir: string,
  externalId: string,
  displayName: string,
  categoryRows: Array<[string, string]> = [["restaurant", "Ресторан"]],
  placeCategoryRows: Array<[string, string, string]> = [[externalId, "restaurant", "true"]]
): void {
  mkdirSync(importDir, { recursive: true });

  writeFileSync(
    join(importDir, "categories.csv"),
    [
      "slug,name",
      ...categoryRows.map((row) => csvLine(row))
    ].join("\n"),
    "utf8"
  );
  writeFileSync(
    join(importDir, "places.csv"),
    [
      "external_id,display_name,description,address,latitude,longitude,opening_hours_text,opening_hours_json,source,source_url,is_active",
      csvLine([
        externalId,
        displayName,
        "",
        "Тестовая улица, 1, Москва",
        "55.75",
        "37.61",
        "Круглосуточно",
        JSON.stringify(allDayOpeningHours()),
        "test",
        "",
        "true"
      ])
    ].join("\n"),
    "utf8"
  );
  writeFileSync(
    join(importDir, "place_categories.csv"),
    [
      "place_external_id,category_slug,is_primary",
      ...placeCategoryRows.map((row) => csvLine(row))
    ].join("\n"),
    "utf8"
  );
}

function csvLine(values: string[]): string {
  return values
    .map((value) => {
      if (!/[",\n]/.test(value)) {
        return value;
      }
      return `"${value.replaceAll('"', '""')}"`;
    })
    .join(",");
}

function allDayOpeningHours(): unknown {
  return {
    timezone: "Europe/Moscow",
    weekly: {
      mon: [{ from: "00:00", to: "00:00", next_day: true }],
      tue: [{ from: "00:00", to: "00:00", next_day: true }],
      wed: [{ from: "00:00", to: "00:00", next_day: true }],
      thu: [{ from: "00:00", to: "00:00", next_day: true }],
      fri: [{ from: "00:00", to: "00:00", next_day: true }],
      sat: [{ from: "00:00", to: "00:00", next_day: true }],
      sun: [{ from: "00:00", to: "00:00", next_day: true }]
    }
  };
}
