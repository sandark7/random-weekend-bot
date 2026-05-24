import { Bot, type Context } from "grammy";
import type { AppConfig } from "../config.js";
import type { PlaceRepository } from "../db/placeRepository.js";
import type { Coordinates } from "../geo/distance.js";
import type { LocationResolver, ResolvedLocation } from "../geo/locationResolver.js";
import type { AppLogger } from "../logger.js";
import type { PlaceSuggestion } from "../shared/types.js";
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
  ROUTE_DURATION_BUTTONS,
  type RouteDurationButtonText,
  locationConfirmationKeyboard,
  mainKeyboard,
  routeDurationKeyboard
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

type LastLocation = {
  lat: number;
  lon: number;
  label: string;
  radiusMeters: number;
  recentPlaceIds: number[];
  lastAction: LastAction | null;
  hasShownSuggestion: boolean;
  updatedAt: number;
};

type LastAction =
  | { type: "scenario"; scenario: PlaceScenarioKey }
  | { type: "random" }
  | { type: "route"; durationHours: RouteDurationHours };

type PlaceScenarioKey = "eat" | "coffee_snack" | "drink" | "see" | "outdoor" | "relax";
type RouteDurationHours = 2 | 3 | 5 | 8;

type PlaceScenario = {
  key: PlaceScenarioKey;
  button: DesireButtonText;
  label: string;
  categories: string[];
  durationMinutes: number;
};

type RouteStep = {
  scenario: PlaceScenario;
  suggestion: PlaceSuggestion;
  origin: Coordinates;
  arrival: Date;
  walkMinutes: number;
};

type NearbySuggestionResult = {
  suggestion: PlaceSuggestion;
  radiusMeters: number;
  radiusNote: string;
  resetRecentPlaces: boolean;
};

const RECENT_PLACE_HISTORY_LIMIT = 30;
const MAX_ROUTE_WALK_MINUTES = 20;
const WALKING_METERS_PER_MINUTE = 80;
const MAX_ROUTE_TRANSITION_METERS = MAX_ROUTE_WALK_MINUTES * WALKING_METERS_PER_MINUTE;
const MIN_ROUTE_FILL_RATIO = 0.65;
const MAX_ROUTE_OVERRUN_MINUTES = 25;

const SCENARIO_CATEGORIES = {
  eat: ["restaurant", "fine_dining"],
  coffee_snack: ["coffee", "breakfast", "quick_bite"],
  drink: ["bar", "cocktail_bar", "wine_bar", "pub"],
  see: ["culture", "landmark"],
  outdoor: ["park", "viewpoint"],
  relax: ["bathhouse", "activity"],
  random: [
    "restaurant",
    "fine_dining",
    "coffee",
    "breakfast",
    "quick_bite",
    "bar",
    "cocktail_bar",
    "wine_bar",
    "pub",
    "culture",
    "landmark",
    "park",
    "viewpoint",
    "bathhouse",
    "activity"
  ]
} as const satisfies Record<PlaceScenarioKey | "random", readonly string[]>;

const PLACE_SCENARIOS: Record<PlaceScenarioKey, PlaceScenario> = {
  eat: {
    key: "eat",
    button: "🍽 Поесть",
    label: "поесть",
    categories: [...SCENARIO_CATEGORIES.eat],
    durationMinutes: 90
  },
  coffee_snack: {
    key: "coffee_snack",
    button: "☕ Кофе и перекус",
    label: "кофе и перекус",
    categories: [...SCENARIO_CATEGORIES.coffee_snack],
    durationMinutes: 45
  },
  drink: {
    key: "drink",
    button: "🍸 Выпить",
    label: "выпить",
    categories: [...SCENARIO_CATEGORIES.drink],
    durationMinutes: 60
  },
  see: {
    key: "see",
    button: "🖼 Посмотреть",
    label: "посмотреть",
    categories: [...SCENARIO_CATEGORIES.see],
    durationMinutes: 75
  },
  outdoor: {
    key: "outdoor",
    button: "🌿 На воздух",
    label: "на воздух",
    categories: [...SCENARIO_CATEGORIES.outdoor],
    durationMinutes: 45
  },
  relax: {
    key: "relax",
    button: "🧖 Отдохнуть",
    label: "отдохнуть",
    categories: [...SCENARIO_CATEGORIES.relax],
    durationMinutes: 120
  }
};

