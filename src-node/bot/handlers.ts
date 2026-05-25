import { Bot, type Context } from "grammy";
import type { AppConfig } from "../config.js";
import type { PlaceRepository } from "../db/placeRepository.js";
import type { LocationResolver } from "../geo/locationResolver.js";
import type { AppLogger } from "../logger.js";
import { findNearbySuggestion } from "../recommendation/nearby.js";
import { buildRoute } from "../recommendation/routeBuilder.js";
import { formatLocationIntro, formatRoute } from "../recommendation/routeFormatter.js";
import {
  PLACE_SCENARIOS,
  ROUTE_DURATION_BY_BUTTON,
  SCENARIO_BY_BUTTON,
  SCENARIO_CATEGORIES,
  type RouteDurationHours
} from "../recommendation/scenarios.js";
import { escapeHtml, formatSuggestion } from "./format.js";
import {
  CHANGE_SCENARIO_BUTTON_TEXT,
  CHANGE_LOCATION_BUTTON_TEXT,
  CONFIRM_LOCATION_BUTTON_TEXT,
  DESIRE_BUTTONS,
  type DesireButtonText,
  LOCATION_BUTTON_TEXT,
  MORE_NEARBY_BUTTON_TEXT,
  RANDOM_BUTTON_TEXT,
  ROUTE_BUTTON_TEXT,
  ROUTE_FROM_RESULT_BUTTON_TEXT,
  ROUTE_DURATION_BUTTONS,
  type RouteDurationButtonText,
  locationConfirmationKeyboard,
  mainKeyboard,
  routeDurationKeyboard
} from "./keyboards.js";
import { parseCoordinates } from "./parseCoordinates.js";
import {
  appendRecentPlaceId,
  appendRecentPlaceIds,
  type LastAction,
  type LastLocation,
  type PendingConfirmation,
  type RouteStart
} from "./sessionState.js";

type RegisterBotHandlersOptions = {
  config: AppConfig;
  repo: PlaceRepository;
  locationResolver: LocationResolver;
  logger: AppLogger;
};

const LOCATION_INPUT_HELP = [
  "Можно отправить геолокацию с телефона или написать адрес обычным сообщением:",
  "- Тверская 7",
  "- Патриаршие пруды",
  "- метро Китай-город",
  "- Дубининская 59"
].join("\n");

