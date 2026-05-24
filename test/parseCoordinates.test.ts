import { describe, expect, it } from "vitest";
import { parseCoordinates } from "../src-node/bot/parseCoordinates.js";

describe("parseCoordinates", () => {
  it("parses decimal coordinates with comma separator", () => {
    expect(parseCoordinates("55.751244, 37.618423")).toEqual({
      lat: 55.751244,
      lon: 37.618423
    });
  });

  it("parses decimal comma coordinates", () => {
    expect(parseCoordinates("55,751244, 37,618423")).toEqual({
      lat: 55.751244,
      lon: 37.618423
    });
  });

  it("rejects text without coordinates", () => {
    expect(parseCoordinates("Патрики")).toBeNull();
  });
});
