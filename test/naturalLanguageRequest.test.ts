import { describe, expect, it } from "vitest";
import { parseNaturalLanguageRequest } from "../src-node/bot/naturalLanguageRequest.js";

describe("parseNaturalLanguageRequest", () => {
  it("parses metro + museums intent", () => {
    expect(parseNaturalLanguageRequest("Метро Китай город хочу музеев и искусства")).toEqual({
      locationQuery: "метро китай город",
      scenarioKey: "see",
      categorySlugs: ["culture"],
      humanLabel: "музеи и искусство"
    });
  });

  it("parses coffee intent with location", () => {
    const result = parseNaturalLanguageRequest("Патриаршие хочу кофе");
    expect(result).toEqual({
      locationQuery: "патриаршие",
      scenarioKey: "coffee_snack",
      categorySlugs: ["coffee", "breakfast", "quick_bite"],
      humanLabel: "кофе или перекус"
    });
  });

  it("parses drink intent with location", () => {
    const result = parseNaturalLanguageRequest("Тверская 7 где выпить");
    expect(result).toEqual({
      locationQuery: "тверская 7",
      scenarioKey: "drink",
      humanLabel: "где выпить"
    });
  });

  it("returns null without intent", () => {
    expect(parseNaturalLanguageRequest("метро китай город")).toBeNull();
  });

  it("does not parse bare place names as scenario requests", () => {
    expect(parseNaturalLanguageRequest("Парк Горького")).toBeNull();
    expect(parseNaturalLanguageRequest("бар Стрелка")).toBeNull();
    expect(parseNaturalLanguageRequest("Кофемания на Павелецкой")).toBeNull();
    expect(parseNaturalLanguageRequest("Тверская 7")).toBeNull();
  });

  it("returns intent without location", () => {
    expect(parseNaturalLanguageRequest("хочу музеев")).toEqual({
      locationQuery: null,
      scenarioKey: "see",
      categorySlugs: ["culture"],
      humanLabel: "музеи и искусство"
    });
  });
});
