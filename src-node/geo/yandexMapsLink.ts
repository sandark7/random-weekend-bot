export type YandexMapsLinkOptions = {
  lat: number;
  lon: number;
  zoom?: number;
};

export type YandexMapsRouteLinkOptions = {
  from: {
    lat: number;
    lon: number;
  };
  to: {
    lat: number;
    lon: number;
  };
  zoom?: number;
};

export function buildYandexMapsPointLink({ lat, lon, zoom = 17 }: YandexMapsLinkOptions): string {
  const latitude = formatCoordinate(lat);
  const longitude = formatCoordinate(lon);
  const url = new URL("https://yandex.ru/maps/");

  url.searchParams.set("ll", `${longitude},${latitude}`);
  url.searchParams.set("mode", "whatshere");
  url.searchParams.set("whatshere[point]", `${longitude},${latitude}`);
  url.searchParams.set("whatshere[zoom]", String(zoom));
  url.searchParams.set("z", String(zoom));

  return url.toString();
}

export function buildYandexMapsWalkingRouteLink({
  from,
  to,
  zoom = 17
}: YandexMapsRouteLinkOptions): string {
  const fromLatitude = formatCoordinate(from.lat);
  const fromLongitude = formatCoordinate(from.lon);
  const toLatitude = formatCoordinate(to.lat);
  const toLongitude = formatCoordinate(to.lon);
  const url = new URL("https://yandex.ru/maps/");

  url.searchParams.set("ll", `${toLongitude},${toLatitude}`);
  url.searchParams.set("mode", "routes");
  url.searchParams.set("rtext", `${fromLatitude},${fromLongitude}~${toLatitude},${toLongitude}`);
  url.searchParams.set("rtt", "pd");
  url.searchParams.set("ruri", "~");
  url.searchParams.set("z", String(zoom));

  return url.toString();
}

function formatCoordinate(value: number): string {
  return Number(value.toFixed(6)).toString();
}
