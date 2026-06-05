import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAnalytics,
  hashId,
  roundCoord,
  sanitizePayload
} from "../src-node/analytics/analytics.js";
import type { AppLogger } from "../src-node/logger.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("analytics", () => {
  it("hashes telegram ids and sanitizes private payload fields", () => {
    const db = createDatabaseWithAnalyticsTable();
    const logger = makeLogger();
    const analytics = createAnalytics({
      db,
      config: {
        ANALYTICS_ENABLED: true,
        ANALYTICS_SALT: "test-salt",
        APP_VERSION: "test"
      },
      logger
    });

    analytics.track("location_resolved", makeContext(), {
      query: "Тверская 7",
      rawText: "Тверская 7",
      locationLabel: "Москва, Тверская улица, 7",
      latRounded: roundCoord(55.758123),
      lonRounded: roundCoord(37.612987),
      kind: "exact_address"
    });

    const row = db.prepare("SELECT * FROM analytics_events").get() as {
      user_id_hash: string;
      chat_id_hash: string;
      session_id: string;
      app_version: string;
      payload_json: string;
    };
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;

    expect(row.user_id_hash).toBe(hashId(202, "test-salt"));
    expect(row.chat_id_hash).toBe(hashId(101, "test-salt"));
    expect(row.session_id).toContain(row.chat_id_hash);
    expect(row.app_version).toBe("test");
    expect(payload).toEqual({
      latRounded: 55.76,
      lonRounded: 37.61,
      kind: "exact_address"
    });
    expect(JSON.stringify(payload)).not.toContain("Тверская");
  });

  it("writes null hashes and warns once when salt is missing", () => {
    const db = createDatabaseWithAnalyticsTable();
    const logger = makeLogger();
    const analytics = createAnalytics({
      db,
      config: {
        ANALYTICS_ENABLED: true,
        ANALYTICS_SALT: undefined,
        APP_VERSION: "test"
      },
      logger
    });

    analytics.track("start", makeContext());
    analytics.track("random_selected", makeContext(), { hasLocation: false });

    const rows = db.prepare("SELECT user_id_hash, chat_id_hash, session_id FROM analytics_events").all() as Array<{
      user_id_hash: string | null;
      chat_id_hash: string | null;
      session_id: string;
    }>;

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      user_id_hash: null,
      chat_id_hash: null,
      session_id: expect.stringMatching(/:unknown$/)
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith("analytics_salt_missing");
  });

  it("is a no-op when analytics is disabled", () => {
    const db = createDatabaseWithAnalyticsTable();
    const logger = makeLogger();
    const analytics = createAnalytics({
      db,
      config: {
        ANALYTICS_ENABLED: false,
        ANALYTICS_SALT: "test-salt",
        APP_VERSION: "test"
      },
      logger
    });

    analytics.track("start", makeContext());

    expect(db.prepare("SELECT COUNT(*) AS count FROM analytics_events").get()).toEqual({ count: 0 });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("does not throw when the analytics table is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "random-weekend-analytics-"));
    tempDirs.push(dir);
    const db = new Database(join(dir, "missing.sqlite"));
    const logger = makeLogger();
    const analytics = createAnalytics({
      db,
      config: {
        ANALYTICS_ENABLED: true,
        ANALYTICS_SALT: "test-salt",
        APP_VERSION: "test"
      },
      logger
    });

    expect(() => analytics.track("start", makeContext())).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "start" }),
      "analytics_write_failed"
    );

    db.close();
  });

  it("removes private payload keys and compact undefined values", () => {
    expect(sanitizePayload({
      query: "Пятницкая 59",
      rawText: "Пятницкая 59",
      locationLabel: "Москва, Пятницкая улица, 59",
      scenario: "drink",
      empty: undefined
    })).toEqual({
      scenario: "drink"
    });
  });
});

function createDatabaseWithAnalyticsTable(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), "random-weekend-analytics-"));
  tempDirs.push(dir);
  const db = new Database(join(dir, "analytics.sqlite"));
  db.exec(`
    CREATE TABLE analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      event_name TEXT NOT NULL,
      user_id_hash TEXT,
      chat_id_hash TEXT,
      session_id TEXT NOT NULL,
      flow_id TEXT,
      app_version TEXT,
      payload_json TEXT NOT NULL
    );
  `);
  return db;
}

function makeContext() {
  return {
    from: { id: 202 },
    chat: { id: 101 }
  } as Parameters<ReturnType<typeof createAnalytics>["track"]>[1];
}

function makeLogger(): AppLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  } as unknown as AppLogger;
}
