import { Keyboard } from "grammy";

export const LOCATION_BUTTON_TEXT = "📍 Поделиться локацией";
export const MORE_NEARBY_BUTTON_TEXT = "🔁 Ещё вариант";
export const RANDOM_BUTTON_TEXT = "🎲 Полный рандом";
export const ROUTE_BUTTON_TEXT = "🧭 Собрать маршрут";
export const REBUILD_ROUTE_BUTTON_TEXT = "🔁 Пересобрать";
export const REPLACE_ROUTE_STEP_BUTTON_TEXT = "🔄 Заменить пункт";
export const FEEDBACK_BUTTON_TEXT = "👎 Не подходит";
export const REBUILD_WITHOUT_ROUTE_STEP_BUTTON_TEXT = "🔁 Пересобрать без этого места";
export const KEEP_ROUTE_BUTTON_TEXT = "↩️ Оставить как было";
export const BACK_BUTTON_TEXT = "↩️ Назад";
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

export const FEEDBACK_REASON_BUTTONS = [
  "Далеко",
  "Не то",
  "Закрыто",
  "Описание врёт",
  "Маршрут странный",
  "Другое"
] as const;

export type FeedbackReasonButtonText = typeof FEEDBACK_REASON_BUTTONS[number];

export type MainKeyboardOptions = {
  hasResolvedLocation?: boolean;
  resultKind?: "place" | "route" | null;
};

export function mainKeyboard(options: MainKeyboardOptions = {}): Keyboard {
  const keyboard = new Keyboard();

  if (!options.hasResolvedLocation) {
    return keyboard.requestLocation(LOCATION_BUTTON_TEXT).resized();
  }

  if (options.resultKind === "place") {
    return keyboard
      .text(MORE_NEARBY_BUTTON_TEXT)
      .text(FEEDBACK_BUTTON_TEXT)
      .row()
      .text(CHANGE_SCENARIO_BUTTON_TEXT)
      .text(ROUTE_BUTTON_TEXT)
      .resized();
  }

  if (options.resultKind === "route") {
    return keyboard
      .text(REBUILD_ROUTE_BUTTON_TEXT)
      .text(REPLACE_ROUTE_STEP_BUTTON_TEXT)
      .row()
      .text(FEEDBACK_BUTTON_TEXT)
      .text(ROUTE_BUTTON_TEXT)
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

export function routeStepReplacementKeyboard(labels: string[]): Keyboard {
  const keyboard = new Keyboard();

  labels.forEach((label, index) => {
    keyboard.text(`${index + 1}. ${label}`).row();
  });

  return keyboard
    .text(BACK_BUTTON_TEXT)
    .resized()
    .oneTime();
}

export function routeReplacementFallbackKeyboard(): Keyboard {
  return new Keyboard()
    .text(REBUILD_WITHOUT_ROUTE_STEP_BUTTON_TEXT)
    .row()
    .text(KEEP_ROUTE_BUTTON_TEXT)
    .resized()
    .oneTime();
}

export function feedbackReasonKeyboard(): Keyboard {
  const keyboard = new Keyboard();

  FEEDBACK_REASON_BUTTONS.forEach((label, index) => {
    keyboard.text(label);
    if (index % 2 === 1 && index < FEEDBACK_REASON_BUTTONS.length - 1) {
      keyboard.row();
    }
  });

  return keyboard
    .row()
    .text(BACK_BUTTON_TEXT)
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
