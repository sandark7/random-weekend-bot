import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src-node/config.js";

describe("config", () => {
  it("uses a local sqlite path by default", () => {
    const config = loadConfig({});

    expect(config.DATABASE_PATH).toBe(resolve("./data/bot.sqlite"));
  });

  it("sets conservative default input limits", () => {
    const config = loadConfig({});

    expect(config.MAX_TEXT_INPUT_LENGTH).toBe(300);
    expect(config.CHAT_COOLDOWN_MS).toBe(0);
  });

  it("enables local analytics by default without requiring a salt", () => {
    const config = loadConfig({});

    expect(config.ANALYTICS_ENABLED).toBe(true);
    expect(config.ANALYTICS_SALT).toBeUndefined();
    expect(config.APP_VERSION).toBe("0.2.0");
  });
});
