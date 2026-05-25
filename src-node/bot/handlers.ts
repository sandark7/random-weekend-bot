import { Bot, type Context } from "grammy";
import { roundCoord, type Analytics } from "../analytics/analytics.js";
import type { AppConfig } from "../config.js";
import type { PlaceRepository } from "../db/placeRepository.js";
import type { LocationResolver } from "../geo/locationResolver.js";
import type { AppLogger } from "../logger.js";
import { findNearbySuggestion } from "../recommendation/nearby.js";
import {
  buildRoute,
  recalculateRouteSteps,
  replaceRouteStep,
  type RouteStep
} from "../recommendation/routeBuilder.js";
import {
  formatLocationIntro,
  formatRoute,
  formatRouteDuration
} from "../recommendation/routeFormatter.js";
import { primaryCategorySlug, routeDuration, walkingMinutes } from "../recommendation/routeRules.js";
import {
  PLACE_SCENARIOS,
  ROUTE_DURATION_BY_BUTTON,
  SCENARIO_BY_BUTTON,
  SCENARIO_CATEGORIES,
  type PlaceScenarioKey,
  type RouteDurationHours
} from "../recommendation/scenarios.js";
import { escapeHtml, formatSuggestion } from "./format.js";
import {
  CHANGE_SCENARIO_BUTTON_TEXT,
  CHANGE_LOCATION_BUTTON_TEXT,
  CONFIRM_LOCATION_BUTTON_TEXT,
  DESIRE_BUTTONS,
  BACK_BUTTON_TEXT,
  FEEDBACK_BUTTON_TEXT,
  FEEDBACK_REASON_BUTTONS,
  KEEP_ROUTE_BUTTON_TEXT,
  type DesireButtonText,
  type FeedbackReasonButtonText,
  LOCATION_BUTTON_TEXT,
  MORE_NEARBY_BUTTON_TEXT,
  RANDOM_BUTTON_TEXT,
  REBUILD_ROUTE_BUTTON_TEXT,
  REBUILD_WITHOUT_ROUTE_STEP_BUTTON_TEXT,
  REPLACE_ROUTE_STEP_BUTTON_TEXT,
  ROUTE_BUTTON_TEXT,
  ROUTE_DURATION_BUTTONS,
  type RouteDurationButtonText,
  feedbackReasonKeyboard,
  locationConfirmationKeyboard,
  mainKeyboard,
  routeDurationKeyboard,
  routeReplacementFallbackKeyboard,
  routeStepReplacementKeyboard
} from "./keyboards.js";
import { parseCoordinates } from "./parseCoordinates.js";
import {
  appendRecentPlaceId,
  type LastAction,
  type LastLocation,
  type PendingConfirmation,
  type PendingFeedbackTarget,
  type RouteStart,
  type StoredRoute
} from "./sessionState.js";

type RegisterBotHandlersOptions = {
  config: AppConfig;
  repo: PlaceRepository;
  locationResolver: LocationResolver;
  logger: AppLogger;
  analytics: Analytics;
};

type RouteMode = "new" | "rebuild" | "rebuild_without_place";

const LOCATION_INPUT_HELP = [
  "Можно отправить геолокацию с телефона или написать адрес обычным сообщением:",
  "- Тверская 7",
  "- Патриаршие пруды",
  "- метро Китай-город",
  "- Дубининская 59"
].join("\n");

const SCENARIO_INTRO: Record<PlaceScenarioKey, (locationLabel: string) => string> = {
  eat: (locationLabel) => `Ищу, где поесть, рядом с: ${locationLabel}`,
  coffee_snack: (locationLabel) => `Ищу кофе или перекус рядом с: ${locationLabel}`,
  drink: (locationLabel) => `Ищу, где выпить, рядом с: ${locationLabel}`,
  relax: (locationLabel) => `Ищу место для отдыха рядом с: ${locationLabel}`,
  see: (locationLabel) => `Ищу городскую точку рядом с: ${locationLabel}`,
  activity: (locationLabel) => `Ищу досуг рядом с: ${locationLabel}`
};

