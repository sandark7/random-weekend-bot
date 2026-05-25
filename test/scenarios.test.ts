import { describe, expect, it } from "vitest";
import { SCENARIO_CATEGORIES } from "../src-node/recommendation/scenarios.js";

describe("place scenarios", () => {
  it("keeps bathhouses and hookah opt-in through relax", () => {
    expect(SCENARIO_CATEGORIES.relax).toEqual(["bathhouse", "hookah"]);
    expect(SCENARIO_CATEGORIES.random).not.toEqual(expect.arrayContaining(["bathhouse", "hookah"]));
  });
});
