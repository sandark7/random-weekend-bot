import { escapeHtml, formatSuggestion } from "../bot/format.js";
import type { RouteStep } from "./routeBuilder.js";
import { routeDuration } from "./routeRules.js";
import type { RouteDurationHours } from "./scenarios.js";

export function formatRoute(durationHours: RouteDurationHours, locationLabel: string, route: RouteStep[]): string {
  const lines = [
    `<b>${escapeHtml(`Собрал маршрут примерно на ${formatRouteDuration(routeDuration(route))}`)}</b>`,
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

export function formatLocationIntro(label: string): string {
  if (label === "вашей геолокации" || label === "координат") {
    return `Стартуем от ${label}`;
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
