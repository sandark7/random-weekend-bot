import crypto from "node:crypto";
import type { Context } from "grammy";
import type Database from "better-sqlite3";
import type { AppConfig } from "../config.js";
import type { AppLogger } from "../logger.js";

export type AnalyticsEventName =
  | "start"
  | "location_submitted"
  | "location_resolved"
  | "location_failed"
  | "scenario_selected"
  | "random_selected"
  | "place_suggested"
  | "place_not_found"
  | "route_duration_selected"
  | "route_built"
  | "route_failed"
  | "route_rebuilt"
  | "route_rebuild_failed"
  | "route_step_replace_started"
  | "route_step_replaced"
  | "route_step_replace_failed"
  | "route_step_rebuild_without_place"
  | "feedback_started"
  | "feedback_sent"
  | "rate_limited"
  | "text_too_long"
  | "error";

export type AnalyticsPayload = Record<string, unknown>;

export type Analytics = {
  track: (
    eventName: AnalyticsEventName,
    ctx: Context | null,
    payload?: AnalyticsPayload,
    options?: {
      sessionId?: string;
      flowId?: string;
    }
  ) => void;
};

export const noopAnalytics: Analytics = {
  track: () => undefined
};

export function createAnalytics(options: {
  db: Database.Database;
  config: Pick<AppConfig, "ANALYTICS_ENABLED" | "ANALYTICS_SALT" | "APP_VERSION">;
  logger: AppLogger;
}): Analytics {
  const insert = options.db.prepare(`
    INSERT INTO analytics_events (
      created_at,
      event_name,
      user_id_hash,
      chat_id_hash,
      session_id,
      flow_id,
      app_version,
      payload_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let warnedAboutMissingSalt = false;

  return {
    track(eventName, ctx, payload = {}, eventOptions = {}) {
      if (!options.config.ANALYTICS_ENABLED) {
        return;
      }

      try {
        if (!options.config.ANALYTICS_SALT && !warnedAboutMissingSalt) {
          warnedAboutMissingSalt = true;
          options.logger.warn("analytics_salt_missing");
        }

        const userIdHash = hashId(ctx?.from?.id, options.config.ANALYTICS_SALT);
        const chatIdHash = hashId(ctx?.chat?.id, options.config.ANALYTICS_SALT);

        insert.run(
          new Date().toISOString(),
          eventName,
          userIdHash,
          chatIdHash,
          eventOptions.sessionId ?? buildSessionId(chatIdHash),
          eventOptions.flowId ?? null,
          options.config.APP_VERSION,
          JSON.stringify(sanitizePayload(payload))
        );
      } catch (error) {
        options.logger.warn(
          { error, eventName },
          "analytics_write_failed"
        );
      }
    }
  };
}

export function hashId(value: number | undefined, salt: string | undefined): string | null {
  if (value === undefined || !salt) {
    return null;
  }

  return crypto
    .createHmac("sha256", salt)
    .update(String(value))
    .digest("hex");
}

export function buildSessionId(chatIdHash: string | null): string {
  const day = new Date().toISOString().slice(0, 10);
  return `${day}:${chatIdHash ?? "unknown"}`;
}

export function roundCoord(value: number): number {
  return Math.round(value * 100) / 100;
}

export function compactPayload(payload: AnalyticsPayload): AnalyticsPayload {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

export function sanitizePayload(payload: AnalyticsPayload): AnalyticsPayload {
  const result = compactPayload({ ...payload });

  delete result.locationLabel;
  delete result.rawText;
  delete result.query;

  return result;
}
