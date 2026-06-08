import { escapeHtml, formatSuggestion } from "../bot/format.js";
import { buildYandexMapsWalkingMultiPointRouteLink } from "../geo/yandexMapsLink.js";
import type { RouteStep } from "./routeBuilder.js";
import { routeDuration } from "./routeRules.js";
import type { RouteDurationHours } from "./scenarios.js";

export function formatRoute(durationHours: RouteDurationHours, locationLabel: string, route: RouteStep[]): string {
  const routeMapLink = buildRouteMapLink(route);
  const lines = [
    `<b>${escapeHtml(`Собрал маршрут примерно на ${formatRouteDuration(routeDuration(route))}`)}</b>`,
    escapeHtml(formatRouteStartIntro(locationLabel))
  ];

  if (routeMapLink) {
    lines.push(`<a href="${escapeHtml(routeMapLink)}">🗺 Открыть маршрут в Яндекс Картах</a>`);
  }

  lines.push("");

  route.forEach((step, index) => {
    if (index > 0) {
      lines.push("");
    }
    lines.push(`<b>${index + 1}. ${escapeHtml(step.scenario.label)}</b>`);
    lines.push(formatSuggestion(step.suggestion, { origin: step.origin, now: step.arrival }));
  });

  return lines.join("\n");
}

function buildRouteMapLink(route: RouteStep[]): string | null {
  const firstStep = route[0];
  if (!firstStep) {
    return null;
  }

  return buildYandexMapsWalkingMultiPointRouteLink({
    points: [
      firstStep.origin,
      ...route.map((step) => ({
        lat: step.suggestion.lat,
        lon: step.suggestion.lon
      }))
    ]
  });
}

export function formatLocationIntro(label: string): string {
  if (label === "вашей геолокацией" || label === "вашей геолокации") {
    return "Ищу рядом с вашей геолокацией";
  }

  if (label === "координатами" || label === "координат") {
    return "Ищу рядом с координатами";
  }

  return `Ищу рядом с: ${label}`;
}

function formatRouteStartIntro(label: string): string {
  if (label === "вашей геолокацией" || label === "вашей геолокации") {
    return "Стартуем от вашей геолокации";
  }

  if (label === "координатами" || label === "координат") {
    return "Стартуем от координат";
  }

  return `Стартуем от: ${label}`;
}

export function formatRouteDuration(durationMinutes: number): string {
  const roundedMinutes = Math.max(15, Math.round(durationMinutes / 5) * 5);
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours} ч ${minutes} мин`;
  }

  if (hours > 0) {
    return `${hours} ч`;
  }

  return `${minutes} мин`;
}
