import { Keyboard } from "grammy";

export const LOCATION_BUTTON_TEXT = "📍 Поделиться локацией с телефона";
export const MANUAL_LOCATION_BUTTON_TEXT = "🧭 Ввести адрес";
export const RANDOM_BUTTON_TEXT = "🎲 Случайное место";
export const CONFIRM_LOCATION_BUTTON_TEXT = "Да";
export const CHANGE_LOCATION_BUTTON_TEXT = "Ввести другой адрес";

export function mainKeyboard(): Keyboard {
  return new Keyboard()
    .requestLocation(LOCATION_BUTTON_TEXT)
    .text(MANUAL_LOCATION_BUTTON_TEXT)
    .row()
    .text(RANDOM_BUTTON_TEXT)
    .resized();
}

export function locationConfirmationKeyboard(): Keyboard {
  return new Keyboard()
    .text(CONFIRM_LOCATION_BUTTON_TEXT)
    .text(CHANGE_LOCATION_BUTTON_TEXT)
    .row()
    .requestLocation(LOCATION_BUTTON_TEXT)
    .resized()
    .oneTime();
}
