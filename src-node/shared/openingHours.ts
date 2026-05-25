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

export type CurrentOpeningWindow = {
  closesAt: string;
  closesNextDay: boolean;
  allDay: boolean;
};

export function parseOpeningHoursJson(value: unknown): OpeningHoursJson | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return openingHoursJsonSchema.parse(parsed);
}

export function getCurrentOpeningWindow(
  hours: OpeningHoursJson | null,
  now = new Date()
): CurrentOpeningWindow | null {
  if (!hours) {
    return null;
  }

  const { weekday, minutes } = getMoscowDateParts(now);
  const previousWeekday = weekdays[(weekdays.indexOf(weekday) + 6) % 7];
  const sameDayInterval = findSameDayOpenInterval(hours.weekly[weekday] ?? [], minutes);
  if (sameDayInterval) {
    return {
      closesAt: sameDayInterval.to,
      closesNextDay: sameDayInterval.next_day === true,
      allDay: isAllDayInterval(sameDayInterval)
    };
  }

  const previousDayInterval = findPreviousDayOvernightInterval(
    hours.weekly[previousWeekday] ?? [],
    minutes
  );
  if (previousDayInterval) {
    return {
      closesAt: previousDayInterval.to,
      closesNextDay: false,
      allDay: isAllDayInterval(previousDayInterval)
    };
  }

  return null;
}

export function isOpenNow(hours: OpeningHoursJson | null, now = new Date()): boolean | null {
  if (!hours) {
    return null;
  }

  return getCurrentOpeningWindow(hours, now) !== null;
}

export function isOpenForDuration(
  hours: OpeningHoursJson | null,
  now = new Date(),
  durationMinutes: number
): boolean | null {
  if (!hours) {
    return null;
  }

  const window = getCurrentOpeningWindow(hours, now);
  if (!window) {
    return false;
  }

  if (window.allDay) {
    return true;
  }

  const { minutes } = getMoscowDateParts(now);
  let closesAtMinutes = toMinutes(window.closesAt);
  if (window.closesNextDay || closesAtMinutes <= minutes) {
    closesAtMinutes += 24 * 60;
  }

  return closesAtMinutes - minutes >= durationMinutes;
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

function findSameDayOpenInterval(
  intervals: OpeningHoursInterval[],
  minutes: number
): OpeningHoursInterval | null {
  return intervals.find((interval) => {
    if (isAllDayInterval(interval)) {
      return true;
    }

    const from = toMinutes(interval.from);
    const to = toMinutes(interval.to);

    if (interval.next_day) {
      return minutes >= from;
    }

    return minutes >= from && minutes < to;
  }) ?? null;
}

function findPreviousDayOvernightInterval(
  intervals: OpeningHoursInterval[],
  minutes: number
): OpeningHoursInterval | null {
  return intervals.find((interval) => {
    const from = toMinutes(interval.from);
    const to = toMinutes(interval.to);
    return interval.next_day === true && minutes < to;
  }) ?? null;
}

function isAllDayInterval(interval: OpeningHoursInterval): boolean {
  return (
    (interval.from === "00:00" && interval.to === "00:00" && interval.next_day === true) ||
    (interval.from === "00:00" && interval.to === "23:59" && interval.next_day !== true)
  );
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}
