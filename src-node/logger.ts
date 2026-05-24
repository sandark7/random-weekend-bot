import pino from "pino";
import type { AppConfig } from "./config.js";

export type AppLogger = pino.Logger;

export function createLogger(config: Pick<AppConfig, "LOG_LEVEL">): AppLogger {
  return pino({
    level: config.LOG_LEVEL,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ["BOT_TOKEN", "botToken", "req.headers.authorization", "token"],
      remove: true
    }
  });
}