const SCENARIO_BY_BUTTON = new Map<DesireButtonText, PlaceScenarioKey>(
  Object.values(PLACE_SCENARIOS).map((scenario) => [scenario.button, scenario.key])
);

const ROUTE_DURATION_BY_BUTTON = new Map<RouteDurationButtonText, RouteDurationHours>([
  ["2 часа", 2],
  ["3 часа", 3],
  ["5 часов", 5],
  ["8 часов", 8]
]);

const ROUTE_SCENARIO_POOL: PlaceScenarioKey[] = [
  "coffee_snack",
  "see",
  "outdoor",
  "eat",
  "drink",
  "relax"
];

export function createCityDateBot({ config, repo, locationResolver, logger }: CreateBotOptions): Bot {
  if (!config.BOT_TOKEN) {
    throw new Error("BOT_TOKEN is required to start the Telegram bot");
  }

  const bot = new Bot(config.BOT_TOKEN);
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
        "Отправь локацию с телефона или напиши адрес обычным сообщением вроде «Покровка 17». Можно и сразу довериться случайному выбору."
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
      await ctx.reply(
        "Сначала напиши адрес обычным сообщением, например «Покровка 17», или отправь геолокацию с телефона.",
        { reply_markup: mainKeyboardFor(ctx, lastLocations) }
      );
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

    await askRouteDuration(ctx);
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

    await sendRoute(ctx, repo, lastLocations, lastLocation, durationHours);
  });

  bot.hears(LOCATION_BUTTON_TEXT, async (ctx) => {
    if (ctx.chat?.id) {
      pendingConfirmations.delete(ctx.chat.id);
    }
    await ctx.reply(
      "Если ты в Telegram Desktop, эта кнопка может не открыть отправку геолокации. Напиши адрес текстом, например «Мясницкая 13», или нажми кнопку с телефона.",
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

  return bot;
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
    "Сначала отправь локацию с телефона или напиши адрес, например «Покровка 17». Так я смогу собрать варианты рядом.",
    { reply_markup: mainKeyboardFor(ctx, lastLocations) }
  );
}

async function askRouteDuration(ctx: Context): Promise<void> {
  await ctx.reply("На сколько часов собрать маршрут?", {
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
    await sendRoute(ctx, repo, lastLocations, lastLocation, action.durationHours);
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
    intro: `Ещё случайный выбор рядом с: ${lastLocation.label}`
  });
}

async function sendRoute(
  ctx: Context,
  repo: PlaceRepository,
  lastLocations: Map<number, LastLocation>,
  lastLocation: LastLocation,
  durationHours: RouteDurationHours
): Promise<void> {
  const route = buildRoute(repo, {
    start: { lat: lastLocation.lat, lon: lastLocation.lon },
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
      lastAction: { type: "route", durationHours },
      hasShownSuggestion: true,
      updatedAt: Date.now()
    });
  }

  await ctx.reply(formatRoute(durationHours, lastLocation.label, route), {
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
      `Рядом в радиусе ${fallbackRadiusMeters} м пока нет открытых мест под этот сценарий. Можно сменить категорию или попробовать случайный выбор.`,
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
      intro: `Случайный выбор рядом с: ${lastLocation.label}`,
      excludeRecentPlaces: true
    });
    return;
  }

  const suggestion = repo.randomOpenPlace();

  if (!suggestion) {
    await ctx.reply("В базе пока нет открытых мест. Сначала импортируем CSV, потом я оживу по-настоящему.", {
      reply_markup: mainKeyboardFor(ctx, lastLocations)
    });
    return;
  }

  await ctx.reply(formatSuggestion(suggestion), {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: mainKeyboardFor(ctx, lastLocations)
  });
}

