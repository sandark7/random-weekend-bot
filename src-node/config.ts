import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) => (String(value ?? "").trim() === "" ? undefined : value),
  z.string().min(1).optional()
);
const optionalUrl = z.preprocess(
  (value) => (String(value ?? "").trim() === "" ? undefined : value),
  z.string().url().optional()
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  BOT_TOKEN: optionalNonEmptyString,
  BOT_MODE: z.enum(["polling", "webhook"]).default("polling"),
  WEBHOOK_SECRET: z.preprocess(
    (value) => (String(value ?? "").trim() === "" ? undefined : value),
    z.string().min(8).optional()
  ),
  WEBHOOK_URL: optionalUrl,
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_PATH: z.string().default("/app/data/bot.sqlite"),
  IMPORT_DIR: z.string().default("data/import"),
  SEARCH_RADIUS_METERS: z.coerce.number().int().positive().default(1500),
  GEOCODER_URL: z.string().url().default("https://nominatim.openstreetmap.org/search"),
  GEOCODER_USER_AGENT: z.string().min(8).default("citydatebot/0.2 (set GEOCODER_USER_AGENT)"),
  GEOCODER_ACCEPT_LANGUAGE: z.string().default("ru"),
  GEOCODER_COUNTRY_CODES: z.string().default("ru"),
  GEOCODER_CITY_BIAS: z.string().default("Москва"),
  GEOCODER_VIEWBOX: z.string().default("37.15,56.05,38.10,55.45"),
  GEOCODER_BOUNDED: z.coerce.boolean().default(true),
  GEOCODER_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  GEOCODER_MIN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(1100),
  LOG_LEVEL: z.string().default("info")
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (env === process.env) {
    loadDotEnv(resolve(".env"), env);
  }

  const parsed = envSchema.parse(env);
  return {
    ...parsed,
    DATABASE_PATH: resolve(parsed.DATABASE_PATH),
    IMPORT_DIR: resolve(parsed.IMPORT_DIR)
  };
}

export function ensureRuntimeDirectories(config: Pick<AppConfig, "DATABASE_PATH">): void {
  mkdirSync(dirname(config.DATABASE_PATH), { recursive: true });
}

function loadDotEnv(path: string, env: NodeJS.ProcessEnv): void {
  if (!existsSync(path)) {
    return;
  }

  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = unquoteEnvValue(trimmed.slice(separator + 1).trim());
    if (key && env[key] === undefined) {
      env[key] = value;
    }
  }
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
