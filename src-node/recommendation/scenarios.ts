import type { DesireButtonText, RouteDurationButtonText } from "../bot/keyboards.js";

export type PlaceScenarioKey = "eat" | "coffee_snack" | "drink" | "relax" | "see" | "activity";
export type RouteDurationHours = 2 | 3 | 5 | 8;

export type PlaceScenario = {
  key: PlaceScenarioKey;
  button: DesireButtonText;
  label: string;
  categories: string[];
  durationMinutes: number;
};

export const SCENARIO_CATEGORIES = {
  eat: ["restaurant", "fine_dining"],
  coffee_snack: ["coffee", "breakfast", "quick_bite"],
  drink: ["bar", "cocktail_bar", "wine_bar", "pub"],
  relax: ["bathhouse", "hookah"],
  see: ["culture", "landmark", "viewpoint", "park"],
  activity: ["activity"],
  random: [
    "restaurant",
    "fine_dining",
    "coffee",
    "breakfast",
    "quick_bite",
    "bar",
    "cocktail_bar",
    "wine_bar",
    "pub",
    "culture",
    "landmark",
    "viewpoint",
    "park",
    "activity"
  ]
} as const satisfies Record<PlaceScenarioKey | "random", readonly string[]>;

export const PLACE_SCENARIOS: Record<PlaceScenarioKey, PlaceScenario> = {
  eat: {
    key: "eat",
    button: "🍽 Поесть",
    label: "поесть",
    categories: [...SCENARIO_CATEGORIES.eat],
    durationMinutes: 90
  },
  coffee_snack: {
    key: "coffee_snack",
    button: "☕ Кофе / перекус",
    label: "кофе / перекус",
    categories: [...SCENARIO_CATEGORIES.coffee_snack],
    durationMinutes: 45
  },
  drink: {
    key: "drink",
    button: "🍸 Выпить",
    label: "выпить",
    categories: [...SCENARIO_CATEGORIES.drink],
    durationMinutes: 60
  },
  relax: {
    key: "relax",
    button: "🧘 Отдохнуть",
    label: "отдохнуть",
    categories: [...SCENARIO_CATEGORIES.relax],
    durationMinutes: 120
  },
  see: {
    key: "see",
    button: "🏛 Город",
    label: "город",
    categories: [...SCENARIO_CATEGORIES.see],
    durationMinutes: 45
  },
  activity: {
    key: "activity",
    button: "🎯 Досуг",
    label: "досуг",
    categories: [...SCENARIO_CATEGORIES.activity],
    durationMinutes: 90
  }
};

export const SCENARIO_BY_BUTTON = new Map<DesireButtonText, PlaceScenarioKey>(
  Object.values(PLACE_SCENARIOS).map((scenario) => [scenario.button, scenario.key])
);

export const ROUTE_DURATION_BY_BUTTON = new Map<RouteDurationButtonText, RouteDurationHours>([
  ["2 часа", 2],
  ["3 часа", 3],
  ["5 часов", 5],
  ["8 часов", 8]
]);

export const ROUTE_SCENARIO_POOL: PlaceScenarioKey[] = [
  "coffee_snack",
  "see",
  "activity",
  "eat",
  "drink",
  "relax"
];
