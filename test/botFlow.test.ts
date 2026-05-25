import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src-node/config.js";
import type { PlaceRepository } from "../src-node/db/placeRepository.js";
import type { LocationResolver } from "../src-node/geo/locationResolver.js";
import type { AppLogger } from "../src-node/logger.js";
import { createCityDateBot } from "../src-node/bot/createBot.js";
import {
  DESIRE_BUTTONS,
  LOCATION_BUTTON_TEXT,
  RANDOM_BUTTON_TEXT,
  REBUILD_ROUTE_BUTTON_TEXT,
  REPLACE_ROUTE_STEP_BUTTON_TEXT,
  ROUTE_BUTTON_TEXT,
  ROUTE_FROM_RESULT_BUTTON_TEXT
} from "../src-node/bot/keyboards.js";
import type { OpeningHoursJson, PlaceSuggestion } from "../src-node/shared/types.js";

type ApiCall = {
  method: string;
  payload: Record<string, unknown>;
};

type NearbyCall = {
  lat: number;
  lon: number;
  categorySlug?: string;
  radiusMeters?: number;
};

const chatId = 101;
const userId = 202;
const allDayHours: OpeningHoursJson = {
  timezone: "Europe/Moscow",
  weekly: {
    mon: [{ from: "00:00", to: "23:59" }],
    tue: [{ from: "00:00", to: "23:59" }],
    wed: [{ from: "00:00", to: "23:59" }],
    thu: [{ from: "00:00", to: "23:59" }],
    fri: [{ from: "00:00", to: "23:59" }],
    sat: [{ from: "00:00", to: "23:59" }],
    sun: [{ from: "00:00", to: "23:59" }]
  }
};

