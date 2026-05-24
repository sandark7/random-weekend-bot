import { describe, expect, it } from "vitest";
import {
  getCurrentOpeningWindow,
  isOpenNow,
  parseOpeningHoursJson
} from "../src-node/shared/openingHours.js";
import type { OpeningHoursJson } from "../src-node/shared/types.js";

describe("opening hours", () => {
  it("returns null when hours are unknown", () => {
    expect(isOpenNow(null, new Date("2026-05-23T12:00:00Z"))).toBeNull();
  });

  it("handles same-day intervals in Moscow time", () => {
    const hours: OpeningHoursJson = {
      timezone: "Europe/Moscow",
      weekly: {
        sat: [{ from: "10:00", to: "22:00" }]
      }
    };

    expect(isOpenNow(hours, new Date("2026-05-23T09:00:00Z"))).toBe(true);
    expect(isOpenNow(hours, new Date("2026-05-23T20:00:00Z"))).toBe(false);
  });

  it("returns the current same-day closing time", () => {
    const hours: OpeningHoursJson = {
      timezone: "Europe/Moscow",
      weekly: {
        sat: [{ from: "10:00", to: "22:00" }]
      }
    };

    expect(getCurrentOpeningWindow(hours, new Date("2026-05-23T09:00:00Z"))).toEqual({
      closesAt: "22:00",
      closesNextDay: false,
      allDay: false
    });
  });

  it("handles overnight intervals from the previous day", () => {
    const hours: OpeningHoursJson = {
      timezone: "Europe/Moscow",
      weekly: {
        fri: [{ from: "18:00", to: "03:00", next_day: true }]
      }
    };

    expect(isOpenNow(hours, new Date("2026-05-22T23:30:00Z"))).toBe(true);
  });

  it("returns the closing time for previous-day overnight intervals", () => {
    const hours: OpeningHoursJson = {
      timezone: "Europe/Moscow",
      weekly: {
        fri: [{ from: "18:00", to: "03:00", next_day: true }]
      }
    };

    expect(getCurrentOpeningWindow(hours, new Date("2026-05-22T23:30:00Z"))).toEqual({
      closesAt: "03:00",
      closesNextDay: false,
      allDay: false
    });
  });

  it("marks all-day intervals", () => {
    const hours: OpeningHoursJson = {
      timezone: "Europe/Moscow",
      weekly: {
        sat: [{ from: "00:00", to: "00:00", next_day: true }]
      }
    };

    expect(getCurrentOpeningWindow(hours, new Date("2026-05-23T09:00:00Z"))).toEqual({
      closesAt: "00:00",
      closesNextDay: true,
      allDay: true
    });
  });

  it("treats 00:00-23:59 as all-day for display", () => {
    const hours: OpeningHoursJson = {
      timezone: "Europe/Moscow",
      weekly: {
        sat: [{ from: "00:00", to: "23:59" }]
      }
    };

    expect(getCurrentOpeningWindow(hours, new Date("2026-05-23T20:59:00Z"))).toEqual({
      closesAt: "23:59",
      closesNextDay: false,
      allDay: true
    });
  });

  it("validates parsed JSON", () => {
    expect(() =>
      parseOpeningHoursJson('{"timezone":"Europe/Moscow","weekly":{"mon":[{"from":"10:00","to":"22:00"}]}}')
    ).not.toThrow();
  });

  it("requires next_day=true for overnight intervals", () => {
    expect(() =>
      parseOpeningHoursJson('{"timezone":"Europe/Moscow","weekly":{"fri":[{"from":"18:00","to":"03:00"}]}}')
    ).toThrow(/next_day=true/);
  });
});