const SCENARIO_REPEAT_INTRO: Record<PlaceScenarioKey, (locationLabel: string) => string> = {
  eat: (locationLabel) => `Ещё вариант, где поесть, рядом с: ${locationLabel}`,
  coffee_snack: (locationLabel) => `Ещё кофе или перекус рядом с: ${locationLabel}`,
  drink: (locationLabel) => `Ещё вариант, где выпить, рядом с: ${locationLabel}`,
  relax: (locationLabel) => `Ещё место для отдыха рядом с: ${locationLabel}`,
  see: (locationLabel) => `Ещё городская точка рядом с: ${locationLabel}`,
  activity: (locationLabel) => `Ещё досуг рядом с: ${locationLabel}`
};

const RATE_LIMITED_MESSAGE = "Слишком быстро 🙂 Дай мне секунду обработать прошлый запрос.";
const FEEDBACK_REASONS = new Set<string>(FEEDBACK_REASON_BUTTONS);

export function registerBotHandlers(
  bot: Bot,
  { config, repo, locationResolver, logger, analytics }: RegisterBotHandlersOptions
): void {
  const pendingConfirmations = new Map<number, PendingConfirmation>();
  const lastLocations = new Map<number, LastLocation>();
  const lastUpdateByChat = new Map<number, number>();

  bot.use(async (ctx, next) => {
    const startedAt = Date.now();
    try {
      if (isRateLimited(ctx, lastUpdateByChat, config.CHAT_COOLDOWN_MS, startedAt)) {
        analytics.track("rate_limited", ctx, {
          cooldownMs: config.CHAT_COOLDOWN_MS
        });
        await ctx.reply(RATE_LIMITED_MESSAGE);
        return;
      }

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
    analytics.track("start", ctx);
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
    await sendRandomSuggestion(ctx, repo, lastLocations, analytics, config.SEARCH_RADIUS_METERS);
  });

  bot.hears(RANDOM_BUTTON_TEXT, async (ctx) => {
    await sendRandomSuggestion(ctx, repo, lastLocations, analytics, config.SEARCH_RADIUS_METERS);
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

    await repeatLastAction(ctx, repo, lastLocations, analytics, lastLocation);
  });

  bot.hears(REBUILD_ROUTE_BUTTON_TEXT, async (ctx) => {
    const chatId = ctx.chat?.id;
    const lastLocation = chatId ? lastLocations.get(chatId) : undefined;

    if (!lastLocation) {
      await askForLocation(ctx, lastLocations);
      return;
    }

    if (lastLocation.lastAction?.type !== "route") {
      await ctx.reply("Сначала собери маршрут, а потом я смогу его пересобрать.", {
        reply_markup: mainKeyboardFor(ctx, lastLocations)
      });
      return;
    }

    await repeatLastAction(ctx, repo, lastLocations, analytics, lastLocation, {
      preserveCurrentRouteOnFailure: true,
      rebuildCurrentRouteOnly: true
    });
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
      lastRoute: null,
      pendingRouteReplacement: false,
      pendingRouteReplacementExcludePlaceId: null,
      pendingFeedbackTarget: null,
      lastResultKind: null,
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
    analytics.track("scenario_selected", ctx, {
      scenario: scenarioKey,
      categorySlugs: scenario.categories
    });
    await sendNearbySuggestion(ctx, repo, lastLocations, analytics, {
      lat: lastLocation.lat,
      lon: lastLocation.lon,
      radiusMeters: lastLocation.radiusMeters,
      locationLabel: lastLocation.label,
      categorySlugs: scenario.categories,
      action: { type: "scenario", scenario: scenario.key },
      intro: formatScenarioIntro(scenario.key, lastLocation.label)
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
      pendingRouteReplacement: false,
      pendingRouteReplacementExcludePlaceId: null,
      updatedAt: Date.now()
    });

    await askRouteDuration(ctx);
  });

  bot.hears(REPLACE_ROUTE_STEP_BUTTON_TEXT, async (ctx) => {
    const chatId = ctx.chat?.id;
    const lastLocation = chatId ? lastLocations.get(chatId) : undefined;

    if (!lastLocation?.lastRoute) {
      await ctx.reply("Сначала нужно собрать маршрут, а потом уже менять в нём пункты.", {
        reply_markup: mainKeyboardFor(ctx, lastLocations)
      });
      return;
    }

    analytics.track("route_step_replace_started", ctx, {
      durationHours: lastLocation.lastRoute.durationHours,
      routePlaceIds: lastLocation.lastRoute.steps.map((step) => step.placeId),
      routeSteps: lastLocation.lastRoute.steps.length
    });

    lastLocations.set(chatId, {
      ...lastLocation,
      pendingRouteReplacement: true,
      pendingRouteReplacementExcludePlaceId: null,
      updatedAt: Date.now()
    });

    await ctx.reply("Какой пункт заменить?", {
      reply_markup: routeStepReplacementKeyboard(
        lastLocation.lastRoute.steps.map((step) => step.name)
      )
    });
  });

  bot.hears(FEEDBACK_BUTTON_TEXT, async (ctx) => {
    const chatId = ctx.chat?.id;
    const lastLocation = chatId ? lastLocations.get(chatId) : undefined;

    if (!lastLocation) {
      await askForLocation(ctx, lastLocations);
      return;
    }

    const target = feedbackTargetFromLastLocation(lastLocation);
    if (!target) {
      await ctx.reply("Сначала выбери место или собери маршрут, а потом можно отметить, что не подошло.", {
        reply_markup: mainKeyboardFor(ctx, lastLocations)
      });
      return;
    }

    lastLocations.set(chatId, {
      ...lastLocation,
      pendingFeedbackTarget: target,
      pendingRouteReplacement: false,
      pendingRouteReplacementExcludePlaceId: null,
      updatedAt: Date.now()
    });

    analytics.track("feedback_started", ctx, feedbackStartedPayload(target));
    await ctx.reply("Что не так?", {
      reply_markup: feedbackReasonKeyboard()
    });
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

    analytics.track("route_duration_selected", ctx, {
      durationHours
    });
    await sendRoute(
      ctx,
      repo,
      lastLocations,
      analytics,
      lastLocation,
      durationHours,
      undefined,
      [],
      "new"
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
    analytics.track("location_submitted", ctx, {
      locationKind: "telegram_location",
      latRounded: roundCoord(latitude),
      lonRounded: roundCoord(longitude),
      radiusMeters: config.SEARCH_RADIUS_METERS
    });
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
    const lastLocation = chatId ? lastLocations.get(chatId) : undefined;
    if (pending && Date.now() - pending.createdAt > 10 * 60 * 1000) {
      pendingConfirmations.delete(chatId);
    }

    if (ctx.message.text.startsWith("/")) {
      return;
    }

    if (ctx.message.text.length > config.MAX_TEXT_INPUT_LENGTH) {
      analytics.track("text_too_long", ctx, {
        length: ctx.message.text.length,
        maxLength: config.MAX_TEXT_INPUT_LENGTH
      });
      await ctx.reply(
        `Сообщение слишком длинное. Напиши адрес или ориентир короче, до ${config.MAX_TEXT_INPUT_LENGTH} символов.`,
        { reply_markup: mainKeyboardFor(ctx, lastLocations) }
      );
      return;
    }

    if (ctx.message.text === BACK_BUTTON_TEXT && lastLocation?.pendingFeedbackTarget) {
      lastLocations.set(chatId, {
        ...lastLocation,
        pendingFeedbackTarget: null,
        updatedAt: Date.now()
      });

      await ctx.reply("Ок, оставляем как есть.", {
        reply_markup: mainKeyboardFor(ctx, lastLocations)
      });
      return;
    }

    if (FEEDBACK_REASONS.has(ctx.message.text) && lastLocation?.pendingFeedbackTarget) {
      logFeedback(ctx, logger, lastLocation.pendingFeedbackTarget, ctx.message.text as FeedbackReasonButtonText);
      analytics.track("feedback_sent", ctx, feedbackSentPayload(
        lastLocation.pendingFeedbackTarget,
        ctx.message.text as FeedbackReasonButtonText
      ));
      lastLocations.set(chatId, {
        ...lastLocation,
        pendingFeedbackTarget: null,
        updatedAt: Date.now()
      });

      await ctx.reply("Спасибо! Запомнил, что вариант не подошёл.", {
        reply_markup: mainKeyboardFor(ctx, lastLocations)
      });
      return;
    }

    if (lastLocation?.pendingFeedbackTarget) {
      await ctx.reply("Выбери причину кнопкой или нажми «Назад».", {
        reply_markup: feedbackReasonKeyboard()
      });
      return;
    }

    if (ctx.message.text === BACK_BUTTON_TEXT && lastLocation?.pendingRouteReplacement) {
      lastLocations.set(chatId, {
        ...lastLocation,
        pendingRouteReplacement: false,
        pendingRouteReplacementExcludePlaceId: null,
        updatedAt: Date.now()
      });

      await ctx.reply("Ок, оставляем маршрут как есть.", {
        reply_markup: mainKeyboardFor(ctx, lastLocations)
      });
      return;
    }

    if (ctx.message.text === KEEP_ROUTE_BUTTON_TEXT && lastLocation?.pendingRouteReplacementExcludePlaceId) {
      lastLocations.set(chatId, {
        ...lastLocation,
        pendingRouteReplacement: false,
        pendingRouteReplacementExcludePlaceId: null,
        updatedAt: Date.now()
      });

      await ctx.reply("Ок, оставляем маршрут как есть.", {
        reply_markup: mainKeyboardFor(ctx, lastLocations)
      });
      return;
    }

    if (
      ctx.message.text === REBUILD_WITHOUT_ROUTE_STEP_BUTTON_TEXT &&
      lastLocation?.lastRoute &&
      lastLocation.pendingRouteReplacementExcludePlaceId
    ) {
      const routeLocation = {
        ...lastLocation,
        pendingRouteReplacement: false,
        pendingRouteReplacementExcludePlaceId: null,
        updatedAt: Date.now()
      };
      lastLocations.set(chatId, routeLocation);
      analytics.track("route_step_rebuild_without_place", ctx, {
        durationHours: lastLocation.lastRoute.durationHours,
        excludedPlaceId: lastLocation.pendingRouteReplacementExcludePlaceId
      });
      await sendRoute(
        ctx,
        repo,
        lastLocations,
        analytics,
        routeLocation,
        lastLocation.lastRoute.durationHours,
        lastLocation.lastRoute.routeStart,
        [lastLocation.pendingRouteReplacementExcludePlaceId],
        "rebuild_without_place"
      );
      return;
    }

    if (ctx.message.text === REBUILD_WITHOUT_ROUTE_STEP_BUTTON_TEXT) {
      await ctx.reply("Сначала выбери пункт маршрута, который нужно исключить.", {
        reply_markup: mainKeyboardFor(ctx, lastLocations)
      });
      return;
    }

    if (ctx.message.text === KEEP_ROUTE_BUTTON_TEXT) {
      await ctx.reply("Ок, оставляем маршрут как есть.", {
        reply_markup: mainKeyboardFor(ctx, lastLocations)
      });
      return;
    }

    const replaceStepMatch = /^(\d+)\.\s+/.exec(ctx.message.text);
    if (replaceStepMatch && lastLocation?.pendingRouteReplacement && lastLocation.lastRoute) {
      const stepIndex = Number(replaceStepMatch[1]) - 1;
      await replaceRouteStepAndReply(ctx, repo, lastLocations, analytics, lastLocation, stepIndex);
      return;
    }

    if (lastLocation?.pendingRouteReplacement) {
      await ctx.reply("Выбери пункт маршрута кнопкой или нажми «Назад».", {
        reply_markup: routeStepReplacementKeyboard(
          lastLocation.lastRoute?.steps.map((step) => step.name) ?? []
        )
      });
      return;
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
      analytics.track("location_submitted", ctx, {
        locationKind: "coordinates_text",
        latRounded: roundCoord(coordinates.lat),
        lonRounded: roundCoord(coordinates.lon),
        radiusMeters: config.SEARCH_RADIUS_METERS
      });
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
      analytics.track("location_submitted", ctx, {
        locationKind: "text_address",
        textLength: ctx.message.text.length
      });
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
      analytics.track("location_failed", ctx, {
        reason: "geocoder_error"
      });
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
      analytics.track("location_failed", ctx, {
        reason: "geocoder_failed"
      });
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
    analytics.track("location_resolved", ctx, {
      status: resolvedLocation.status,
      confidence: resolvedLocation.confidence,
      kind: resolvedLocation.kind,
      latRounded: roundCoord(resolvedLocation.lat),
      lonRounded: roundCoord(resolvedLocation.lon)
    });

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
      lastRoute: null,
      pendingRouteReplacement: false,
      pendingRouteReplacementExcludePlaceId: null,
      pendingFeedbackTarget: null,
      lastResultKind: null,
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

function formatScenarioIntro(scenarioKey: PlaceScenarioKey, locationLabel: string): string {
  return SCENARIO_INTRO[scenarioKey](locationLabel);
}

function formatScenarioRepeatIntro(scenarioKey: PlaceScenarioKey, locationLabel: string): string {
  return SCENARIO_REPEAT_INTRO[scenarioKey](locationLabel);
}

async function repeatLastAction(
  ctx: Context,
  repo: PlaceRepository,
  lastLocations: Map<number, LastLocation>,
  analytics: Analytics,
  lastLocation: LastLocation,
  options: {
    preserveCurrentRouteOnFailure?: boolean;
    rebuildCurrentRouteOnly?: boolean;
  } = {}
): Promise<void> {
  const action = lastLocation.lastAction;
  if (!action) {
    await sendScenarioMenu(ctx, lastLocations, lastLocation.label);
    return;
  }

  if (action.type === "scenario") {
    const scenario = PLACE_SCENARIOS[action.scenario];
    await sendNearbySuggestion(ctx, repo, lastLocations, analytics, {
      lat: lastLocation.lat,
      lon: lastLocation.lon,
      radiusMeters: lastLocation.radiusMeters,
      locationLabel: lastLocation.label,
      categorySlugs: scenario.categories,
      excludeRecentPlaces: true,
      action,
      intro: formatScenarioRepeatIntro(scenario.key, lastLocation.label)
    });
    return;
  }

  if (action.type === "route") {
    await sendRoute(
      ctx,
      repo,
      lastLocations,
      analytics,
      lastLocation,
      action.durationHours,
      action.routeStart,
      options.rebuildCurrentRouteOnly
        ? lastLocation.lastRoute?.steps.map((step) => step.placeId) ?? []
        : [],
      "rebuild",
      Boolean(options.preserveCurrentRouteOnFailure)
    );
    return;
  }

  await sendNearbySuggestion(ctx, repo, lastLocations, analytics, {
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
  analytics: Analytics,
  lastLocation: LastLocation,
  durationHours: RouteDurationHours,
  routeStart?: RouteStart,
  extraExcludePlaceIds: number[] = [],
  routeMode: RouteMode = "new",
  preserveCurrentRouteOnFailure = false
): Promise<void> {
  const start = routeStart ?? {
    lat: lastLocation.lat,
    lon: lastLocation.lon,
    label: lastLocation.label
  };
  const startedAt = new Date();

  let routeNote: string | null = null;
  let route = buildRoute(repo, {
    start: { lat: start.lat, lon: start.lon },
    radiusMeters: lastLocation.radiusMeters,
    now: startedAt,
    excludePlaceIds: extraExcludePlaceIds,
    durationHours
  });

  if (!route && preserveCurrentRouteOnFailure && extraExcludePlaceIds.length > 0) {
    route = buildRoute(repo, {
      start: { lat: start.lat, lon: start.lon },
      radiusMeters: lastLocation.radiusMeters,
      now: startedAt,
      excludePlaceIds: [],
      durationHours
    });
    if (route) {
      routeNote = "Не нашёл достаточно отличающийся маршрут, поэтому собрал ближайший рабочий вариант.";
    }
  }

  if (!route) {
    analytics.track(routeMode === "new" ? "route_failed" : "route_rebuild_failed", ctx, {
      durationHours,
      radiusMeters: lastLocation.radiusMeters,
      failureReason: preserveCurrentRouteOnFailure
        ? "could_not_rebuild_sequence"
        : "not_enough_open_places",
      routeMode
    });

    if (preserveCurrentRouteOnFailure && lastLocation.lastRoute) {
      await ctx.reply(
        "Не смог пересобрать маршрут так, чтобы он остался последовательным. Оставил предыдущий вариант.",
        { reply_markup: mainKeyboardFor(ctx, lastLocations) }
      );
      return;
    }

    if (ctx.chat?.id) {
      lastLocations.set(ctx.chat.id, {
        ...lastLocation,
        lastAction: null,
        lastSuggestedPlace: null,
        pendingRouteStart: null,
        lastRoute: null,
        pendingRouteReplacement: false,
        pendingRouteReplacementExcludePlaceId: null,
        pendingFeedbackTarget: null,
        lastResultKind: null,
        updatedAt: Date.now()
      });
    }

    await ctx.reply(
      "Не получилось собрать хороший маршрут на выбранную длительность. Похоже, рядом пока мало подходящих открытых мест.\n\nМожно попробовать другую длительность или выбрать конкретную категорию.",
      { reply_markup: mainKeyboardFor(ctx, lastLocations) }
    );
    return;
  }

  analytics.track(routeMode === "new" ? "route_built" : "route_rebuilt", ctx, {
    durationHours,
    routeSteps: route.length,
    routeDurationMinutes: routeDuration(route),
    routePlaceIds: route.map((step) => step.suggestion.placeId),
    primaryCategories: route.map((step) => primaryCategorySlug(step.suggestion)),
    totalWalkMinutes: route.reduce((sum, step) => sum + step.walkMinutes, 0),
    radiusMeters: lastLocation.radiusMeters,
    hadRouteNote: Boolean(routeNote),
    routeMode
  });

  if (ctx.chat?.id) {
    lastLocations.set(ctx.chat.id, {
      ...lastLocation,
      recentPlaceIds: lastLocation.recentPlaceIds,
      lastAction: { type: "route", durationHours, routeStart },
      lastSuggestedPlace: null,
      pendingRouteStart: null,
      lastRoute: toStoredRoute(route, durationHours, start, startedAt, routeStart),
      pendingRouteReplacement: false,
      pendingRouteReplacementExcludePlaceId: null,
      pendingFeedbackTarget: null,
      lastResultKind: "route",
      updatedAt: Date.now()
    });
  }

  const routeMessage = routeNote
    ? `${escapeHtml(routeNote)}\n\n${formatRoute(durationHours, start.label, route)}`
    : formatRoute(durationHours, start.label, route);

  await ctx.reply(routeMessage, {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: mainKeyboardFor(ctx, lastLocations)
  });
}

async function sendNearbySuggestion(
  ctx: Context,
  repo: PlaceRepository,
  lastLocations: Map<number, LastLocation>,
  analytics: Analytics,
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
  analytics.track("random_selected", ctx, {
    hasLocation: Boolean(lastLocation),
    radiusMeters: options.radiusMeters
  });
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
    analytics.track("place_not_found", ctx, {
      scenario: getScenarioFromAction(options.action),
      categorySlugs: options.categorySlugs ?? null,
      radiusMeters: options.radiusMeters,
      fallbackRadiusMeters,
      failureReason: "no_open_places"
    });

    if (chatId && lastLocation) {
      lastLocations.set(chatId, {
        ...lastLocation,
        lastAction: options.action ?? null,
        lastSuggestedPlace: null,
        pendingRouteStart: null,
        lastRoute: null,
        pendingRouteReplacement: false,
        pendingRouteReplacementExcludePlaceId: null,
        pendingFeedbackTarget: null,
        lastResultKind: null,
        updatedAt: Date.now()
      });
    }

    await ctx.reply(
      `Рядом в радиусе ${fallbackRadiusMeters} м пока нет открытых мест под этот сценарий. Можно сменить категорию или попробовать «Выбери сам».`,
      { reply_markup: mainKeyboardFor(ctx, lastLocations) }
    );
    return;
  }

  analytics.track("place_suggested", ctx, {
    scenario: getScenarioFromAction(options.action),
    categorySlugs: options.categorySlugs ?? null,
    radiusMeters: options.radiusMeters,
    resultRadiusMeters: result.radiusMeters,
    hadRadiusFallback: result.radiusMeters > options.radiusMeters,
    resetRecentPlaces: result.resetRecentPlaces,
    placeId: result.suggestion.placeId,
    primaryCategory: primaryCategorySlug(result.suggestion),
    distanceMeters: result.suggestion.distanceMeters,
    walkingMinutes: walkingMinutes(result.suggestion.distanceMeters)
  });

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
      lastRoute: null,
      pendingRouteReplacement: false,
      pendingRouteReplacementExcludePlaceId: null,
      pendingFeedbackTarget: null,
      lastResultKind: "place",
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

async function replaceRouteStepAndReply(
  ctx: Context,
  repo: PlaceRepository,
  lastLocations: Map<number, LastLocation>,
  analytics: Analytics,
  lastLocation: LastLocation,
  stepIndex: number
): Promise<void> {
  const chatId = ctx.chat?.id;
  const storedRoute = lastLocation.lastRoute;
  if (!chatId || !storedRoute) {
    await ctx.reply("Сначала нужно собрать маршрут, а потом уже менять в нём пункты.", {
      reply_markup: mainKeyboardFor(ctx, lastLocations)
    });
    return;
  }

  if (stepIndex < 0 || stepIndex >= storedRoute.steps.length) {
    await ctx.reply("Не нашёл такой пункт в маршруте. Выбери пункт кнопкой.", {
      reply_markup: routeStepReplacementKeyboard(storedRoute.steps.map((step) => step.name))
    });
    return;
  }

  const route = restoreStoredRoute(storedRoute);
  const oldStoredStep = storedRoute.steps[stepIndex];
  const result = replaceRouteStep(repo, {
    route,
    stepIndex,
    radiusMeters: lastLocation.radiusMeters,
    excludePlaceIds: [],
    durationHours: storedRoute.durationHours
  });

  if (!result) {
    analytics.track("route_step_replace_failed", ctx, {
      durationHours: storedRoute.durationHours,
      stepIndex,
      oldPlaceId: oldStoredStep?.placeId,
      failureReason: "no_valid_replacement"
    });

    lastLocations.set(chatId, {
      ...lastLocation,
      pendingRouteReplacement: false,
      pendingRouteReplacementExcludePlaceId: oldStoredStep?.placeId ?? null,
      updatedAt: Date.now()
    });

    await ctx.reply(
      "Не смог заменить только этот пункт так, чтобы маршрут остался нормальным. Могу пересобрать весь маршрут без него или оставить как было.",
      { reply_markup: routeReplacementFallbackKeyboard() }
    );
    return;
  }

  analytics.track("route_step_replaced", ctx, {
    durationHours: storedRoute.durationHours,
    stepIndex,
    oldPlaceId: result.oldStep.suggestion.placeId,
    newPlaceId: result.newStep.suggestion.placeId,
    routePlaceIds: result.route.map((step) => step.suggestion.placeId),
    routeDurationMinutes: routeDuration(result.route)
  });

  const updatedRoute = toStoredRoute(
    result.route,
    storedRoute.durationHours,
    storedRoute.start,
    new Date(storedRoute.startedAtIso),
    storedRoute.routeStart
  );
  lastLocations.set(chatId, {
    ...lastLocation,
    recentPlaceIds: appendRecentPlaceId(lastLocation.recentPlaceIds, result.newStep.suggestion.placeId),
    lastAction: {
      type: "route",
      durationHours: storedRoute.durationHours,
      routeStart: storedRoute.routeStart
    },
    lastSuggestedPlace: null,
    pendingRouteStart: null,
    lastRoute: updatedRoute,
    pendingRouteReplacement: false,
    pendingRouteReplacementExcludePlaceId: null,
    pendingFeedbackTarget: null,
    lastResultKind: "route",
    updatedAt: Date.now()
  });

  const status = [
    `Заменил пункт ${stepIndex + 1}.`,
    "",
    `Было: ${escapeHtml(result.oldStep.suggestion.name)}`,
    `Стало: ${escapeHtml(result.newStep.suggestion.name)}`,
    "",
    `Маршрут теперь примерно на ${escapeHtml(formatRouteDuration(routeDuration(result.route)))}.`
  ].join("\n");

  await ctx.reply(
    `${status}\n\n${formatRoute(storedRoute.durationHours, storedRoute.start.label, result.route)}`,
    {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: mainKeyboardFor(ctx, lastLocations)
    }
  );
}

function toStoredRoute(
  route: RouteStep[],
  durationHours: RouteDurationHours,
  start: RouteStart,
  startedAt: Date,
  routeStart?: RouteStart
): StoredRoute {
  return {
    durationHours,
    routeStart,
    start,
    startedAtIso: startedAt.toISOString(),
    steps: route.map((step) => ({
      placeId: step.suggestion.placeId,
      name: step.suggestion.name,
      scenarioKey: step.scenario.key,
      suggestion: step.suggestion
    }))
  };
}

function restoreStoredRoute(route: StoredRoute): RouteStep[] {
  return recalculateRouteSteps(
    route.steps.map((step) => ({
      scenario: PLACE_SCENARIOS[step.scenarioKey],
      suggestion: step.suggestion
    })),
    { lat: route.start.lat, lon: route.start.lon },
    new Date(route.startedAtIso)
  );
}

async function sendRandomSuggestion(
  ctx: Context,
  repo: PlaceRepository,
  lastLocations: Map<number, LastLocation>,
  analytics: Analytics,
  radiusMeters: number
): Promise<void> {
  const chatId = ctx.chat?.id;
  const lastLocation = chatId ? lastLocations.get(chatId) : undefined;
  analytics.track("random_selected", ctx, {
    hasLocation: Boolean(lastLocation),
    radiusMeters
  });
  if (lastLocation) {
    await sendNearbySuggestion(ctx, repo, lastLocations, analytics, {
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
    resultKind: lastLocation?.lastResultKind ?? null
  });
}

function feedbackTargetFromLastLocation(lastLocation: LastLocation): PendingFeedbackTarget | null {
  if (lastLocation.lastResultKind === "place" && lastLocation.lastSuggestedPlace?.placeId) {
    const scenario = lastLocation.lastAction?.type === "scenario"
      ? lastLocation.lastAction.scenario
      : undefined;
    return {
      type: "place",
      placeId: lastLocation.lastSuggestedPlace.placeId,
      scenario
    };
  }

  if (lastLocation.lastResultKind === "route" && lastLocation.lastRoute) {
    return {
      type: "route",
      durationHours: lastLocation.lastRoute.durationHours,
      placeIds: lastLocation.lastRoute.steps.map((step) => step.placeId)
    };
  }

  return null;
}

function getScenarioFromAction(action: LastAction | undefined): PlaceScenarioKey | "random" | null {
  if (!action) {
    return null;
  }

  if (action.type === "scenario") {
    return action.scenario;
  }

  if (action.type === "random") {
    return "random";
  }

  return null;
}

function feedbackStartedPayload(target: PendingFeedbackTarget): Record<string, unknown> {
  if (target.type === "place") {
    return {
      targetType: "place",
      placeId: target.placeId,
      scenario: target.scenario
    };
  }

  return {
    targetType: "route",
    durationHours: target.durationHours,
    routePlaceIds: target.placeIds
  };
}

function feedbackSentPayload(
  target: PendingFeedbackTarget,
  reason: FeedbackReasonButtonText
): Record<string, unknown> {
  return {
    ...feedbackStartedPayload(target),
    reason
  };
}

function logFeedback(
  ctx: Context,
  logger: AppLogger,
  target: PendingFeedbackTarget,
  reason: FeedbackReasonButtonText
): void {
  logger.info(
    {
      event: "feedback_sent",
      userId: ctx.from?.id,
      chatId: ctx.chat?.id,
      reason,
      ...target
    },
    "feedback_sent"
  );
}

function isRateLimited(
  ctx: Context,
  lastUpdateByChat: Map<number, number>,
  cooldownMs: number,
  now: number
): boolean {
  if (cooldownMs === 0 || !ctx.chat?.id) {
    return false;
  }

  if (ctx.message?.text?.startsWith("/")) {
    return false;
  }

  const previousUpdateAt = lastUpdateByChat.get(ctx.chat.id) ?? 0;
  if (now - previousUpdateAt < cooldownMs) {
    return true;
  }

  lastUpdateByChat.set(ctx.chat.id, now);
  return false;
}
