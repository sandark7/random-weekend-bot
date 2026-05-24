import { Bot, type Context } from "grammy";
import type { AppConfig } from "../config.js";
import type { PlaceRepository } from "../db/placeRepository.js";
import type { LocationResolver, ResolvedLocation } from "../geo/locationResolver.js";
import type { AppLogger } from "../logger.js";
import { escapeHtml, formatSuggestion } from "./format.js";
import {
  CHANGE_LOCATION_BUTTON_TEXT,
  CONFIRM_LOCATION_BUTTON_TEXT,
  LOCATION_BUTTON_TEXT,
  MANUAL_LOCATION_BUTTON_TEXT,
  RANDOM_BUTTON_TEXT,
  locationConfirmationKeyboard,
  mainKeyboard
} from "./keyboards.js";
import { parseCoordinates } from "./parseCoordinates.js";

type CreateBotOptions = {
  config: AppConfig;
  repo: PlaceRepository;
  locationResolver: LocationResolver;
  logger: AppLogger;
};

type PendingConfirmation = {
  status: "needs_confirmation";
  confidence: "medium";
  kind: Exclude<ResolvedLocation, { status: "failed" }>["kind"];
  label: string;
  lat: number;
  lon: number;
  query: string;
  createdAt: number;
};

export function createCityDateBot({ config, repo, locationResolver, logger }: CreateBotOptions): Bot {
  if (!config.BOT_TOKEN) {
    throw new Error("BOT_TOKEN is required to start the Telegram bot");
  }

  const bot = new Bot(config.BOT_TOKEN);
  const pendingConfirmations = new Map<number, PendingConfirmation>();

  bot.use(async (ctx, next) => {
    const startedAt = Date.now();
    try {
      await next();
    } finally {
      logger.info(
        {
          userId: ctx.from?.id,
          chatId: ctx.chat?.id,
          command: ctx.message?.text?.startsWith("/") ? ctx.message.text.split(/\s+/)[0] : undefined,
          updateId: ctx.update.update_id,
          durationMs: Date.now() - startedAt
        },
        "telegram_update"
      );
    }
  });

  bot.command("start", async (ctx) => {
    await ctx.reply(
      [
        "Привет! Я помогу найти случайное место для прогулки, ужина, кофе или культурной паузы в центре Москвы.",
        "",
        "Можно отправить локацию с телефона, написать адрес вроде «Тверская 7» или попросить случайное место без привязки к точке."
      ].join("\n"),
      { reply_markup: mainKeyboard() }
    );
  });

  bot.command("random", async (ctx) => {
    await sendRandomSuggestion(ctx, repo);
  });

  bot.hears(RANDOM_BUTTON_TEXT, async (ctx) => {
    await sendRandomSuggestion(ctx, repo);
  });

  bot.hears(MANUAL_LOCATION_BUTTON_TEXT, async (ctx) => {
    await ctx.reply(
      [
        "Напиши адрес в Москве, например:",
        "Тверская 7",
        "Пятницкая 25с1",
        "Покровка 17",
        "",
        "Если хочешь, координаты тоже всё ещё можно прислать, но людям это правда не надо."
      ].join("\n"),
      { reply_markup: mainKeyboard() }
    );
  });

  bot.hears(LOCATION_BUTTON_TEXT, async (ctx) => {
    if (ctx.chat?.id) {
      pendingConfirmations.delete(ctx.chat.id);
    }
    await ctx.reply(
      "Если ты в Telegram Desktop, эта кнопка может не открыть отправку геолокации. Напиши адрес текстом, например «Мясницкая 13», или нажми кнопку с телефона.",
      { reply_markup: mainKeyboard() }
    );
  });

  bot.on("message:location", async (ctx) => {
    if (ctx.chat?.id) {
      pendingConfirmations.delete(ctx.chat.id);
    }
    const { latitude, longitude } = ctx.message.location;
    await sendNearbySuggestion(
      ctx,
      repo,
      latitude,
      longitude,
      config.SEARCH_RADIUS_METERS,
      "Ищу рядом с вашей геолокацией"
    );
  });

  bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat?.id;
    const pending = chatId ? pendingConfirmations.get(chatId) : undefined;
    if (pending && Date.now() - pending.createdAt > 10 * 60 * 1000) {
      pendingConfirmations.delete(chatId);
    }

    if (ctx.message.text === CHANGE_LOCATION_BUTTON_TEXT) {
      if (chatId) {
        pendingConfirmations.delete(chatId);
      }
      await ctx.reply("Ок, напиши адрес подробнее: улица и дом, например «Тверская 7».", {
        reply_markup: mainKeyboard()
      });
      return;
    }

    if (ctx.message.text === CONFIRM_LOCATION_BUTTON_TEXT && pending) {
      if (chatId) {
        pendingConfirmations.delete(chatId);
      }
      await sendNearbySuggestion(
        ctx,
        repo,
        pending.lat,
        pending.lon,
        config.SEARCH_RADIUS_METERS,
        `Ищу рядом с: ${pending.label}`
      );
      return;
    }

    const coordinates = parseCoordinates(ctx.message.text);
    if (coordinates) {
      if (chatId) {
        pendingConfirmations.delete(chatId);
      }
      await sendNearbySuggestion(
        ctx,
        repo,
        coordinates.lat,
        coordinates.lon,
        config.SEARCH_RADIUS_METERS,
        "Ищу рядом с координатами"
      );
      return;
    }

    let resolvedLocation;
    try {
      resolvedLocation = await locationResolver.resolve(ctx.message.text);
    } catch (error) {
      logger.warn(
        {
          error,
          userId: ctx.from?.id,
          chatId: ctx.chat?.id
        },
        "address_geocoding_failed"
      );
      await ctx.reply(
        "Сейчас не получилось проверить адрес через геокодер. Попробуй ещё раз чуть позже или отправь локацию с телефона.",
        { reply_markup: mainKeyboard() }
      );
      return;
    }

    if (resolvedLocation.status === "failed") {
      if (chatId) {
        pendingConfirmations.delete(chatId);
      }
      await ctx.reply(
        "Не смог точно понять адрес. Напиши подробнее: улица и дом, например «Тверская 7», или отправь геолокацию с телефона.",
        { reply_markup: mainKeyboard() }
      );
      return;
    }

    logger.info(
      {
        userId: ctx.from?.id,
        chatId: ctx.chat?.id,
        query: resolvedLocation.query,
        status: resolvedLocation.status,
        confidence: resolvedLocation.confidence,
        kind: resolvedLocation.kind,
        label: resolvedLocation.label,
        lat: resolvedLocation.lat,
        lon: resolvedLocation.lon
      },
      "location_resolved"
    );

    if (resolvedLocation.status === "needs_confirmation") {
      if (chatId) {
        pendingConfirmations.set(chatId, {
          status: "needs_confirmation",
          confidence: "medium",
          kind: resolvedLocation.kind,
          label: resolvedLocation.label,
          lat: resolvedLocation.lat,
          lon: resolvedLocation.lon,
          query: resolvedLocation.query,
          createdAt: Date.now()
        });
      }
      await ctx.reply(`Похоже, вы имели в виду: ${resolvedLocation.label}?`, {
        reply_markup: locationConfirmationKeyboard()
      });
      return;
    }

    if (chatId) {
      pendingConfirmations.delete(chatId);
    }
    await sendNearbySuggestion(
      ctx,
      repo,
      resolvedLocation.lat,
      resolvedLocation.lon,
      config.SEARCH_RADIUS_METERS,
      `Ищу рядом с: ${resolvedLocation.label}`
    );
  });

  bot.catch((error) => {
    logger.error(
      {
        error: error.error,
        updateId: error.ctx.update.update_id,
        userId: error.ctx.from?.id,
        chatId: error.ctx.chat?.id
      },
      "telegram_bot_error"
    );
  });

  return bot;
}

