import { describe, expect, it } from "vitest";
import {
  buildYandexMapsPointLink,
  buildYandexMapsWalkingMultiPointRouteLink,
  buildYandexMapsWalkingRouteLink
} from "../src-node/geo/yandexMapsLink.js";

describe("Yandex Maps link", () => {
  it("builds a whatshere web link from longitude and latitude", () => {
    expect(buildYandexMapsPointLink({ lat: 55.729117, lon: 37.638956 })).toBe(
      "https://yandex.ru/maps/?ll=37.638956%2C55.729117&mode=whatshere&whatshere%5Bpoint%5D=37.638956%2C55.729117&whatshere%5Bzoom%5D=17&z=17"
    );
  });

  it("builds a pedestrian route link from origin to destination", () => {
    expect(
      buildYandexMapsWalkingRouteLink({
        from: { lat: 55.751244, lon: 37.618423 },
        to: { lat: 55.759987, lon: 37.651959 }
      })
    ).toBe(
      "https://yandex.ru/maps/?ll=37.651959%2C55.759987&mode=routes&rtext=55.751244%2C37.618423%7E55.759987%2C37.651959&rtt=pd&ruri=%7E&z=17"
    );
  });

  it("builds a pedestrian route link through multiple waypoints", () => {
    expect(
      buildYandexMapsWalkingMultiPointRouteLink({
        points: [
          { lat: 55.751244, lon: 37.618423 },
          { lat: 55.759987, lon: 37.651959 },
          { lat: 55.7605, lon: 37.6465 }
        ]
      })
    ).toBe(
      "https://yandex.ru/maps/?ll=37.6465%2C55.7605&mode=routes&rtext=55.751244%2C37.618423%7E55.759987%2C37.651959%7E55.7605%2C37.6465&rtt=pd&ruri=%7E%7E&z=17"
    );
  });
});