function findNearbySuggestion(
  repo: PlaceRepository,
  options: {
    lat: number;
    lon: number;
    radiusMeters: number;
    categorySlugs?: readonly string[];
    excludePlaceIds: number[];
  }
): NearbySuggestionResult | null {
  const fallbackRadiusMeters = Math.max(options.radiusMeters * 2, 2500);
  const primarySuggestions = findNearbyByCategories(repo, {
    lat: options.lat,
    lon: options.lon,
    radiusMeters: options.radiusMeters,
    categorySlugs: options.categorySlugs,
    limit: 500
  });
  const primarySuggestion = pickRandomSuggestion(primarySuggestions, options.excludePlaceIds);
  if (primarySuggestion) {
    return {
      suggestion: primarySuggestion,
      radiusMeters: options.radiusMeters,
      radiusNote: "",
      resetRecentPlaces: false
    };
  }

  if (fallbackRadiusMeters > options.radiusMeters) {
    const fallbackSuggestions = findNearbyByCategories(repo, {
      lat: options.lat,
      lon: options.lon,
      radiusMeters: fallbackRadiusMeters,
      categorySlugs: options.categorySlugs,
      limit: 500
    });
    const fallbackSuggestion = pickRandomSuggestion(fallbackSuggestions, options.excludePlaceIds);
    if (fallbackSuggestion) {
      return {
        suggestion: fallbackSuggestion,
        radiusMeters: fallbackRadiusMeters,
        radiusNote: `В радиусе ${options.radiusMeters} м сейчас пусто, поэтому расширил поиск до ${fallbackRadiusMeters} м.`,
        resetRecentPlaces: false
      };
    }

    const repeatedFallbackSuggestion = pickRandomSuggestion(fallbackSuggestions, []);
    if (repeatedFallbackSuggestion) {
      return {
        suggestion: repeatedFallbackSuggestion,
        radiusMeters: fallbackRadiusMeters,
        radiusNote: `Все открытые места рядом уже показал, начинаю круг заново.`,
        resetRecentPlaces: true
      };
    }
  }

  const repeatedPrimarySuggestion = pickRandomSuggestion(primarySuggestions, []);
  if (repeatedPrimarySuggestion) {
    return {
      suggestion: repeatedPrimarySuggestion,
      radiusMeters: options.radiusMeters,
      radiusNote: `Все открытые места рядом уже показал, начинаю круг заново.`,
      resetRecentPlaces: true
    };
  }

  return null;
}

function pickRandomSuggestion(
  suggestions: PlaceSuggestion[],
  excludePlaceIds: number[]
): PlaceSuggestion | null {
  const excluded = new Set(excludePlaceIds);
  const candidates = suggestions.filter((suggestion) => !excluded.has(suggestion.placeId));

  if (candidates.length === 0) {
    return null;
  }

  return candidates[Math.floor(Math.random() * candidates.length)];
}

function findNearbyByCategories(
  repo: PlaceRepository,
  options: {
    lat: number;
    lon: number;
    radiusMeters: number;
    categorySlugs?: readonly string[];
    now?: Date;
    limit?: number;
  }
): PlaceSuggestion[] {
  if (!options.categorySlugs || options.categorySlugs.length === 0) {
    return repo.findNearby(options);
  }

  const byPlaceId = new Map<number, PlaceSuggestion>();
  for (const categorySlug of options.categorySlugs) {
    const suggestions = repo.findNearby({
      lat: options.lat,
      lon: options.lon,
      radiusMeters: options.radiusMeters,
      now: options.now,
      categorySlug,
      limit: options.limit
    });
    for (const suggestion of suggestions) {
      if (!byPlaceId.has(suggestion.placeId)) {
        byPlaceId.set(suggestion.placeId, suggestion);
      }
    }
  }

  return [...byPlaceId.values()].sort((left, right) => left.distanceMeters - right.distanceMeters);
}

