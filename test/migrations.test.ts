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
});
