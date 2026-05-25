import { describe, expect, it } from "vitest";
import {
  CHANGE_SCENARIO_BUTTON_TEXT,
  DESIRE_BUTTONS,
  LOCATION_BUTTON_TEXT,
  MORE_NEARBY_BUTTON_TEXT,
  RANDOM_BUTTON_TEXT,
  ROUTE_BUTTON_TEXT,
  ROUTE_FROM_RESULT_BUTTON_TEXT,
  ROUTE_DURATION_BUTTONS,
  locationConfirmationKeyboard,
  mainKeyboard,
  routeDurationKeyboard
} from "../src-node/bot/keyboards.js";

describe("bot keyboards", () => {
  it("keeps the desired scenario button order explicit", () => {
    expect(DESIRE_BUTTONS).toEqual([
      "🍽 Поесть",
      "☕ Кофе / перекус",
      "🍸 Выпить",
      "🧘 Отдохнуть",
      "🏛 Город",
      "🎯 Досуг"
    ]);
  });

  it("uses the choose-it-for-me random button copy", () => {
    expect(RANDOM_BUTTON_TEXT).toBe("🎲 Выбери сам");
  });

  it("shows only location sharing before resolving a location", () => {
    expect(mainKeyboard()).toMatchObject({
      keyboard: [[{ text: LOCATION_BUTTON_TEXT, request_location: true }]]
    });
  });

  it("shows scenario buttons by two after resolving a location", () => {
    expect(mainKeyboard({ hasResolvedLocation: true })).toMatchObject({
      keyboard: [
        [{ text: DESIRE_BUTTONS[0] }, { text: DESIRE_BUTTONS[1] }],
        [{ text: DESIRE_BUTTONS[2] }, { text: DESIRE_BUTTONS[3] }],
        [{ text: DESIRE_BUTTONS[4] }, { text: DESIRE_BUTTONS[5] }],
        [{ text: RANDOM_BUTTON_TEXT }, { text: ROUTE_BUTTON_TEXT }]
      ]
    });
  });

  it("shows result actions by two after a suggestion", () => {
    expect(mainKeyboard({ hasResolvedLocation: true, showResultActions: true })).toMatchObject({
      keyboard: [
        [{ text: MORE_NEARBY_BUTTON_TEXT }, { text: ROUTE_FROM_RESULT_BUTTON_TEXT }],
        [{ text: CHANGE_SCENARIO_BUTTON_TEXT }, { text: RANDOM_BUTTON_TEXT }]
      ]
    });
  });

  it("shows route duration choices by two", () => {
    expect(routeDurationKeyboard()).toMatchObject({
      keyboard: [
        [{ text: ROUTE_DURATION_BUTTONS[0] }, { text: ROUTE_DURATION_BUTTONS[1] }],
        [{ text: ROUTE_DURATION_BUTTONS[2] }, { text: ROUTE_DURATION_BUTTONS[3] }]
      ]
    });
  });

  it("keeps location confirmation actions vertical too", () => {
    expect(locationConfirmationKeyboard()).toMatchObject({
      keyboard: [
        [{ text: "Да" }],
        [{ text: "Ввести другой адрес" }],
        [{ text: LOCATION_BUTTON_TEXT, request_location: true }]
      ]
    });
  });
});