async function sendNearbySuggestion(
  ctx: Context,
  repo: PlaceRepository,
  lat: number,
  lon: number,
  radiusMeters: number,
  originLabel?: string
): Promise<void> {
  const fallbackRadiusMeters = Math.max(radiusMeters * 2, 2500);
  let suggestion = repo.suggestNearby({ lat, lon, radiusMeters });
  let radiusNote = "";

  if (!suggestion && fallbackRadiusMeters > radiusMeters) {
    suggestion = repo.suggestNearby({ lat, lon, radiusMeters: fallbackRadiusMeters });
    if (suggestion) {
      radiusNote = `В радиусе ${radiusMeters} м сейчас пусто, поэтому расширил поиск до ${fallbackRadiusMeters} м.`;
    }
  }

  if (!suggestion) {
    await ctx.reply(
      `Рядом в радиусе ${fallbackRadiusMeters} м пока нет открытых мест в базе. Дальше будем расширять CSV и радиусы, а сейчас можно попробовать "Случайное место".`,
      { reply_markup: mainKeyboard() }
    );
    return;
  }

  const prefix = [originLabel, radiusNote]
    .filter((value): value is string => Boolean(value))
    .map(escapeHtml)
    .join("\n");
  const message = prefix
    ? `${prefix}\n\n${formatSuggestion(suggestion, { origin: { lat, lon } })}`
    : formatSuggestion(suggestion, { origin: { lat, lon } });

  await ctx.reply(message, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: mainKeyboard()
  });
}

async function sendRandomSuggestion(ctx: Context, repo: PlaceRepository): Promise<void> {
  const suggestion = repo.randomOpenPlace();

  if (!suggestion) {
    await ctx.reply("В базе пока нет открытых мест. Сначала импортируем CSV, потом я оживу по-настоящему.", {
      reply_markup: mainKeyboard()
    });
    return;
  }

  await ctx.reply(formatSuggestion(suggestion), {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: mainKeyboard()
  });
}
