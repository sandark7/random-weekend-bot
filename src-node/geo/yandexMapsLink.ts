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

export type YandexMapsMultiPointRouteLinkOptions = {
  points: Array<{
    lat: number;
    lon: number;
  }>;
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
  return buildYandexMapsWalkingMultiPointRouteLink({
    points: [from, to],
    zoom
  });
}

export function buildYandexMapsWalkingMultiPointRouteLink({
  points,
  zoom = 17
}: YandexMapsMultiPointRouteLinkOptions): string {
  if (points.length < 2) {
    const point = points[0];
    return point ? buildYandexMapsPointLink({ ...point, zoom }) : "https://yandex.ru/maps/";
  }

  const lastPoint = points[points.length - 1]!;
  const lastLatitude = formatCoordinate(lastPoint.lat);
  const lastLongitude = formatCoordinate(lastPoint.lon);
  const url = new URL("https://yandex.ru/maps/");

  url.searchParams.set("ll", `${lastLongitude},${lastLatitude}`);
  url.searchParams.set("mode", "routes");
  url.searchParams.set("rtext", points.map(formatRoutePoint).join("~"));
  url.searchParams.set("rtt", "pd");
  url.searchParams.set("ruri", points.map(() => "").join("~"));
  url.searchParams.set("z", String(zoom));

  return url.toString();
}

function formatRoutePoint(point: { lat: number; lon: number }): string {
  return `${formatCoordinate(point.lat)},${formatCoordinate(point.lon)}`;
}

function formatCoordinate(value: number): string {
  return Number(value.toFixed(6)).toString();
}
