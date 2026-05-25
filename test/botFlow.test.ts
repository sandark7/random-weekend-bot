import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../src-node/config.js";
import type { PlaceRepository } from "../src-node/db/placeRepository.js";
import type { LocationResolver } from "../src-node/geo/locationResolver.js";
import type { AppLogger } from "../src-node/logger.js";
import { createCityDateBot } from "../src-node/bot/createBot.js";
import {
  BACK_BUTTON_TEXT,
  CHANGE_LOCATION_BUTTON_TEXT,
  CONFIRM_LOCATION_BUTTON_TEXT,
  DESIRE_BUTTONS,
  FEEDBACK_BUTTON_TEXT,
  KEEP_ROUTE_BUTTON_TEXT,
  LOCATION_BUTTON_TEXT,
  RANDOM_BUTTON_TEXT,
  REBUILD_ROUTE_BUTTON_TEXT,
  REBUILD_WITHOUT_ROUTE_STEP_BUTTON_TEXT,
  REPLACE_ROUTE_STEP_BUTTON_TEXT,
  ROUTE_BUTTON_TEXT
} from "../src-node/bot/keyboards.js";
import type { ResolvedLocation } from "../src-node/geo/locationResolver.js";
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

type HarnessOptions = {
  resolverResult?: ResolvedLocation;
  resolverThrows?: boolean;
  emptyCategorySlugs?: readonly string[];
  noRoute?: boolean;
  noReplacement?: boolean;
  chatCooldownMs?: number;
  maxTextInputLength?: number;
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

  it("accepts a shared Telegram location as an alternative starting point", async () => {
    const { bot, replies, locationResolver } = createHarness();

    await sendText(bot, "/start");
    await sendLocation(bot, 55.75, 37.61);

    expect(locationResolver.resolve).not.toHaveBeenCalled();
    expect(replies.at(-1)?.text).toContain("Ищу рядом с вашей геолокацией");
    expect(replies.at(-1)?.replyMarkup).toMatchObject({
      keyboard: [
        [{ text: DESIRE_BUTTONS[0] }, { text: DESIRE_BUTTONS[1] }],
        [{ text: DESIRE_BUTTONS[2] }, { text: DESIRE_BUTTONS[3] }],
        [{ text: DESIRE_BUTTONS[4] }, { text: DESIRE_BUTTONS[5] }],
        [{ text: RANDOM_BUTTON_TEXT }, { text: ROUTE_BUTTON_TEXT }]
      ]
    });
  });

  it("asks for confirmation when a text location is uncertain and stores it after yes", async () => {
    const { bot, replies } = createHarness({
      resolverResult: {
        status: "needs_confirmation",
        confidence: "medium",
        kind: "exact_address",
        query: "Тверская 7",
        label: "Москва, Тверская улица, 7",
        lat: 55.758,
        lon: 37.612
      }
    });

    await sendText(bot, "Тверская 7");

    expect(replies.at(-1)?.text).toBe("Похоже, вы имели в виду: Москва, Тверская улица, 7?");
    expect(replies.at(-1)?.replyMarkup).toMatchObject({
      keyboard: [
        [{ text: CONFIRM_LOCATION_BUTTON_TEXT }],
        [{ text: CHANGE_LOCATION_BUTTON_TEXT }],
        [{ text: LOCATION_BUTTON_TEXT, request_location: true }]
      ]
    });

    await sendText(bot, CONFIRM_LOCATION_BUTTON_TEXT);

    expect(replies.at(-1)?.text).toContain("Ищу рядом с: Москва, Тверская улица, 7");
    expect(replies.at(-1)?.replyMarkup).toMatchObject({
      keyboard: [
        [{ text: DESIRE_BUTTONS[0] }, { text: DESIRE_BUTTONS[1] }],
        [{ text: DESIRE_BUTTONS[2] }, { text: DESIRE_BUTTONS[3] }],
        [{ text: DESIRE_BUTTONS[4] }, { text: DESIRE_BUTTONS[5] }],
        [{ text: RANDOM_BUTTON_TEXT }, { text: ROUTE_BUTTON_TEXT }]
      ]
    });
  });

  it("does not show scenarios when a text location cannot be resolved", async () => {
    const { bot, replies } = createHarness({
      resolverResult: {
        status: "failed",
        confidence: "low",
        kind: "unknown",
        reason: "not_found"
      }
    });

    await sendText(bot, "мусорный адрес без смысла");

    expect(replies.at(-1)?.text).toContain("Не смог точно понять адрес");
    expect(replies.at(-1)?.replyMarkup).toMatchObject({
      keyboard: [[{ text: LOCATION_BUTTON_TEXT, request_location: true }]]
    });
  });

  it("rejects very long text before geocoding", async () => {
    const { bot, replies, locationResolver } = createHarness({ maxTextInputLength: 20 });

    await sendText(bot, "очень длинный пользовательский текст вместо адреса");

    expect(locationResolver.resolve).not.toHaveBeenCalled();
    expect(replies.at(-1)?.text).toContain("Сообщение слишком длинное");
  });

  it("rate limits rapid repeated chat messages", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T09:00:00Z"));
    const { bot, replies, locationResolver } = createHarness({ chatCooldownMs: 700 });

    await sendText(bot, "Дубининская 59");
    await sendText(bot, "Покровка 17");

    expect(locationResolver.resolve).toHaveBeenCalledTimes(1);
    expect(replies.at(-1)?.text).toContain("Слишком быстро");

    vi.setSystemTime(new Date("2026-05-24T09:00:01Z"));
    await sendText(bot, "Покровка 17");

    expect(locationResolver.resolve).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
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
        [{ text: "🔁 Ещё вариант" }, { text: FEEDBACK_BUTTON_TEXT }],
        [{ text: "🔄 Сменить категорию" }, { text: RANDOM_BUTTON_TEXT }],
        [{ text: ROUTE_BUTTON_TEXT }]
      ]
    });
  });

  it("serves choose-it-for-me nearby after location without hookah categories", async () => {
    const { bot, replies, nearbyCalls } = createHarness();

    await sendText(bot, "Дубининская 59");
    await sendText(bot, RANDOM_BUTTON_TEXT);

    expect(nearbyCalls.map((call) => call.categorySlug)).not.toContain("hookah");
    expect(nearbyCalls.map((call) => call.categorySlug)).not.toContain("bathhouse");
    expect(replies.at(-1)?.text).toContain("Выбираю рядом с: Москва, Дубининская улица, 59");
    expect(replies.at(-1)?.replyMarkup).toMatchObject({
      keyboard: [
        [{ text: "🔁 Ещё вариант" }, { text: FEEDBACK_BUTTON_TEXT }],
        [{ text: "🔄 Сменить категорию" }, { text: RANDOM_BUTTON_TEXT }],
        [{ text: ROUTE_BUTTON_TEXT }]
      ]
    });
  });

	  it("collects feedback for the last suggested place", async () => {
	    const { bot, logger, replies } = createHarness();

    await sendText(bot, "Дубининская 59");
    await sendText(bot, "🍸 Выпить");
    await sendText(bot, FEEDBACK_BUTTON_TEXT);

    expect(replies.at(-1)?.text).toBe("Что не так?");
    expect(replies.at(-1)?.replyMarkup).toMatchObject({
      keyboard: [
        [{ text: "Далеко" }, { text: "Не то" }],
        [{ text: "Закрыто" }, { text: "Описание врёт" }],
        [{ text: "Маршрут странный" }, { text: "Другое" }],
        [{ text: BACK_BUTTON_TEXT }]
      ]
    });

    await sendText(bot, "Не то");

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "feedback_sent",
        type: "place",
        placeId: 201,
        reason: "Не то",
        scenario: "drink"
      }),
      "feedback_sent"
    );
	    expect(replies.at(-1)?.text).toContain("Спасибо");
	  });

	  it("collects feedback for the last route", async () => {
	    vi.useFakeTimers();
	    vi.setSystemTime(new Date("2026-05-24T09:00:00Z"));
	    const { bot, logger, replies } = createHarness();

	    await sendText(bot, "Дубининская 59");
	    await sendText(bot, ROUTE_BUTTON_TEXT);
	    await sendText(bot, "3 часа");
	    await sendText(bot, FEEDBACK_BUTTON_TEXT);

	    expect(replies.at(-1)?.text).toBe("Что не так?");

	    await sendText(bot, "Маршрут странный");

	    expect(logger.info).toHaveBeenCalledWith(
	      expect.objectContaining({
	        event: "feedback_sent",
	        type: "route",
	        durationHours: 3,
	        reason: "Маршрут странный",
	        placeIds: expect.any(Array)
	      }),
	      "feedback_sent"
	    );
	    expect(replies.at(-1)?.text).toContain("Спасибо");

	    vi.useRealTimers();
	  });

  it("prefers primary drink places over restaurants that only have pub as secondary", async () => {
    const { bot, replies } = createHarness();

    await sendText(bot, "Дубининская 59");
    await sendText(bot, "🍸 Выпить");

    expect(replies.at(-1)?.text).toContain("Настоящий бар");
    expect(replies.at(-1)?.text).not.toContain("Ресторан с пабом");
  });

  it("repeats the last place scenario without changing the origin or repeating the same place", async () => {
    const { bot, replies, nearbyCalls } = createHarness();

    await sendText(bot, "Дубининская 59");
    await sendText(bot, "🍸 Выпить");
    const firstReply = replies.at(-1)?.text;
    await sendText(bot, "🔁 Ещё вариант");

    expect(replies.at(-1)?.text).toContain("Ещё вариант, где выпить, рядом с: Москва, Дубининская улица, 59");
    expect(replies.at(-1)?.text).not.toBe(firstReply);
    expect(nearbyCalls.at(-1)).toMatchObject({
      lat: 55.729,
      lon: 37.636
    });
  });

  it("returns to scenario menu after changing category", async () => {
    const { bot, replies } = createHarness();

    await sendText(bot, "Дубининская 59");
    await sendText(bot, "🏛 Город");
    await sendText(bot, "🔄 Сменить категорию");

    expect(replies.at(-1)?.text).toContain("Что хочется сделать?");
    expect(replies.at(-1)?.replyMarkup).toMatchObject({
      keyboard: [
        [{ text: DESIRE_BUTTONS[0] }, { text: DESIRE_BUTTONS[1] }],
        [{ text: DESIRE_BUTTONS[2] }, { text: DESIRE_BUTTONS[3] }],
        [{ text: DESIRE_BUTTONS[4] }, { text: DESIRE_BUTTONS[5] }],
        [{ text: RANDOM_BUTTON_TEXT }, { text: ROUTE_BUTTON_TEXT }]
      ]
    });
  });

  it("clears stale place result context when a new scenario has no places", async () => {
    const { bot, replies } = createHarness({ emptyCategorySlugs: ["coffee", "breakfast", "quick_bite"] });

    await sendText(bot, "Дубининская 59");
    await sendText(bot, "🏛 Город");
    expect(replies.at(-1)?.text).toContain("ГЭС-2");

    await sendText(bot, "☕ Кофе / перекус");

    expect(replies.at(-1)?.text).toContain("пока нет открытых мест");
    expect(replies.at(-1)?.replyMarkup).toMatchObject({
      keyboard: [
        [{ text: DESIRE_BUTTONS[0] }, { text: DESIRE_BUTTONS[1] }],
        [{ text: DESIRE_BUTTONS[2] }, { text: DESIRE_BUTTONS[3] }],
        [{ text: DESIRE_BUTTONS[4] }, { text: DESIRE_BUTTONS[5] }],
        [{ text: RANDOM_BUTTON_TEXT }, { text: ROUTE_BUTTON_TEXT }]
      ]
    });
  });

	it("builds a route from the original location and keeps route-result buttons", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T09:00:00Z"));
    const { bot, replies, nearbyCalls } = createHarness();

    await sendText(bot, "Дубининская 59");
    await sendText(bot, ROUTE_BUTTON_TEXT);
    expect(replies.at(-1)?.text).toBe("На сколько часов собрать маршрут?");

    const callCountBeforeRoute = nearbyCalls.length;
    await sendText(bot, "5 часов");
    const routeCalls = nearbyCalls.slice(callCountBeforeRoute);

    expect(routeCalls[0]).toMatchObject({
      lat: 55.729,
      lon: 37.636
    });
    expect(replies.at(-1)?.text).toContain("Собрал маршрут");
    expect(replies.at(-1)?.text).toContain("Ищу рядом с: Москва, Дубининская улица, 59");
	    expect(replies.at(-1)?.replyMarkup).toMatchObject({
	      keyboard: [
	        [{ text: REBUILD_ROUTE_BUTTON_TEXT }, { text: REPLACE_ROUTE_STEP_BUTTON_TEXT }],
	        [{ text: FEEDBACK_BUTTON_TEXT }, { text: ROUTE_BUTTON_TEXT }]
	      ]
	    });

    vi.useRealTimers();
  });

	it("builds a route from the original location after a place card", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T09:00:00Z"));
    const { bot, replies, nearbyCalls } = createHarness();

    await sendText(bot, "Дубининская 59");
    await sendText(bot, "🏛 Город");
    await sendText(bot, ROUTE_BUTTON_TEXT);

    expect(replies.at(-1)?.text).toBe("На сколько часов собрать маршрут?");

    const callCountBeforeRoute = nearbyCalls.length;
    await sendText(bot, "2 часа");
    const routeCalls = nearbyCalls.slice(callCountBeforeRoute);

    expect(routeCalls[0]).toMatchObject({
      lat: 55.729,
      lon: 37.636
    });
    expect(replies.at(-1)?.text).toContain("Ищу рядом с: Москва, Дубининская улица, 59");
	    expect(replies.at(-1)?.replyMarkup).toMatchObject({
	      keyboard: [
	        [{ text: REBUILD_ROUTE_BUTTON_TEXT }, { text: REPLACE_ROUTE_STEP_BUTTON_TEXT }],
	        [{ text: FEEDBACK_BUTTON_TEXT }, { text: ROUTE_BUTTON_TEXT }]
	      ]
	    });

    vi.useRealTimers();
  });

  it("keeps route context after a failed route build", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T09:00:00Z"));
    const { bot, replies } = createHarness({ noRoute: true });

    await sendText(bot, "Дубининская 59");
    await sendText(bot, ROUTE_BUTTON_TEXT);
    await sendText(bot, "5 часов");

    expect(replies.at(-1)?.text).toContain("Не получилось собрать хороший маршрут");
    expect(replies.at(-1)?.replyMarkup).toMatchObject({
      keyboard: [
        [{ text: DESIRE_BUTTONS[0] }, { text: DESIRE_BUTTONS[1] }],
        [{ text: DESIRE_BUTTONS[2] }, { text: DESIRE_BUTTONS[3] }],
        [{ text: DESIRE_BUTTONS[4] }, { text: DESIRE_BUTTONS[5] }],
        [{ text: RANDOM_BUTTON_TEXT }, { text: ROUTE_BUTTON_TEXT }]
      ]
    });

    vi.useRealTimers();
  });

  it("clears stale route context after a new route build fails", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T09:00:00Z"));
    const { bot, replies, setNoRoute } = createHarness();

    await sendText(bot, "Дубининская 59");
    await sendText(bot, ROUTE_BUTTON_TEXT);
    await sendText(bot, "3 часа");
    expect(replies.at(-1)?.text).toContain("Собрал маршрут");

    setNoRoute(true);
    await sendText(bot, ROUTE_BUTTON_TEXT);
    await sendText(bot, "2 часа");

    expect(replies.at(-1)?.text).toContain("Не получилось собрать хороший маршрут");
    expect(replies.at(-1)?.replyMarkup).toMatchObject({
      keyboard: [
        [{ text: DESIRE_BUTTONS[0] }, { text: DESIRE_BUTTONS[1] }],
        [{ text: DESIRE_BUTTONS[2] }, { text: DESIRE_BUTTONS[3] }],
        [{ text: DESIRE_BUTTONS[4] }, { text: DESIRE_BUTTONS[5] }],
        [{ text: RANDOM_BUTTON_TEXT }, { text: ROUTE_BUTTON_TEXT }]
      ]
    });

    await sendText(bot, REPLACE_ROUTE_STEP_BUTTON_TEXT);

    expect(replies.at(-1)?.text).toContain("Сначала нужно собрать маршрут");

    vi.useRealTimers();
  });

	it("rebuilds a route from the same route start", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T09:00:00Z"));
    const { bot, replies } = createHarness();

    await sendText(bot, "Дубининская 59");
    await sendText(bot, ROUTE_BUTTON_TEXT);
    await sendText(bot, "3 часа");
    const firstRoute = replies.at(-1)?.text;

    await sendText(bot, REBUILD_ROUTE_BUTTON_TEXT);

    expect(replies.at(-1)?.text).toContain("Ищу рядом с: Москва, Дубининская улица, 59");
    expect(replies.at(-1)?.text).not.toBe(firstRoute);
	    expect(replies.at(-1)?.replyMarkup).toMatchObject({
	      keyboard: [
	        [{ text: REBUILD_ROUTE_BUTTON_TEXT }, { text: REPLACE_ROUTE_STEP_BUTTON_TEXT }],
	        [{ text: FEEDBACK_BUTTON_TEXT }, { text: ROUTE_BUTTON_TEXT }]
	      ]
	    });

    vi.useRealTimers();
  });

	it("keeps the previous route if rebuild cannot find a better route", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T09:00:00Z"));
    const { bot, replies, setNoRoute } = createHarness();

    await sendText(bot, "Дубининская 59");
    await sendText(bot, ROUTE_BUTTON_TEXT);
    await sendText(bot, "3 часа");
    expect(replies.at(-1)?.text).toContain("Собрал маршрут");

    setNoRoute(true);
    await sendText(bot, REBUILD_ROUTE_BUTTON_TEXT);

    expect(replies.at(-1)?.text).toContain("Не смог пересобрать маршрут");
    expect(replies.at(-1)?.text).toContain("Оставил предыдущий вариант");
	    expect(replies.at(-1)?.replyMarkup).toMatchObject({
	      keyboard: [
	        [{ text: REBUILD_ROUTE_BUTTON_TEXT }, { text: REPLACE_ROUTE_STEP_BUTTON_TEXT }],
	        [{ text: FEEDBACK_BUTTON_TEXT }, { text: ROUTE_BUTTON_TEXT }]
	      ]
	    });

    vi.useRealTimers();
  });

	it("replaces a selected route step and keeps route result context", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T09:00:00Z"));
    const { bot, replies } = createHarness();

    await sendText(bot, "Дубининская 59");
    await sendText(bot, ROUTE_BUTTON_TEXT);
    await sendText(bot, "3 часа");
    const originalRouteText = replies.at(-1)?.text ?? "";

    await sendText(bot, REPLACE_ROUTE_STEP_BUTTON_TEXT);
    expect(replies.at(-1)?.text).toBe("Какой пункт заменить?");
    await sendText(bot, "3. restaurant рядом");

    expect(replies.at(-1)?.text).toContain("Заменил пункт 3.");
    expect(replies.at(-1)?.text).toContain("Было:");
    expect(replies.at(-1)?.text).toContain("Стало:");
    expect(replies.at(-1)?.text).toContain("Маршрут теперь примерно на");
    expect(replies.at(-1)?.text).not.toBe(originalRouteText);
	    expect(replies.at(-1)?.replyMarkup).toMatchObject({
	      keyboard: [
	        [{ text: REBUILD_ROUTE_BUTTON_TEXT }, { text: REPLACE_ROUTE_STEP_BUTTON_TEXT }],
	        [{ text: FEEDBACK_BUTTON_TEXT }, { text: ROUTE_BUTTON_TEXT }]
	      ]
	    });

    vi.useRealTimers();
  });

  it("offers fallback actions when a selected route step cannot be replaced", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T09:00:00Z"));
    const { bot, replies } = createHarness({ noReplacement: true });

    await sendText(bot, "Дубининская 59");
    await sendText(bot, ROUTE_BUTTON_TEXT);
    await sendText(bot, "3 часа");
    await sendText(bot, REPLACE_ROUTE_STEP_BUTTON_TEXT);
    await sendText(bot, "3. restaurant рядом");

    expect(replies.at(-1)?.text).toContain("Не смог заменить только этот пункт");
    expect(replies.at(-1)?.replyMarkup).toMatchObject({
      keyboard: [
        [{ text: REBUILD_WITHOUT_ROUTE_STEP_BUTTON_TEXT }],
        [{ text: KEEP_ROUTE_BUTTON_TEXT }]
      ]
    });

    vi.useRealTimers();
  });

	it("keeps the existing route when replacement fallback is declined", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T09:00:00Z"));
    const { bot, replies } = createHarness({ noReplacement: true });

    await sendText(bot, "Дубининская 59");
    await sendText(bot, ROUTE_BUTTON_TEXT);
    await sendText(bot, "3 часа");
    await sendText(bot, REPLACE_ROUTE_STEP_BUTTON_TEXT);
    await sendText(bot, "3. restaurant рядом");
    await sendText(bot, KEEP_ROUTE_BUTTON_TEXT);

    expect(replies.at(-1)?.text).toContain("Ок, оставляем маршрут как есть");
	    expect(replies.at(-1)?.replyMarkup).toMatchObject({
	      keyboard: [
	        [{ text: REBUILD_ROUTE_BUTTON_TEXT }, { text: REPLACE_ROUTE_STEP_BUTTON_TEXT }],
	        [{ text: FEEDBACK_BUTTON_TEXT }, { text: ROUTE_BUTTON_TEXT }]
	      ]
	    });

    vi.useRealTimers();
  });

	it("rebuilds without the failed replacement place when fallback is accepted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T09:00:00Z"));
    const { bot, replies } = createHarness({ noReplacement: true });

    await sendText(bot, "Дубининская 59");
    await sendText(bot, ROUTE_BUTTON_TEXT);
    await sendText(bot, "3 часа");
    await sendText(bot, REPLACE_ROUTE_STEP_BUTTON_TEXT);
    await sendText(bot, "3. restaurant рядом");
    await sendText(bot, REBUILD_WITHOUT_ROUTE_STEP_BUTTON_TEXT);

    expect(replies.at(-1)?.text).toContain("Собрал маршрут");
    expect(replies.at(-1)?.text).not.toContain("restaurant рядом");
	    expect(replies.at(-1)?.replyMarkup).toMatchObject({
	      keyboard: [
	        [{ text: REBUILD_ROUTE_BUTTON_TEXT }, { text: REPLACE_ROUTE_STEP_BUTTON_TEXT }],
	        [{ text: FEEDBACK_BUTTON_TEXT }, { text: ROUTE_BUTTON_TEXT }]
	      ]
	    });

    vi.useRealTimers();
  });

	it("does not geocode arbitrary text while waiting for a route replacement choice", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-24T09:00:00Z"));
    const { bot, replies, locationResolver } = createHarness();

    await sendText(bot, "Дубининская 59");
    await sendText(bot, ROUTE_BUTTON_TEXT);
    await sendText(bot, "3 часа");
    await sendText(bot, REPLACE_ROUTE_STEP_BUTTON_TEXT);
    const resolveCallsBefore = locationResolver.resolve.mock.calls.length;

    await sendText(bot, "Тверская 7");

    expect(locationResolver.resolve).toHaveBeenCalledTimes(resolveCallsBefore);
    expect(replies.at(-1)?.text).toContain("Выбери пункт маршрута кнопкой или нажми «Назад»");

    await sendText(bot, BACK_BUTTON_TEXT);

    expect(replies.at(-1)?.text).toContain("Ок, оставляем маршрут как есть");
	    expect(replies.at(-1)?.replyMarkup).toMatchObject({
	      keyboard: [
	        [{ text: REBUILD_ROUTE_BUTTON_TEXT }, { text: REPLACE_ROUTE_STEP_BUTTON_TEXT }],
	        [{ text: FEEDBACK_BUTTON_TEXT }, { text: ROUTE_BUTTON_TEXT }]
	      ]
	    });

    vi.useRealTimers();
  });
});

