import { z } from "zod";
import { openingHoursJsonSchema, parseOpeningHoursJson } from "../shared/openingHours.js";
import type { OpeningHoursJson } from "../shared/types.js";

const nonEmptyString = z.string().trim().min(1);
const slugString = z.string().trim().min(1).regex(/^[a-z0-9_:-]+$/);
const nullableText = z.preprocess((value) => emptyToNull(value), z.string().trim().min(1).nullable());
const nullableUrl = z.preprocess((value) => emptyToNull(value), z.string().url().nullable());
const nullableNumber = z.preprocess((value) => {
  const normalized = emptyToNull(value);
  return normalized === null ? null : Number(normalized);
}, z.number().nullable());
const csvBoolean = z.preprocess((value) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "") {
    return true;
  }
  if (["1", "true", "yes", "y", "да"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "нет"].includes(normalized)) {
    return false;
  }
  return value;
}, z.boolean());

export const categoryCsvRowSchema = z.object({
  slug: slugString,
  name: nonEmptyString
});

export const placeCsvRowSchema = z
  .object({
    external_id: nonEmptyString,
    display_name: nonEmptyString,
    description: nullableText,
    address: nullableText,
    latitude: nullableNumber.pipe(z.number().min(-90).max(90).nullable()),
    longitude: nullableNumber.pipe(z.number().min(-180).max(180).nullable()),
    opening_hours_text: nullableText,
    opening_hours_json: nullableText,
    source: nullableText,
    source_url: nullableUrl,
    is_active: csvBoolean
  })
  .superRefine((row, ctx) => {
    const hasLatitude = row.latitude !== null;
    const hasLongitude = row.longitude !== null;
    if (hasLatitude !== hasLongitude) {
      ctx.addIssue({
        code: "custom",
        path: hasLatitude ? ["longitude"] : ["latitude"],
        message: "latitude and longitude must be both filled or both empty"
      });
    }

    let openingHoursJson: OpeningHoursJson | null = null;
    if (row.opening_hours_json) {
      try {
        openingHoursJson = parseOpeningHoursCell(row.opening_hours_json);
      } catch (error) {
        ctx.addIssue({
          code: "custom",
          path: ["opening_hours_json"],
          message: error instanceof Error ? error.message : "opening_hours_json is invalid"
        });
      }
    }

    if (
      row.opening_hours_text &&
      openingHoursJson &&
      saysEveryDayAllDay(row.opening_hours_text) &&
      !isEveryDayAllDay(openingHoursJson)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["opening_hours_json"],
        message: "opening_hours_text says 24/7 but opening_hours_json is not all-day"
      });
    }
  });

export const placeCategoryCsvRowSchema = z.object({
  place_external_id: nonEmptyString,
  category_slug: slugString,
  is_primary: csvBoolean
});

export type CategoryCsvRow = z.infer<typeof categoryCsvRowSchema>;
export type PlaceCsvRow = z.infer<typeof placeCsvRowSchema>;
export type PlaceCategoryCsvRow = z.infer<typeof placeCategoryCsvRowSchema>;

export function parseOpeningHoursCell(value: string | null): OpeningHoursJson | null {
  if (!value) {
    return null;
  }

  const parsed = parseOpeningHoursJson(value);
  return openingHoursJsonSchema.parse(parsed);
}

function emptyToNull(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = String(value).trim();
  return trimmed === "" ? null : trimmed;
}

function saysEveryDayAllDay(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, " ");
  const allDay = "(?:круглосуточно|24\\s*\\/\\s*7|24\\s*часа?)";

  return (
    new RegExp(`^(?:ежедневно\\s+)?${allDay}\\.?$`, "i").test(normalized) ||
    new RegExp(`^пн\\s*[-–]\\s*вс\\s+${allDay}\\.?$`, "i").test(normalized)
  );
}

function isEveryDayAllDay(hours: OpeningHoursJson): boolean {
  const weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
  return weekdays.every((day) => {
    const intervals = hours.weekly[day] ?? [];
    return intervals.some((interval) => (
      interval.from === "00:00" &&
      interval.to === "00:00" &&
      interval.next_day === true
    ));
  });
}
