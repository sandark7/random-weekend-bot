import { describe, expect, it, vi } from "vitest";
import type { Bot } from "grammy";
import type { AppConfig } from "../src-node/config.js";
import { createServer } from "../src-node/server/createServer.js";
import type { AppLogger } from "../src-node/logger.js";

describe("http server", () => {
  it("returns health status", async () => {
    const server = createServer({
      bot: makeBot(),
      config: makeConfig(),
      logger: makeLogger()
    });

    const response = await server.inject({
      method: "GET",
      url: "/healthz"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("rejects webhook calls with an invalid secret", async () => {
    const bot = makeBot();
    const server = createServer({
      bot,
      config: makeConfig({ WEBHOOK_SECRET: "correct-secret" }),
      logger: makeLogger()
    });

    const response = await server.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: {
        "x-telegram-bot-api-secret-token": "wrong-secret"
      },
      payload: makeUpdate()
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ ok: false });
    expect(bot.handleUpdate).not.toHaveBeenCalled();
  });

  it("passes webhook updates to the bot when the secret matches", async () => {
    const bot = makeBot();
    const server = createServer({
      bot,
      config: makeConfig({ WEBHOOK_SECRET: "correct-secret" }),
      logger: makeLogger()
    });
    const update = makeUpdate();

    const response = await server.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: {
        "x-telegram-bot-api-secret-token": "correct-secret"
      },
      payload: update
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(bot.handleUpdate).toHaveBeenCalledWith(update);
  });
});

function makeBot(): Bot {
  return {
    handleUpdate: vi.fn(async () => undefined)
  } as unknown as Bot;
}

function makeUpdate() {
  return {
    update_id: 1,
    message: {
      message_id: 1,
      date: 1,
      chat: { id: 1, type: "private" },
      text: "/start"
    }
  };
}

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    NODE_ENV: "test",
    BOT_TOKEN: "test-token",
    BOT_MODE: "webhook",
    HOST: "127.0.0.1",
    PORT: 3000,
    DATABASE_PATH: ":memory:",
    IMPORT_DIR: "data/import",
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
    LOG_LEVEL: "silent",
    ...overrides
  };
}

function makeLogger(): AppLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  } as unknown as AppLogger;
}
