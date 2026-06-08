import type { SupportedCityId } from "../geo/supportedCities.js";

export type CategorySlug = string;

export type OpeningHoursInterval = {
  from: string;
  to: string;
  next_day?: boolean;
};

export type OpeningHoursJson = {
  timezone: "Europe/Moscow";
  weekly: Partial<Record<Weekday, OpeningHoursInterval[]>>;
};

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type PlaceSuggestion = {
  placeId: number;
  name: string;
  categories: Array<{
    slug: CategorySlug;
    name: string;
    isPrimary: boolean;
  }>;
  description: string | null;
  address: string | null;
  lat: number;
  lon: number;
  citySlug: SupportedCityId | null;
  distanceMeters: number;
  openingHoursText: string | null;
  openingHoursJson: OpeningHoursJson | null;
};
