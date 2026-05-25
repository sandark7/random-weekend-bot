import { Bot } from "grammy";
import { noopAnalytics, type Analytics } from "../analytics/analytics.js";
import type { AppConfig } from "../config.js";
import type { PlaceRepository } from "../db/placeRepository.js";
import type { LocationResolver } from "../geo/locationResolver.js";
import type { AppLogger } from "../logger.js";
import { registerBotHandlers } from "./handlers.js";

type CreateBotOptions = {
  config: AppConfig;
  repo: PlaceRepository;
  locationResolver: LocationResolver;
  logger: AppLogger;
  analytics?: Analytics;
};

export function createCityDateBot(options: CreateBotOptions): Bot {
  if (!options.config.BOT_TOKEN) {
    throw new Error("BOT_TOKEN is required to start the Telegram bot");
  }

  const bot = new Bot(options.config.BOT_TOKEN);
  registerBotHandlers(bot, {
    ...options,
    analytics: options.analytics ?? noopAnalytics
  });
  return bot;
}
