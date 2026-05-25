import { ensureRuntimeDirectories, loadConfig } from "./config.js";
import { createAnalytics } from "./analytics/analytics.js";
import { createCityDateBot } from "./bot/createBot.js";
import { openDatabase } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { PlaceRepository } from "./db/placeRepository.js";
import { NominatimGeocoder } from "./geo/geocoder.js";
import { LocationResolver } from "./geo/locationResolver.js";
import { importCsv } from "./import/importCsv.js";
import { createLogger } from "./logger.js";
import { createServer } from "./server/createServer.js";

async function main(): Promise<void> {
  const config = loadConfig();
  ensureRuntimeDirectories(config);
  const logger = createLogger(config);

  const migrationResult = runMigrations(config);
  logger.info(migrationResult, "sqlite_migrations_complete");
  const importResult = importCsv(config);
  logger.info(importResult, "csv_import_complete");

  const database = openDatabase(config);
  const repo = new PlaceRepository(database.sqlite, config);
  const analytics = createAnalytics({ db: database.sqlite, config, logger });
  const geocoder = new NominatimGeocoder(config, logger);
  const locationResolver = new LocationResolver(geocoder, config);
  const bot = createCityDateBot({ config, repo, locationResolver, logger, analytics });
  const server = createServer({ bot, config, logger });
  let pollingStarted = false;

  await server.listen({ host: config.HOST, port: config.PORT });
  logger.info({ host: config.HOST, port: config.PORT }, "http_server_started");

  if (config.BOT_MODE === "webhook") {
    if (!config.WEBHOOK_URL) {
      throw new Error("WEBHOOK_URL is required when BOT_MODE=webhook");
    }
    await bot.api.setWebhook(config.WEBHOOK_URL, {
      secret_token: config.WEBHOOK_SECRET
    });
    logger.info({ webhookUrl: config.WEBHOOK_URL }, "telegram_webhook_set");
  } else {
    await bot.api.deleteWebhook({ drop_pending_updates: true });
    pollingStarted = true;
    bot
      .start({
        onStart: (botInfo) => {
          logger.info({ botUsername: botInfo.username }, "telegram_polling_started");
        }
      })
      .catch((error) => {
        logger.fatal({ error }, "telegram_polling_failed");
        process.exit(1);
      });
  }

  const shutdown = async (signal: NodeJS.Signals) => {
    logger.info({ signal }, "shutdown_started");
    if (pollingStarted) {
      bot.stop();
    }
    await server.close();
    database.close();
    logger.info({ signal }, "shutdown_complete");
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error) => {
  const logger = createLogger(loadConfig());
  logger.fatal({ error }, "runtime_start_failed");
  process.exit(1);
});
