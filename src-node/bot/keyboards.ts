import { Keyboard } from "grammy";

export const LOCATION_BUTTON_TEXT = "📍 Поделиться локацией";
export const MORE_NEARBY_BUTTON_TEXT = "🔁 Ещё вариант";
export const RANDOM_BUTTON_TEXT = "🎲 Выбери сам";
export const ROUTE_BUTTON_TEXT = "🧭 Собрать маршрут";
export const ROUTE_FROM_RESULT_BUTTON_TEXT = "🧭 Маршрут отсюда";
export const CHANGE_SCENARIO_BUTTON_TEXT = "🔄 Сменить категорию";
export const CONFIRM_LOCATION_BUTTON_TEXT = "Да";
export const CHANGE_LOCATION_BUTTON_TEXT = "Ввести другой адрес";

export const DESIRE_BUTTONS = [
  "🍽 Поесть",
  "☕ Кофе / перекус",
  "🍸 Выпить",
  "🧘 Отдохнуть",
  "🏛 Город",
  "🎯 Досуг"
] as const;

export type DesireButtonText = typeof DESIRE_BUTTONS[number];

export const ROUTE_DURATION_BUTTONS = [
  "2 часа",
  "3 часа",
  "5 часов",
  "8 часов"
] as const;

export type RouteDurationButtonText = typeof ROUTE_DURATION_BUTTONS[number];

export type MainKeyboardOptions = {
  hasResolvedLocation?: boolean;
  showResultActions?: boolean;
};

export function mainKeyboard(options: MainKeyboardOptions = {}): Keyboard {
  const keyboard = new Keyboard();

  if (!options.hasResolvedLocation) {
    return keyboard.requestLocation(LOCATION_BUTTON_TEXT).resized();
  }

  if (options.showResultActions) {
    return keyboard
      .text(MORE_NEARBY_BUTTON_TEXT)
      .text(ROUTE_FROM_RESULT_BUTTON_TEXT)
      .row()
      .text(CHANGE_SCENARIO_BUTTON_TEXT)
      .text(RANDOM_BUTTON_TEXT)
      .resized();
  }

  return keyboard
    .text(DESIRE_BUTTONS[0])
    .text(DESIRE_BUTTONS[1])
    .row()
    .text(DESIRE_BUTTONS[2])
    .text(DESIRE_BUTTONS[3])
    .row()
    .text(DESIRE_BUTTONS[4])
    .text(DESIRE_BUTTONS[5])
    .row()
    .text(RANDOM_BUTTON_TEXT)
    .text(ROUTE_BUTTON_TEXT)
    .resized();
}

export function routeDurationKeyboard(): Keyboard {
  return new Keyboard()
    .text(ROUTE_DURATION_BUTTONS[0])
    .text(ROUTE_DURATION_BUTTONS[1])
    .row()
    .text(ROUTE_DURATION_BUTTONS[2])
    .text(ROUTE_DURATION_BUTTONS[3])
    .resized()
    .oneTime();
}

export function locationConfirmationKeyboard(): Keyboard {
  return new Keyboard()
    .text(CONFIRM_LOCATION_BUTTON_TEXT)
    .row()
    .text(CHANGE_LOCATION_BUTTON_TEXT)
    .row()
    .requestLocation(LOCATION_BUTTON_TEXT)
    .resized()
    .oneTime();
}
