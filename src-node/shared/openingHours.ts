import { z } from "zod";
import type { OpeningHoursInterval, OpeningHoursJson, Weekday } from "./types.js";

export const weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const satisfies Weekday[];

const weekdaySchema = z.enum(weekdays);
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const openingHoursIntervalSchema = z.object({
  from: timeSchema,
  to: timeSchema,
  next_day: z.boolean().optional()
}).superRefine((interval, ctx) => {
  const from = toMinutes(interval.from);
  const to = toMinutes(interval.to);
  const crossesMidnight = to <= from;

  if (crossesMidnight && interval.next_day !== true) {
    ctx.addIssue({
      code: "custom",
      message: "Overnight intervals must set next_day=true"
    });
  }

  if (!crossesMidnight && interval.next_day === true) {
    ctx.addIssue({
      code: "custom",
      message: "next_day=true is only valid for intervals crossing midnight"
    });
  }
});

export const openingHoursJsonSchema = z.object({
  timezone: z.literal("Europe/Moscow"),
  weekly: z
    .object({
      mon: z.array(openingHoursIntervalSchema).optional(),
      tue: z.array(openingHoursIntervalSchema).optional(),
      wed: z.array(openingHoursIntervalSchema).optional(),
      thu: z.array(openingHoursIntervalSchema).optional(),
      fri: z.array(openingHoursIntervalSchema).optional(),
      sat: z.array(openingHoursIntervalSchema).optional(),
      sun: z.array(openingHoursIntervalSchema).optional()
    })
    .strict()
});

const intlWeekdayMap: Record<string, Weekday> = {
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
  Sun: "sun"
};

export function parseOpeningHoursJson(value: unknown): OpeningHoursJson | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return openingHoursJsonSchema.parse(parsed);
}

export function isOpenNow(hours: OpeningHoursJson | null, now = new Date()): boolean | null {
  if (!hours) {
    return null;
  }

  const { weekday, minutes } = getMoscowDateParts(now);
  const previousWeekday = weekdays[(weekdays.indexOf(weekday) + 6) % 7];

  return (
    isOpenInSameDayInterval(hours.weekly[weekday] ?? [], minutes) ||
    isOpenInPreviousDayOvernightInterval(hours.weekly[previousWeekday] ?? [], minutes)
  );
}

function getMoscowDateParts(date: Date): { weekday: Weekday; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Moscow",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const weekdayPart = parts.find((part) => part.type === "weekday")?.value;
  const hourPart = parts.find((part) => part.type === "hour")?.value;
  const minutePart = parts.find((part) => part.type === "minute")?.value;

  if (!weekdayPart || !hourPart || !minutePart || !(weekdayPart in intlWeekdayMap)) {
    throw new Error(`Could not format Moscow time parts for ${date.toISOString()}`);
  }

  return {
    weekday: intlWeekdayMap[weekdayPart],
    minutes: Number(hourPart) * 60 + Number(minutePart)
  };
}

function isOpenInSameDayInterval(intervals: OpeningHoursInterval[], minutes: number): boolean {
  return intervals.some((interval) => {
    const from = toMinutes(interval.from);
    const to = toMinutes(interval.to);

    if (interval.next_day) {
      return minutes >= from;
    }

    return minutes >= from && minutes < to;
  });
}

function isOpenInPreviousDayOvernightInterval(intervals: OpeningHoursInterval[], minutes: number): boolean {
  return intervals.some((interval) => {
    const from = toMinutes(interval.from);
    const to = toMinutes(interval.to);
    return interval.next_day === true && minutes < to;
  });
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}
