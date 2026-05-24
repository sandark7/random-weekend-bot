import type { PlaceSuggestion } from "../shared/types.js";
import {
  buildYandexMapsPointLink,
  buildYandexMapsWalkingRouteLink
} from "../geo/yandexMapsLink.js";

export type FormatSuggestionOptions = {
  origin?: {
    lat: number;
    lon: number;
  };
};

export function formatSuggestion(suggestion: PlaceSuggestion, options: FormatSuggestionOptions = {}): string {
  const primaryCategory =
    suggestion.categories.find((category) => category.isPrimary) ?? suggestion.categories[0] ?? null;
  const lines = [
    `<b>${escapeHtml(suggestion.name)}</b>`,
    primaryCategory ? escapeHtml(primaryCategory.name) : "Место",
    "",
    `🚶 ${formatDistance(suggestion.distanceMeters)}`
  ];

  if (suggestion.address) {
    lines.splice(3, 0, `📍 ${escapeHtml(suggestion.address)}`);
  }

  if (suggestion.openingHoursText) {
    lines.push(`🕒 ${escapeHtml(suggestion.openingHoursText)}`);
  }

  if (suggestion.description) {
    lines.push("", escapeHtml(suggestion.description));
  }

  const yandexMapsLink = options.origin
    ? buildYandexMapsWalkingRouteLink({
        from: options.origin,
        to: { lat: suggestion.lat, lon: suggestion.lon }
      })
    : buildYandexMapsPointLink({ lat: suggestion.lat, lon: suggestion.lon });
  const linkText = options.origin
    ? "Построить пеший маршрут в Яндекс Картах"
    : "Открыть точку в Яндекс Картах";
  lines.push("", `<a href="${escapeHtml(yandexMapsLink)}">${linkText}</a>`);

  return lines.join("\n");
}

export function formatDistance(distanceMeters: number): string {
  if (distanceMeters < 1000) {
    return `${Math.max(distanceMeters, 1)} м`;
  }

  return `${(distanceMeters / 1000).toFixed(1)} км`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
