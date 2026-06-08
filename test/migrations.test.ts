import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runMigrations } from "../src-node/db/migrate.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("migrations", () => {
  it("creates analytics_events with indexes from one canonical analytics migration", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "random-weekend-migrations-"));
    tempDirs.push(tempDir);
    const databasePath = join(tempDir, "bot.sqlite");

    const result = runMigrations({ DATABASE_PATH: databasePath });

    expect(result.applied.filter((file) => file.includes("analytics_events"))).toEqual([
      "0009_analytics_events.sql"
    ]);

    const db = new Database(databasePath);
    try {
      const table = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'analytics_events'")
        .get();
      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'analytics_events' ORDER BY name")
        .all() as Array<{ name: string }>;

      expect(table).toEqual({ name: "analytics_events" });
      expect(indexes.map((row) => row.name)).toEqual([
        "idx_analytics_events_created_at",
        "idx_analytics_events_event_name",
        "idx_analytics_events_flow_id",
        "idx_analytics_events_session_id"
      ]);
    } finally {
      db.close();
    }
  });

  it("creates city-aware places metadata and persistent geocode cache", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "random-weekend-migrations-"));
    tempDirs.push(tempDir);
    const databasePath = join(tempDir, "bot.sqlite");

    const result = runMigrations({ DATABASE_PATH: databasePath });

    expect(result.applied).toContain("0010_city_slug_and_geocode_cache.sql");

    const db = new Database(databasePath);
    try {
      const placeColumns = db.prepare("PRAGMA table_info(places)").all() as Array<{ name: string }>;
      const geocodeCacheTable = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'geocode_cache'")
        .get();
      const placeIndexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'places'")
        .all() as Array<{ name: string }>;

      expect(placeColumns.map((row) => row.name)).toContain("city_slug");
      expect(geocodeCacheTable).toEqual({ name: "geocode_cache" });
      expect(placeIndexes.map((row) => row.name)).toContain("idx_places_city_slug");
    } finally {
      db.close();
    }
  });
});
