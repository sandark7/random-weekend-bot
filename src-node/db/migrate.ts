import Database from "better-sqlite3";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig, type AppConfig } from "../config.js";
import { createLogger } from "../logger.js";

export type MigrationResult = {
  applied: string[];
  skipped: string[];
};

export function runMigrations(
  config: Pick<AppConfig, "DATABASE_PATH">,
  migrationsDir = resolve("migrations")
): MigrationResult {
  mkdirSync(dirname(config.DATABASE_PATH), { recursive: true });

  if (!existsSync(migrationsDir)) {
    throw new Error(`Migrations directory does not exist: ${migrationsDir}`);
  }

  const sqlite = new Database(config.DATABASE_PATH);
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");

  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const appliedRows = sqlite.prepare("SELECT filename FROM schema_migrations").all() as Array<{
      filename: string;
    }>;
    const applied = new Set(appliedRows.map((row) => row.filename));
    const files = readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();

    const newlyApplied: string[] = [];
    const skipped: string[] = [];
    const applyMigration = sqlite.transaction((filename: string, sqlText: string) => {
      sqlite.exec(sqlText);
      sqlite.prepare("INSERT INTO schema_migrations (filename) VALUES (?)").run(filename);
    });

    for (const file of files) {
      if (applied.has(file)) {
        skipped.push(file);
        continue;
      }

      const sqlText = readFileSync(resolve(migrationsDir, file), "utf8");
      applyMigration(file, sqlText);
      newlyApplied.push(file);
    }

    return { applied: newlyApplied, skipped };
  } finally {
    sqlite.close();
  }
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCli) {
  const config = loadConfig();
  const logger = createLogger(config);
  const result = runMigrations(config);
  logger.info(result, "sqlite_migrations_complete");
}
