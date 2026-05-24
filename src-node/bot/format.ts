import type { PlaceSuggestion } from "../shared/types.js";
import { getCurrentOpeningWindow } from "../shared/openingHours.js";
import {
  buildYandexMapsPointLink,
  buildYandexMapsWalkingRouteLink
} from "../geo/yandexMapsLink.js";

const MAX_DESCRIPTION_LENGTH = 240;
const SECONDARY_CATEGORY_PRIORITY = [
  "fine_dining",
  "breakfast",
  "quick_bite",
  "coffee",
  "cocktail_bar",
  "wine_bar",
  "pub",
  "bar",
  "activity",
  "bathhouse",
  "viewpoint",
  "landmark",
  "park",
  "culture"
];

export type FormatSuggestionOptions = {
  origin?: {
    lat: number;
    lon: number;
  };
  now?: Date;
};

export function formatSuggestion(suggestion: PlaceSuggestion, options: FormatSuggestionOptions = {}): string {
  const categoryLabel = formatCategoryLabel(suggestion.categories);
  const lines = [
    `<b>${escapeHtml(suggestion.name)}</b>`,
    categoryLabel ? escapeHtml(categoryLabel) : "Место"
  ];

  const description = formatDescription(suggestion.description);
  if (description) {
    lines.push("", escapeHtml(description));
  }

  const yandexMapsLink = options.origin
    ? buildYandexMapsWalkingRouteLink({
        from: options.origin,
        to: { lat: suggestion.lat, lon: suggestion.lon }
      })
    : buildYandexMapsPointLink({ lat: suggestion.lat, lon: suggestion.lon });

  const address = suggestion.address
    ? `<a href="${escapeHtml(yandexMapsLink)}">${escapeHtml(suggestion.address)}</a>`
    : `<a href="${escapeHtml(yandexMapsLink)}">Открыть в Яндекс Картах</a>`;
  lines.push("", `📍 ${address}`);

  if (options.origin) {
    lines.push(`🚶 ${formatDistance(suggestion.distanceMeters)}`);
  }

  const openingStatus = formatOpeningStatus(suggestion, options.now);
  if (openingStatus) {
    lines.push(`🕒 ${escapeHtml(openingStatus)}`);
  }

  return lines.join("\n");
}

function formatCategoryLabel(categories: PlaceSuggestion["categories"]): string | null {
  const primary = categories.find((category) => category.isPrimary) ?? categories[0];
  if (!primary?.name.trim()) {
    return null;
  }

  const secondary = categories
    .filter((category) => category.slug !== primary.slug && category.name.trim() !== primary.name.trim())
    .sort((left, right) => secondaryCategoryRank(left.slug) - secondaryCategoryRank(right.slug))[0];

  const labels = [primary.name.trim(), secondary?.name.trim()].filter((label): label is string => Boolean(label));
  return [...new Set(labels)].slice(0, 2).join(" · ");
}

function secondaryCategoryRank(slug: string): number {
  const index = SECONDARY_CATEGORY_PRIORITY.indexOf(slug);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export function formatDistance(distanceMeters: number): string {
  const walkingMinutes = Math.max(1, Math.round(distanceMeters / 80));
  const distance = distanceMeters < 1000
    ? `${Math.max(distanceMeters, 1)} м`
    : `${(distanceMeters / 1000).toFixed(1)} км`;

  return `${distance} · ~${walkingMinutes} мин`;
}

function formatOpeningStatus(suggestion: PlaceSuggestion, now = new Date()): string | null {
  const window = getCurrentOpeningWindow(suggestion.openingHoursJson, now);
  if (!window) {
    return null;
  }

  if (window.allDay) {
    return "Открыто круглосуточно";
  }

  return `Открыто до ${window.closesAt}`;
}

function formatDescription(description: string | null): string | null {
  if (!description) {
    return null;
  }

  const normalized = description.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  if (normalized.length <= MAX_DESCRIPTION_LENGTH && !normalized.endsWith("…")) {
    return normalized;
  }

  const withoutDanglingEllipsis = normalized.replace(/…+$/, "").trim();
  const sentenceMatch = withoutDanglingEllipsis
    .slice(0, MAX_DESCRIPTION_LENGTH)
    .match(/^(.{80,}?[.!?])(?:\s|$)/);

  if (sentenceMatch) {
    return sentenceMatch[1];
  }

  const truncated = withoutDanglingEllipsis.slice(0, MAX_DESCRIPTION_LENGTH + 1);
  const breakAt = Math.max(
    truncated.lastIndexOf("."),
    truncated.lastIndexOf("!"),
    truncated.lastIndexOf("?"),
    truncated.lastIndexOf(";"),
    truncated.lastIndexOf(",")
  );
  const cleanText =
    breakAt >= 80 ? truncated.slice(0, breakAt).trim() : truncated.slice(0, MAX_DESCRIPTION_LENGTH).trim();

  return `${cleanText.replace(/[.,;:!?-]+$/, "")}…`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