function createHarness(options: HarnessOptions = {}) {
  const replies: Array<{
    text: string;
    replyMarkup?: unknown;
  }> = [];
  const apiCalls: ApiCall[] = [];
  const nearbyCalls: NearbyCall[] = [];
  let nextGeneratedPlaceId = 1000;
  let replacementMode = false;
  let noRoute = Boolean(options.noRoute);

  const repo = {
    findNearby: vi.fn((query: NearbyCall) => {
      nearbyCalls.push(query);
      if (query.radiusMeters !== undefined && query.radiusMeters < 1500) {
        return createRouteSuggestions(query, nextGeneratedPlaceId, {
          noRoute,
          noReplacement: Boolean(options.noReplacement && replacementMode)
        });
      }

      const categorySlug = query.categorySlug ?? "restaurant";
      if (options.emptyCategorySlugs?.includes(categorySlug)) {
        return [];
      }
      if (categorySlug === "bar") {
        return [
          makeSuggestion({
            placeId: 201,
            name: "Настоящий бар",
            slug: "bar",
            categoryName: "Бар",
            lat: query.lat + 0.001,
            lon: query.lon + 0.001,
            distanceMeters: 120
          })
        ];
      }
      if (categorySlug === "pub") {
        return [
          makeSuggestion({
            placeId: 202,
            name: "Ресторан с пабом",
            slug: "restaurant",
            categoryName: "Ресторан",
            lat: query.lat + 0.0002,
            lon: query.lon + 0.0002,
            distanceMeters: 30,
            secondaryCategories: [{ slug: "pub", name: "Паб" }]
          })
        ];
      }
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
          lat: query.lat + 0.001,
          lon: query.lon + 0.001,
          distanceMeters: 120
        }),
        makeSuggestion({
          placeId: nextGeneratedPlaceId++,
          name: `${categorySlug} ещё`,
          slug: categorySlug,
          lat: query.lat + 0.0015,
          lon: query.lon + 0.0015,
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
    resolve: vi.fn(async (query: string) => {
      if (options.resolverThrows) {
        throw new Error("resolver failed");
      }

      return options.resolverResult ?? {
        status: "ok" as const,
        confidence: "good" as const,
        kind: "exact_address" as const,
        query,
        label: "Москва, Дубининская улица, 59",
        lat: 55.729,
        lon: 37.636
      };
    })
  } as unknown as LocationResolver & {
    resolve: ReturnType<typeof vi.fn>;
  };

	  const logger = makeLogger();
	  const bot = createCityDateBot({
	    config: makeConfig(options),
	    repo,
	    locationResolver,
	    logger
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
      const text = String((payload as { text: string }).text);
      if (text === "Какой пункт заменить?") {
        replacementMode = true;
      }
      if (text.includes("Не смог заменить только этот пункт")) {
        replacementMode = false;
      }
      replies.push({
        text,
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
	    logger,
	    nearbyCalls,
    replies,
    repo,
    setNoRoute: (value: boolean) => {
      noRoute = value;
    }
  };
}

function createRouteSuggestions(
  options: NearbyCall,
  nextPlaceId: number,
  flags: {
    noRoute: boolean;
    noReplacement: boolean;
  }
): PlaceSuggestion[] {
  if (flags.noRoute) {
    return [];
  }

  const categorySlug = options.categorySlug ?? "restaurant";
  if (flags.noReplacement && categorySlug === "restaurant") {
    return [];
  }

  return [
    makeSuggestion({
      placeId: nextPlaceId + routePlaceOffset(categorySlug),
      name: `${categorySlug} рядом`,
      slug: categorySlug,
      lat: options.lat + 0.001,
      lon: options.lon + 0.001,
      distanceMeters: 120
    }),
    makeSuggestion({
      placeId: nextPlaceId + routePlaceOffset(categorySlug) + 100,
      name: `${categorySlug} замена`,
      slug: categorySlug,
      lat: options.lat + 0.0015,
      lon: options.lon + 0.0015,
      distanceMeters: 160
    })
  ];
}

function routePlaceOffset(slug: string): number {
  return [...slug].reduce((sum, char) => sum + char.charCodeAt(0), 0);
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

async function sendLocation(bot: ReturnType<typeof createCityDateBot>, latitude: number, longitude: number): Promise<void> {
  await bot.handleUpdate({
    update_id: nextUpdateId(),
    message: {
      message_id: nextUpdateId(),
      date: Math.floor(Date.now() / 1000),
      chat: { id: chatId, type: "private", first_name: "Tester" },
      from: { id: userId, is_bot: false, first_name: "Tester" },
      location: {
        latitude,
        longitude
      }
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
  secondaryCategories?: Array<{ slug: string; name: string }>;
}): PlaceSuggestion {
  return {
    placeId: options.placeId,
    name: options.name,
    categories: [
      {
        slug: options.slug,
        name: options.categoryName ?? options.slug,
        isPrimary: true
      },
      ...(options.secondaryCategories ?? []).map((category) => ({
        ...category,
        isPrimary: false
      }))
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

function makeConfig(options: Pick<HarnessOptions, "chatCooldownMs" | "maxTextInputLength"> = {}): AppConfig {
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
    MAX_TEXT_INPUT_LENGTH: options.maxTextInputLength ?? 300,
    CHAT_COOLDOWN_MS: options.chatCooldownMs ?? 0,
    ANALYTICS_ENABLED: false,
    ANALYTICS_SALT: undefined,
    APP_VERSION: "test",
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
