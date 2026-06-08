import { describe, expect, it } from "vitest";
import { formatSuggestion } from "../src-node/bot/format.js";
import type { PlaceSuggestion } from "../src-node/shared/types.js";

describe("formatSuggestion", () => {
  it("does not show distance for a random place without an origin", () => {
    const message = formatSuggestion(makeSuggestion(), {
      now: new Date("2026-05-23T09:00:00Z")
    });

    expect(message).not.toContain("🚶");
    expect(message).toContain("🕒 Открыто до 22:00");
    expect(message).not.toContain("Пн-Вс");
    expect(message).toContain('📍 <a href="https://yandex.ru/maps/?ll=37.6465%2C55.7605');
    expect(message).toContain(">Покровка, 17</a>");
    expect(message).not.toContain("Открыть точку в Яндекс Картах");
  });

  it("keeps walking distance and puts the route link on the address when an origin is known", () => {
    const message = formatSuggestion(makeSuggestion(), {
      origin: { lat: 55.75, lon: 37.61 },
      now: new Date("2026-05-23T09:00:00Z")
    });

    expect(message).toContain("🚶 420 м · ~8 мин");
    expect(message).toContain("rtext=55.75%2C37.61%7E55.7605%2C37.6465");
    expect(message).toContain(">Покровка, 17</a>");
    expect(message).not.toContain("Построить пеший маршрут в Яндекс Картах");
  });

  it("puts the description right below the title and category", () => {
    const message = formatSuggestion(makeSuggestion(), {
      now: new Date("2026-05-23T09:00:00Z")
    });

    expect(message.split("\n").slice(0, 4)).toEqual([
      "<b>Тестовое место</b>",
      "Ресторан",
      "",
      "Описание"
    ]);
  });

  it("shows primary category and at most one secondary category", () => {
    const message = formatSuggestion(
      makeSuggestion({
        categories: [
          { slug: "restaurant", name: "Ресторан", isPrimary: true },
          { slug: "breakfast", name: "Завтраки", isPrimary: false },
          { slug: "wine_bar", name: "Вино", isPrimary: false }
        ]
      }),
      {
        now: new Date("2026-05-23T09:00:00Z")
      }
    );

    expect(message.split("\n")[1]).toBe("Ресторан · Завтраки");
  });

  it("prefers more specific secondary categories in the label", () => {
    const message = formatSuggestion(
      makeSuggestion({
        categories: [
          { slug: "restaurant", name: "Ресторан", isPrimary: true },
          { slug: "bar", name: "Бар", isPrimary: false },
          { slug: "pub", name: "Паб", isPrimary: false }
        ]
      }),
      {
        now: new Date("2026-05-23T09:00:00Z")
      }
    );

    expect(message.split("\n")[1]).toBe("Ресторан · Паб");
  });

  it("shows 00:00-23:59 places as open all day", () => {
    const message = formatSuggestion(
      makeSuggestion({
        openingHoursJson: {
          timezone: "Europe/Moscow",
          weekly: {
            sat: [{ from: "00:00", to: "23:59" }]
          }
        }
      }),
      {
        now: new Date("2026-05-23T20:59:00Z")
      }
    );

    expect(message).toContain("🕒 Открыто круглосуточно");
    expect(message).not.toContain("Открыто до 23:59");
  });

  it("keeps long scraped descriptions readable", () => {
    const message = formatSuggestion(
      makeSuggestion({
        description:
          "Новое укромное бистро на Патриарших с кухней от петербургского шефа Александра Пименова — гимн датскому модернизму. Светлые теплые тона, натуральные материалы: лен, керамика, дерево, яркие декоративные акценты то тут, то там. Пименов, стажировавшийся в Копенгагене, поселил тут…"
      }),
      {
        now: new Date("2026-05-23T09:00:00Z")
      }
    );

    expect(message).toContain(
      "Новое укромное бистро на Патриарших с кухней от петербургского шефа Александра Пименова — гимн датскому модернизму."
    );
    expect(message).not.toContain("поселил тут…");
  });
});

function makeSuggestion(overrides: Partial<PlaceSuggestion> = {}): PlaceSuggestion {
  return {
    placeId: 1,
    name: "Тестовое место",
    categories: [{ slug: "restaurant", name: "Ресторан", isPrimary: true }],
    description: "Описание",
    address: "Покровка, 17",
    lat: 55.7605,
    lon: 37.6465,
    citySlug: "moscow",
    distanceMeters: 420,
    openingHoursText: "Пн-Вс 10:00-22:00",
    openingHoursJson: {
      timezone: "Europe/Moscow",
      weekly: {
        sat: [{ from: "10:00", to: "22:00" }]
      }
    },
    ...overrides
  };
}
