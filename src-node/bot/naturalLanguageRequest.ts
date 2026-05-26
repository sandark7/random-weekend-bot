import type { PlaceScenarioKey } from "../recommendation/scenarios.js";

export type ParsedNaturalLanguageRequest = {
  locationQuery: string | null;
  scenarioKey: PlaceScenarioKey;
  categorySlugs?: readonly string[];
  humanLabel: string;
};

type IntentRule = {
  keywords: readonly string[];
  scenarioKey: PlaceScenarioKey;
  categorySlugs?: readonly string[];
  humanLabel: string;
};

const INTENT_RULES: readonly IntentRule[] = [
  {
    keywords: [
      "музей",
      "музеи",
      "музеев",
      "музея",
      "искусство",
      "искусства",
      "выставка",
      "выставку",
      "выставки",
      "галерея",
      "галерею",
      "галереи",
      "культура",
      "культурно",
      "просветиться"
    ],
    scenarioKey: "see",
    categorySlugs: ["culture"],
    humanLabel: "музеи и искусство"
  },
  {
    keywords: [
      "кофе",
      "кофейня",
      "кофейню",
      "кофейни",
      "капучино",
      "латте",
      "эспрессо",
      "завтрак",
      "завтраки",
      "перекус",
      "перекусить"
    ],
    scenarioKey: "coffee_snack",
    categorySlugs: ["coffee", "breakfast", "quick_bite"],
    humanLabel: "кофе или перекус"
  },
  {
    keywords: [
      "поесть",
      "еда",
      "еду",
      "ресторан",
      "рестик",
      "рестораны",
      "обед",
      "обедать",
      "ужин",
      "ужинать",
      "пицца",
      "бургер",
      "бургеры"
    ],
    scenarioKey: "eat",
    humanLabel: "где поесть"
  },
  {
    keywords: [
      "бар",
      "бары",
      "выпить",
      "выпивку",
      "коктейль",
      "коктейли",
      "вино",
      "винный",
      "пиво",
      "пивной",
      "паб"
    ],
    scenarioKey: "drink",
    humanLabel: "где выпить"
  },
  {
    keywords: [
      "парк",
      "парки",
      "погулять",
      "прогулка",
      "прогуляться",
      "вид",
      "видовая",
      "красиво",
      "красивое",
      "набережная",
      "набережную"
    ],
    scenarioKey: "see",
    categorySlugs: ["park", "viewpoint", "landmark"],
    humanLabel: "красивое место для прогулки"
  },
  {
    keywords: [
      "баня",
      "баню",
      "бани",
      "сауна",
      "сауну",
      "кальян",
      "кальянная",
      "кальянную",
      "отдохнуть",
      "расслабиться"
    ],
    scenarioKey: "relax",
    humanLabel: "место для отдыха"
  },
  {
    keywords: [
      "бильярд",
      "скалодром",
      "скалолазание",
      "активность",
      "активности",
      "досуг",
      "заняться",
      "поиграть",
      "игры"
    ],
    scenarioKey: "activity",
    humanLabel: "досуг"
  }
];

const STOP_WORDS = new Set([
  "я",
  "мне",
  "мы",
  "нам",
  "хочу",
  "хочется",
  "хотим",
  "надо",
  "нужно",
  "можно",
  "где",
  "куда",
  "найди",
  "найти",
  "посоветуй",
  "покажи",
  "подбери",
  "ищу",
  "ищем",
  "рядом",
  "около",
  "возле",
  "у",
  "с",
  "со",
  "в",
  "во",
  "на",
  "к",
  "ко",
  "по",
  "для",
  "и",
  "или",
  "а",
  "ну",
  "пожалуйста",
  "плиз",
  "плз",
  "бы",
  "что-нибудь",
  "что",
  "то",
  "какое-нибудь",
  "какой-нибудь"
]);

const LOCATION_HINT_WORDS = new Set([
  "метро",
  "м",
  "улица",
  "ул",
  "переулок",
  "пер",
  "проспект",
  "пр-т",
  "просп",
  "площадь",
  "пл",
  "набережная",
  "наб",
  "бульвар",
  "бул",
  "шоссе",
  "ш",
  "парк",
  "вокзал"
]);

export function parseNaturalLanguageRequest(text: string): ParsedNaturalLanguageRequest | null {
  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }

  const intent = findIntent(normalized);
  if (!intent) {
    return null;
  }

  const locationQuery = extractLocationQuery(normalized, intent);

  return {
    locationQuery,
    scenarioKey: intent.scenarioKey,
    categorySlugs: intent.categorySlugs,
    humanLabel: intent.humanLabel
  };
}

function findIntent(normalizedText: string): IntentRule | null {
  const tokens = tokenize(normalizedText);
  const tokenSet = new Set(tokens);

  let bestIntent: IntentRule | null = null;
  let bestScore = 0;

  for (const rule of INTENT_RULES) {
    const score = rule.keywords.reduce((sum, keyword) => {
      if (tokenSet.has(keyword)) {
        return sum + 2;
      }

      if (normalizedText.includes(keyword)) {
        return sum + 1;
      }

      return sum;
    }, 0);

    if (score > bestScore) {
      bestScore = score;
      bestIntent = rule;
    }
  }

  return bestIntent;
}

function extractLocationQuery(normalizedText: string, intent: IntentRule): string | null {
  const intentKeywords = new Set(intent.keywords);
  const tokens = tokenize(normalizedText);

  const locationTokens = tokens.filter((token) => {
    if (intentKeywords.has(token)) {
      return false;
    }

    if (STOP_WORDS.has(token)) {
      return false;
    }

    return true;
  });

  const compactLocation = cleanupLocationQuery(locationTokens.join(" "));
  if (compactLocation) {
    return compactLocation;
  }

  const hintedLocation = extractLocationAfterHint(tokens, intentKeywords);
  if (hintedLocation) {
    return hintedLocation;
  }

  return null;
}

function extractLocationAfterHint(tokens: string[], intentKeywords: Set<string>): string | null {
  const result: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (!LOCATION_HINT_WORDS.has(token)) {
      continue;
    }

    result.push(token);

    for (let inner = index + 1; inner < tokens.length; inner += 1) {
      const nextToken = tokens[inner];

      if (intentKeywords.has(nextToken)) {
        break;
      }

      if (STOP_WORDS.has(nextToken) && result.length > 1) {
        break;
      }

      result.push(nextToken);
    }

    break;
  }

  return cleanupLocationQuery(result.join(" "));
}

function cleanupLocationQuery(value: string): string | null {
  const cleaned = value
    .replace(/\bм\b/g, "метро")
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .trim();

  if (!cleaned) {
    return null;
  }

  if (cleaned.length < 3) {
    return null;
  }

  return cleaned;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[.,!?;:()[\]{}"«»]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}