export function buildRoute(
  repo: PlaceRepository,
  options: {
    start: Coordinates;
    radiusMeters: number;
    now: Date;
    excludePlaceIds: number[];
    durationHours: RouteDurationHours;
  }
): RouteStep[] | null {
  const targetMinutes = options.durationHours * 60;
  const transitionRadiusMeters = Math.min(options.radiusMeters, MAX_ROUTE_TRANSITION_METERS);
  const attempts: RouteStep[][] = [];

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const steps: RouteStep[] = [];
    const usedPlaceIds = new Set(options.excludePlaceIds);
    let origin = options.start;
    let elapsedMinutes = 0;
    let lastPrimaryCategory: string | null = null;
    let usedFineDining = 0;
    let usedBathhouse = 0;

    while (elapsedMinutes < targetMinutes) {
      const arrival = addMinutes(options.now, elapsedMinutes);
      const remainingMinutes = targetMinutes - elapsedMinutes;
      const picked = pickRouteStep(repo, {
        origin,
        arrival,
        remainingMinutes,
        radiusMeters: transitionRadiusMeters,
        usedPlaceIds,
        lastPrimaryCategory,
        usedFineDining,
        usedBathhouse
      });

      if (!picked) {
        break;
      }

      const { scenario, suggestion, walkMinutes } = picked;
      steps.push({ scenario, suggestion, origin, arrival, walkMinutes });
      usedPlaceIds.add(suggestion.placeId);
      lastPrimaryCategory = primaryCategorySlug(suggestion);
      if (hasCategory(suggestion, "fine_dining")) usedFineDining += 1;
      if (hasCategory(suggestion, "bathhouse")) usedBathhouse += 1;
      origin = { lat: suggestion.lat, lon: suggestion.lon };
      elapsedMinutes += walkMinutes + scenario.durationMinutes;
    }

    if (steps.length >= minRouteSteps(options.durationHours)) {
      attempts.push(steps);
    }
  }

  return attempts.sort((left, right) => routeScore(right, targetMinutes) - routeScore(left, targetMinutes))[0] ?? null;
}

function pickRouteStep(
  repo: PlaceRepository,
  options: {
    origin: Coordinates;
    arrival: Date;
    remainingMinutes: number;
    radiusMeters: number;
    usedPlaceIds: Set<number>;
    lastPrimaryCategory: string | null;
    usedFineDining: number;
    usedBathhouse: number;
  }
): { scenario: PlaceScenario; suggestion: PlaceSuggestion; walkMinutes: number } | null {
  const scenarioKeys = shuffle(allowedRouteScenarios(options.arrival, options.remainingMinutes));
  for (const scenarioKey of scenarioKeys) {
    const scenario = PLACE_SCENARIOS[scenarioKey];
    const candidates = findNearbyByCategories(repo, {
      lat: options.origin.lat,
      lon: options.origin.lon,
      radiusMeters: options.radiusMeters,
      categorySlugs: scenario.categories,
      now: options.arrival,
      limit: 500
    })
      .filter((suggestion) => !options.usedPlaceIds.has(suggestion.placeId))
      .filter((suggestion) => routeCandidateAllowed(suggestion, options.arrival, {
        lastPrimaryCategory: options.lastPrimaryCategory,
        usedFineDining: options.usedFineDining,
        usedBathhouse: options.usedBathhouse
      }))
      .filter((suggestion) => walkingMinutes(suggestion.distanceMeters) <= MAX_ROUTE_WALK_MINUTES)
      .filter((suggestion) => walkingMinutes(suggestion.distanceMeters) + scenario.durationMinutes <= options.remainingMinutes + MAX_ROUTE_OVERRUN_MINUTES);

    const suggestion = pickRandomSuggestion(candidates.slice(0, 25), []);
    if (suggestion) {
      return {
        scenario,
        suggestion,
        walkMinutes: walkingMinutes(suggestion.distanceMeters)
      };
    }
  }

  return null;
}

function allowedRouteScenarios(arrival: Date, remainingMinutes: number): PlaceScenarioKey[] {
  const minutes = moscowMinutes(arrival);
  const morning = minutes < 12 * 60;
  const evening = minutes >= 17 * 60;
  return ROUTE_SCENARIO_POOL.filter((scenarioKey) => {
    if (scenarioKey === "drink" && morning) return false;
    if (scenarioKey === "coffee_snack" && evening) return remainingMinutes <= 90;
    if (scenarioKey === "relax" && remainingMinutes < 150) return false;
    if (scenarioKey === "eat" && remainingMinutes < 120) return false;
    return PLACE_SCENARIOS[scenarioKey].durationMinutes <= remainingMinutes + MAX_ROUTE_OVERRUN_MINUTES;
  });
}