export function registerBotHandlers(
  bot: Bot,
  { config, repo, locationResolver, logger }: RegisterBotHandlersOptions
): void {
  const pendingConfirmations = new Map<number, PendingConfirmation>();
  const lastLocations = new Map<number, LastLocation>();

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
    if (ctx.chat?.id) {
      pendingConfirmations.delete(ctx.chat.id);
      lastLocations.delete(ctx.chat.id);
    }
    await ctx.reply(
      [
        "Привет! Я Random Weekend. Помогу выбрать, куда пойти рядом: поесть, выпить, посмотреть что-то красивое или собрать прогулочный маршрут.",
        "",
        LOCATION_INPUT_HELP
      ].join("\n"),
      { reply_markup: mainKeyboardFor(ctx, lastLocations) }
    );
  });

  bot.command("random", async (ctx) => {
    await sendRandomSuggestion(ctx, repo, lastLocations, config.SEARCH_RADIUS_METERS);
  });

  bot.hears(RANDOM_BUTTON_TEXT, async (ctx) => {
    await sendRandomSuggestion(ctx, repo, lastLocations, config.SEARCH_RADIUS_METERS);
  });

  bot.hears(MORE_NEARBY_BUTTON_TEXT, async (ctx) => {
    const chatId = ctx.chat?.id;
    const lastLocation = chatId ? lastLocations.get(chatId) : undefined;

    if (!lastLocation) {
      await askForLocation(ctx, lastLocations);
      return;
    }

    if (chatId) {
      pendingConfirmations.delete(chatId);
    }

    await repeatLastAction(ctx, repo, lastLocations, lastLocation);
  });

  bot.hears(CHANGE_SCENARIO_BUTTON_TEXT, async (ctx) => {
    const chatId = ctx.chat?.id;
    const lastLocation = chatId ? lastLocations.get(chatId) : undefined;
    if (!lastLocation) {
      await askForLocation(ctx, lastLocations);
      return;
    }

    lastLocations.set(chatId, {
      ...lastLocation,
      lastAction: null,
      lastSuggestedPlace: null,
      pendingRouteStart: null,
      hasShownSuggestion: false,
      updatedAt: Date.now()
    });
    await sendScenarioMenu(ctx, lastLocations, lastLocation.label);
  });

  bot.hears([...DESIRE_BUTTONS], async (ctx) => {
    const chatId = ctx.chat?.id;
    const lastLocation = chatId ? lastLocations.get(chatId) : undefined;
    if (!lastLocation) {
      await askForLocation(ctx, lastLocations);
      return;
    }

    const scenarioKey = SCENARIO_BY_BUTTON.get(ctx.message?.text as DesireButtonText);
    if (!scenarioKey) {
      return;
    }

    const scenario = PLACE_SCENARIOS[scenarioKey];
    await sendNearbySuggestion(ctx, repo, lastLocations, {
      lat: lastLocation.lat,
      lon: lastLocation.lon,
      radiusMeters: lastLocation.radiusMeters,
      locationLabel: lastLocation.label,
      categorySlugs: scenario.categories,
      action: { type: "scenario", scenario: scenario.key },
      intro: `Ищу, где ${scenario.label}, рядом с: ${lastLocation.label}`
    });
  });

  bot.hears(ROUTE_BUTTON_TEXT, async (ctx) => {
    const chatId = ctx.chat?.id;
    const lastLocation = chatId ? lastLocations.get(chatId) : undefined;
    if (!lastLocation) {
      await askForLocation(ctx, lastLocations);
      return;
    }

    lastLocations.set(chatId, {
      ...lastLocation,
      pendingRouteStart: null,
      updatedAt: Date.now()
    });

    await askRouteDuration(ctx);
  });

  bot.hears(ROUTE_FROM_RESULT_BUTTON_TEXT, async (ctx) => {
    const chatId = ctx.chat?.id;
    const lastLocation = chatId ? lastLocations.get(chatId) : undefined;

    if (!lastLocation) {
      await askForLocation(ctx, lastLocations);
      return;
    }

    const routeStart = lastLocation.lastSuggestedPlace;

    if (!routeStart) {
      await ctx.reply("Сначала выбери место, от которого можно собрать маршрут.", {
        reply_markup: mainKeyboardFor(ctx, lastLocations)
      });
      return;
    }

    lastLocations.set(chatId, {
      ...lastLocation,
      pendingRouteStart: routeStart,
      updatedAt: Date.now()
    });

    await askRouteDuration(ctx, routeStart.label);
  });

  bot.hears([...ROUTE_DURATION_BUTTONS], async (ctx) => {
    const chatId = ctx.chat?.id;
    const lastLocation = chatId ? lastLocations.get(chatId) : undefined;
    if (!lastLocation) {
      await askForLocation(ctx, lastLocations);
      return;
    }

    const durationHours = ROUTE_DURATION_BY_BUTTON.get(ctx.message?.text as RouteDurationButtonText);
    if (!durationHours) {
      return;
    }

    await sendRoute(
      ctx,
      repo,
      lastLocations,
      lastLocation,
      durationHours,
      lastLocation.pendingRouteStart ?? undefined
    );
  });

  bot.hears(LOCATION_BUTTON_TEXT, async (ctx) => {
    if (ctx.chat?.id) {
      pendingConfirmations.delete(ctx.chat.id);
    }
    await ctx.reply(
      [
        "Если ты в Telegram Desktop, эта кнопка может не открыть отправку геолокации.",
        "",
        LOCATION_INPUT_HELP
      ].join("\n"),
      { reply_markup: mainKeyboardFor(ctx, lastLocations) }
    );
  });

  bot.on("message:location", async (ctx) => {
    if (ctx.chat?.id) {
      pendingConfirmations.delete(ctx.chat.id);
    }
    const { latitude, longitude } = ctx.message.location;
    await rememberLocationAndAskScenario(ctx, lastLocations, {
      lat: latitude,
      lon: longitude,
      radiusMeters: config.SEARCH_RADIUS_METERS,
      locationLabel: "вашей геолокацией"
    });
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
        reply_markup: mainKeyboardFor(ctx, lastLocations)
      });
      return;
    }

    if (ctx.message.text === CONFIRM_LOCATION_BUTTON_TEXT && pending) {
      if (chatId) {
        pendingConfirmations.delete(chatId);
      }
      await rememberLocationAndAskScenario(ctx, lastLocations, {
        lat: pending.lat,
        lon: pending.lon,
        radiusMeters: config.SEARCH_RADIUS_METERS,
        locationLabel: pending.label
      });
      return;
    }

    const coordinates = parseCoordinates(ctx.message.text);
    if (coordinates) {
      if (chatId) {
        pendingConfirmations.delete(chatId);
      }
      await rememberLocationAndAskScenario(ctx, lastLocations, {
        lat: coordinates.lat,
        lon: coordinates.lon,
        radiusMeters: config.SEARCH_RADIUS_METERS,
        locationLabel: "координатами"
      });
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
        { reply_markup: mainKeyboardFor(ctx, lastLocations) }
      );
      return;
    }

    if (resolvedLocation.status === "failed") {
      if (chatId) {
        pendingConfirmations.delete(chatId);
      }
      await ctx.reply(
        "Не смог точно понять адрес. Напиши подробнее: улица и дом, например «Тверская 7», или отправь геолокацию с телефона.",
        { reply_markup: mainKeyboardFor(ctx, lastLocations) }
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
    await rememberLocationAndAskScenario(ctx, lastLocations, {
      lat: resolvedLocation.lat,
      lon: resolvedLocation.lon,
      radiusMeters: config.SEARCH_RADIUS_METERS,
      locationLabel: resolvedLocation.label
    });
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
}

async function rememberLocationAndAskScenario(
  ctx: Context,
  lastLocations: Map<number, LastLocation>,
  options: {
    lat: number;
    lon: number;
    radiusMeters: number;
    locationLabel: string;
  }
): Promise<void> {
  if (ctx.chat?.id) {
    lastLocations.set(ctx.chat.id, {
      lat: options.lat,
      lon: options.lon,
      label: options.locationLabel,
      radiusMeters: options.radiusMeters,
      recentPlaceIds: [],
      lastAction: null,
      lastSuggestedPlace: null,
      pendingRouteStart: null,
      hasShownSuggestion: false,
      updatedAt: Date.now()
    });
  }

  await sendScenarioMenu(ctx, lastLocations, options.locationLabel);
}

async function sendScenarioMenu(
  ctx: Context,
  lastLocations: Map<number, LastLocation>,
  locationLabel: string
): Promise<void> {
  await ctx.reply(
    [
      formatLocationIntro(locationLabel),
      "",
      "Что хочется сделать?"
    ].join("\n"),
    { reply_markup: mainKeyboardFor(ctx, lastLocations) }
  );
}

async function askForLocation(
  ctx: Context,
  lastLocations: Map<number, LastLocation>
): Promise<void> {
  await ctx.reply(
    [
      "Сначала нужно понять, откуда искать рядом.",
      "",
      LOCATION_INPUT_HELP
    ].join("\n"),
    { reply_markup: mainKeyboardFor(ctx, lastLocations) }
  );
}

async function askRouteDuration(ctx: Context, fromLabel?: string): Promise<void> {
  const text = fromLabel
    ? `На сколько часов собрать маршрут от места «${fromLabel}»?`
    : "На сколько часов собрать маршрут?";

  await ctx.reply(text, {
    reply_markup: routeDurationKeyboard()
  });
}

async function repeatLastAction(
  ctx: Context,
  repo: PlaceRepository,
  lastLocations: Map<number, LastLocation>,
  lastLocation: LastLocation
): Promise<void> {
  const action = lastLocation.lastAction;
  if (!action) {
    await sendScenarioMenu(ctx, lastLocations, lastLocation.label);
    return;
  }

  if (action.type === "scenario") {
    const scenario = PLACE_SCENARIOS[action.scenario];
    await sendNearbySuggestion(ctx, repo, lastLocations, {
      lat: lastLocation.lat,
      lon: lastLocation.lon,
      radiusMeters: lastLocation.radiusMeters,
      locationLabel: lastLocation.label,
      categorySlugs: scenario.categories,
      excludeRecentPlaces: true,
      action,
      intro: `Ещё вариант: ${scenario.label}, рядом с: ${lastLocation.label}`
    });
    return;
  }

  if (action.type === "route") {
    await sendRoute(ctx, repo, lastLocations, lastLocation, action.durationHours, action.routeStart);
    return;
  }

  await sendNearbySuggestion(ctx, repo, lastLocations, {
    lat: lastLocation.lat,
    lon: lastLocation.lon,
    radiusMeters: lastLocation.radiusMeters,
    locationLabel: lastLocation.label,
    categorySlugs: SCENARIO_CATEGORIES.random,
    excludeRecentPlaces: true,
    action,
    intro: `Ещё выбираю рядом с: ${lastLocation.label}`
  });
}

async function sendRoute(
  ctx: Context,
  repo: PlaceRepository,
  lastLocations: Map<number, LastLocation>,
  lastLocation: LastLocation,
  durationHours: RouteDurationHours,
  routeStart?: RouteStart
): Promise<void> {
  const start = routeStart ?? {
    lat: lastLocation.lat,
    lon: lastLocation.lon,
    label: lastLocation.label
  };

  const route = buildRoute(repo, {
    start: { lat: start.lat, lon: start.lon },
    radiusMeters: lastLocation.radiusMeters,
    now: new Date(),
    excludePlaceIds: lastLocation.recentPlaceIds,
    durationHours
  });

  if (!route) {
    await ctx.reply(
      "Не смог собрать последовательный маршрут рядом: не хватает открытых точек, которые подходят по времени, расстоянию и открытости. Попробуй другую длительность или стартовую точку.",
      { reply_markup: mainKeyboardFor(ctx, lastLocations) }
    );
    return;
  }

  if (ctx.chat?.id) {
    lastLocations.set(ctx.chat.id, {
      ...lastLocation,
      recentPlaceIds: appendRecentPlaceIds(
        lastLocation.recentPlaceIds,
        route.map((step) => step.suggestion.placeId)
      ),
      lastAction: { type: "route", durationHours, routeStart },
      pendingRouteStart: null,
      hasShownSuggestion: true,
      updatedAt: Date.now()
    });
  }

  await ctx.reply(formatRoute(durationHours, start.label, route), {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: mainKeyboardFor(ctx, lastLocations)
  });
}

async function sendNearbySuggestion(
  ctx: Context,
  repo: PlaceRepository,
  lastLocations: Map<number, LastLocation>,
  options: {
    lat: number;
    lon: number;
    radiusMeters: number;
    locationLabel: string;
    categorySlugs?: readonly string[];
    excludeRecentPlaces?: boolean;
    action?: LastAction;
    intro?: string;
  }
): Promise<void> {
  const chatId = ctx.chat?.id;
  const lastLocation = chatId ? lastLocations.get(chatId) : undefined;
  const excludePlaceIds = options.excludeRecentPlaces ? lastLocation?.recentPlaceIds ?? [] : [];
  const result = findNearbySuggestion(repo, {
    lat: options.lat,
    lon: options.lon,
    radiusMeters: options.radiusMeters,
    categorySlugs: options.categorySlugs,
    excludePlaceIds
  });

  if (!result) {
    const fallbackRadiusMeters = Math.max(options.radiusMeters * 2, 2500);
    await ctx.reply(
      `Рядом в радиусе ${fallbackRadiusMeters} м пока нет открытых мест под этот сценарий. Можно сменить категорию или попробовать «Выбери сам».`,
      { reply_markup: mainKeyboardFor(ctx, lastLocations) }
    );
    return;
  }

  if (chatId) {
    const recentPlaceIds =
      options.excludeRecentPlaces && !result.resetRecentPlaces && lastLocation
        ? appendRecentPlaceId(lastLocation.recentPlaceIds, result.suggestion.placeId)
        : [result.suggestion.placeId];
    lastLocations.set(chatId, {
      lat: options.lat,
      lon: options.lon,
      label: options.locationLabel,
      radiusMeters: options.radiusMeters,
      recentPlaceIds,
      lastAction: options.action ?? { type: "random" },
      lastSuggestedPlace: {
        placeId: result.suggestion.placeId,
        lat: result.suggestion.lat,
        lon: result.suggestion.lon,
        label: result.suggestion.name
      },
      pendingRouteStart: null,
      hasShownSuggestion: true,
      updatedAt: Date.now()
    });
  }

  const prefix = [options.intro ?? formatLocationIntro(options.locationLabel), result.radiusNote]
    .filter((value): value is string => Boolean(value))
    .map(escapeHtml)
    .join("\n");
  const message = prefix
    ? `${prefix}\n\n${formatSuggestion(result.suggestion, { origin: { lat: options.lat, lon: options.lon } })}`
    : formatSuggestion(result.suggestion, { origin: { lat: options.lat, lon: options.lon } });

  await ctx.reply(message, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: mainKeyboardFor(ctx, lastLocations)
  });
}

async function sendRandomSuggestion(
  ctx: Context,
  repo: PlaceRepository,
  lastLocations: Map<number, LastLocation>,
  radiusMeters: number
): Promise<void> {
  const chatId = ctx.chat?.id;
  const lastLocation = chatId ? lastLocations.get(chatId) : undefined;
  if (lastLocation) {
    await sendNearbySuggestion(ctx, repo, lastLocations, {
      lat: lastLocation.lat,
      lon: lastLocation.lon,
      radiusMeters,
      locationLabel: lastLocation.label,
      categorySlugs: SCENARIO_CATEGORIES.random,
      action: { type: "random" },
      intro: `Выбираю рядом с: ${lastLocation.label}`,
      excludeRecentPlaces: true
    });
    return;
  }

  await askForLocation(ctx, lastLocations);
}

function mainKeyboardFor(ctx: Context, lastLocations: Map<number, LastLocation>) {
  const lastLocation = ctx.chat?.id ? lastLocations.get(ctx.chat.id) : undefined;
  return mainKeyboard({
    hasResolvedLocation: Boolean(lastLocation),
    showResultActions: lastLocation?.hasShownSuggestion === true
  });
}