beforeEach(() => {
  vi.spyOn(Math, "random").mockReturnValue(0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("bot conversation flow", () => {
  it("starts with location-only UX and explains plain-text addresses", async () => {
    const { bot, replies } = createHarness();

    await sendText(bot, "/start");

    expect(replies.at(-1)?.text).toContain("Random Weekend");
    expect(replies.at(-1)?.text).toContain("Тверская 7");
    expect(replies.at(-1)?.text).toContain("Патриаршие пруды");
    expect(replies.at(-1)?.replyMarkup).toMatchObject({
      keyboard: [[{ text: LOCATION_BUTTON_TEXT, request_location: true }]]
    });
  });

  it("does not serve /random before a location is resolved", async () => {
    const { bot, replies, repo } = createHarness();

    await sendText(bot, "/random");

    expect(repo.randomOpenPlace).not.toHaveBeenCalled();
    expect(repo.findNearby).not.toHaveBeenCalled();
    expect(replies.at(-1)?.text).toContain("Сначала нужно понять");
    expect(replies.at(-1)?.replyMarkup).toMatchObject({
      keyboard: [[{ text: LOCATION_BUTTON_TEXT, request_location: true }]]
    });
  });

  it("shows the scenario menu after resolving a text location", async () => {
    const { bot, replies } = createHarness();

    await sendText(bot, "Дубининская 59");

    expect(replies.at(-1)?.text).toContain("Ищу рядом с: Москва, Дубининская улица, 59");
    expect(replies.at(-1)?.replyMarkup).toMatchObject({
      keyboard: [
        [{ text: DESIRE_BUTTONS[0] }, { text: DESIRE_BUTTONS[1] }],
        [{ text: DESIRE_BUTTONS[2] }, { text: DESIRE_BUTTONS[3] }],
        [{ text: DESIRE_BUTTONS[4] }, { text: DESIRE_BUTTONS[5] }],
        [{ text: RANDOM_BUTTON_TEXT }, { text: ROUTE_BUTTON_TEXT }]
      ]
    });
  });

  it("uses human scenario copy and switches to place-result buttons", async () => {
    const { bot, replies } = createHarness();

    await sendText(bot, "Дубининская 59");
    await sendText(bot, "🏛 Город");

    const reply = replies.at(-1);
    expect(reply?.text).toContain("Ищу городскую точку рядом с: Москва, Дубининская улица, 59");
    expect(reply?.text).not.toContain("Ищу, где город");
    expect(reply?.text).toContain("ГЭС-2");
    expect(reply?.replyMarkup).toMatchObject({
      keyboard: [
        [{ text: "🔁 Ещё вариант" }, { text: ROUTE_FROM_RESULT_BUTTON_TEXT }],
        [{ text: "🔄 Сменить категорию" }, { text: RANDOM_BUTTON_TEXT }]
      ]
    });
  });

  it("builds route-from-result from the suggested place, not from the original location", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T09:00:00Z"));
    const { bot, replies, nearbyCalls } = createHarness();

    await sendText(bot, "Дубининская 59");
    await sendText(bot, "🏛 Город");
    await sendText(bot, ROUTE_FROM_RESULT_BUTTON_TEXT);

    expect(replies.at(-1)?.text).toBe("На сколько часов собрать маршрут от места «ГЭС-2»?");

    const callCountBeforeRoute = nearbyCalls.length;
    await sendText(bot, "2 часа");
    const routeCalls = nearbyCalls.slice(callCountBeforeRoute);

    expect(routeCalls[0]).toMatchObject({
      lat: 55.741,
      lon: 37.611
    });
    expect(replies.at(-1)?.text).toContain("Ищу рядом с: ГЭС-2");
    expect(replies.at(-1)?.replyMarkup).toMatchObject({
      keyboard: [
        [{ text: REBUILD_ROUTE_BUTTON_TEXT }, { text: REPLACE_ROUTE_STEP_BUTTON_TEXT }],
        [{ text: RANDOM_BUTTON_TEXT }, { text: ROUTE_BUTTON_TEXT }]
      ]
    });

    vi.useRealTimers();
  });
});

function createHarness() {
  const replies: Array<{
    text: string;
    replyMarkup?: unknown;
  }> = [];
  const apiCalls: ApiCall[] = [];
  const nearbyCalls: NearbyCall[] = [];
  let nextGeneratedPlaceId = 1000;

  const repo = {
    findNearby: vi.fn((options: NearbyCall) => {
      nearbyCalls.push(options);
      const categorySlug = options.categorySlug ?? "restaurant";
      if (categorySlug === "culture") {
        return [
          makeSuggestion({
            placeId: 1,
            name: "ГЭС-2",
            slug: "culture",
            categoryName: "Культура",
            lat: 55.741,
            lon: 37.611,
            distanceMeters: 250
          })
        ];
      }
      if (["landmark", "viewpoint", "park"].includes(categorySlug)) {
        return [];
      }

      return [
        makeSuggestion({
          placeId: nextGeneratedPlaceId++,
          name: `${categorySlug} рядом`,
          slug: categorySlug,
          lat: options.lat + 0.001,
          lon: options.lon + 0.001,
          distanceMeters: 120
        }),
        makeSuggestion({
          placeId: nextGeneratedPlaceId++,
          name: `${categorySlug} ещё`,
          slug: categorySlug,
          lat: options.lat + 0.0015,
          lon: options.lon + 0.0015,
          distanceMeters: 180
        })
      ];
    }),
    randomOpenPlace: vi.fn()
  } as unknown as PlaceRepository & {
    findNearby: ReturnType<typeof vi.fn>;
    randomOpenPlace: ReturnType<typeof vi.fn>;
  };

  const locationResolver = {
    resolve: vi.fn(async (query: string) => ({
      status: "ok" as const,
      confidence: "good" as const,
      kind: "exact_address" as const,
      query,
      label: "Москва, Дубининская улица, 59",
      lat: 55.729,
      lon: 37.636
    }))
  } as unknown as LocationResolver;

  const bot = createCityDateBot({
    config: makeConfig(),
    repo,
    locationResolver,
    logger: makeLogger()
  });
  bot.botInfo = {
    id: 777,
    is_bot: true,
    first_name: "Random Weekend",
    username: "random_weekend_test_bot",
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false
  } as typeof bot.botInfo;
  bot.api.config.use((async (_prev, method, payload) => {
    apiCalls.push({ method, payload: payload as Record<string, unknown> });
    if (method === "sendMessage") {
      replies.push({
        text: String((payload as { text: string }).text),
        replyMarkup: (payload as { reply_markup?: unknown }).reply_markup
      });
      return {
        ok: true,
        result: {
          message_id: replies.length,
          date: Math.floor(Date.now() / 1000),
          chat: { id: chatId, type: "private" },
          text: (payload as { text: string }).text
        }
      };
    }

    return { ok: true, result: true };
  }) as Parameters<typeof bot.api.config.use>[0]);

  return {
    apiCalls,
    bot,
    locationResolver,
    nearbyCalls,
    replies,
    repo
  };
}

async function sendText(bot: ReturnType<typeof createCityDateBot>, text: string): Promise<void> {
  const entities = text.startsWith("/")
    ? [{ type: "bot_command" as const, offset: 0, length: text.split(/\s+/, 1)[0]?.length ?? text.length }]
    : undefined;
  await bot.handleUpdate({
    update_id: nextUpdateId(),
    message: {
      message_id: nextUpdateId(),
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: "private", first_name: "Tester" },
      from: { id: userId, is_bot: false, first_name: "Tester" },
      entities,
      text
    }
  } as Parameters<typeof bot.handleUpdate>[0]);
}

let updateId = 1;
function nextUpdateId(): number {
  updateId += 1;
  return updateId;
}

function makeSuggestion(options: {
  placeId: number;
  name: string;
  slug: string;
  categoryName?: string;
  lat: number;
  lon: number;
  distanceMeters: number;
}): PlaceSuggestion {
  return {
    placeId: options.placeId,
    name: options.name,
    categories: [
      {
        slug: options.slug,
        name: options.categoryName ?? options.slug,
        isPrimary: true
      }
    ],
    description: "Живое место для прогулочного сценария.",
    address: "Москва",
    lat: options.lat,
    lon: options.lon,
    distanceMeters: options.distanceMeters,
    openingHoursText: "Ежедневно 00:00-23:59",
    openingHoursJson: allDayHours
  };
}

function makeConfig(): AppConfig {
  return {
    NODE_ENV: "test",
    BOT_TOKEN: "123:test",
    BOT_MODE: "polling",
    HOST: "127.0.0.1",
    PORT: 3000,
    DATABASE_PATH: "./data/test.sqlite",
    IMPORT_DIR: "./data/import",
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
    LOG_LEVEL: "silent"
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