function routeCandidateAllowed(
  suggestion: PlaceSuggestion,
  arrival: Date,
  state: {
    lastPrimaryCategory: string | null;
    usedFineDining: number;
    usedBathhouse: number;
  }
): boolean {
  const primary = primaryCategorySlug(suggestion);
  if (primary && primary === state.lastPrimaryCategory) return false;
  if (hasCategory(suggestion, "fine_dining") && state.usedFineDining >= 1) return false;
  if (hasCategory(suggestion, "bathhouse") && state.usedBathhouse >= 1) return false;

  const minutes = moscowMinutes(arrival);
  if (minutes < 12 * 60 && hasAnyCategory(suggestion, SCENARIO_CATEGORIES.drink)) return false;
  if (minutes >= 17 * 60 && hasCategory(suggestion, "breakfast")) return false;

  return true;
}

function routeScore(route: RouteStep[], targetMinutes: number): number {
  const total = routeDuration(route);
  const fillRatio = total / targetMinutes;
  const fillPenalty = fillRatio < MIN_ROUTE_FILL_RATIO ? (MIN_ROUTE_FILL_RATIO - fillRatio) * 100 : 0;
  const overrunPenalty = total > targetMinutes + MAX_ROUTE_OVERRUN_MINUTES ? (total - targetMinutes) * 2 : 0;
  const categoryVariety = new Set(route.map((step) => primaryCategorySlug(step.suggestion))).size;
  return route.length * 20 + categoryVariety * 5 - Math.abs(targetMinutes - total) * 0.25 - fillPenalty - overrunPenalty;
}

function routeDuration(route: RouteStep[]): number {
  return route.reduce((sum, step) => sum + step.walkMinutes + step.scenario.durationMinutes, 0);
}

function minRouteSteps(durationHours: RouteDurationHours): number {
  if (durationHours <= 2) return 2;
  if (durationHours <= 3) return 3;
  if (durationHours <= 5) return 4;
  return 5;
}

function moscowMinutes(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function shuffle<T>(values: T[]): T[] {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function formatRoute(durationHours: RouteDurationHours, locationLabel: string, route: RouteStep[]): string {
  const lines = [
    `<b>${escapeHtml(`Собрал маршрут на ~${durationHours} ч`)}</b>`,
    escapeHtml(formatLocationIntro(locationLabel)),
    ""
  ];

  route.forEach((step, index) => {
    if (index > 0) {
      lines.push("");
    }
    lines.push(`<b>${index + 1}. ${escapeHtml(step.scenario.label)}</b>`);
    lines.push(formatSuggestion(step.suggestion, { origin: step.origin, now: step.arrival }));
  });

  return lines.join("\n");
}

function walkingMinutes(distanceMeters: number): number {
  return Math.max(1, Math.round(distanceMeters / WALKING_METERS_PER_MINUTE));
}

function primaryCategorySlug(suggestion: PlaceSuggestion): string | null {
  return suggestion.categories.find((category) => category.isPrimary)?.slug ?? suggestion.categories[0]?.slug ?? null;
}

function hasCategory(suggestion: PlaceSuggestion, slug: string): boolean {
  return suggestion.categories.some((category) => category.slug === slug);
}

function hasAnyCategory(suggestion: PlaceSuggestion, slugs: readonly string[]): boolean {
  return suggestion.categories.some((category) => slugs.includes(category.slug));
}

function appendRecentPlaceId(recentPlaceIds: number[], placeId: number): number[] {
  return [...recentPlaceIds.filter((recentPlaceId) => recentPlaceId !== placeId), placeId].slice(
    -RECENT_PLACE_HISTORY_LIMIT
  );
}

function appendRecentPlaceIds(recentPlaceIds: number[], placeIds: number[]): number[] {
  return placeIds.reduce((recent, placeId) => appendRecentPlaceId(recent, placeId), recentPlaceIds);
}

function mainKeyboardFor(ctx: Context, lastLocations: Map<number, LastLocation>) {
  const lastLocation = ctx.chat?.id ? lastLocations.get(ctx.chat.id) : undefined;
  return mainKeyboard({
    hasResolvedLocation: Boolean(lastLocation),
    showResultActions: lastLocation?.hasShownSuggestion === true
  });
}

function formatLocationIntro(label: string): string {
  if (label === "вашей геолокацией" || label === "координатами") {
    return `Ищу рядом с ${label}`;
  }

  return `Ищу рядом с: ${label}`;
}
