import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { AppConfig } from "../config.js";
import * as schema from "./schema.js";

export type DatabaseHandle = ReturnType<typeof openDatabase>;

export function openDatabase(config: Pick<AppConfig, "DATABASE_PATH">) {
  const sqlite = new Database(config.DATABASE_PATH);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");

  const db = drizzle(sqlite, { schema });

  return {
    sqlite,
    db,
    close: () => sqlite.close()
  };
}
