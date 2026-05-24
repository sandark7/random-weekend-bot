import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src-node/config.js";

describe("config", () => {
  it("uses a local sqlite path by default", () => {
    const config = loadConfig({});

    expect(config.DATABASE_PATH).toBe(resolve("./data/bot.sqlite"));
  });
});
