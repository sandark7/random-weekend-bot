from __future__ import annotations

import argparse
import os
import time
from collections.abc import Sequence

from citydatebot.geocoding import normalize_address
from citydatebot.greatlist import (
    GREATLIST_MSK_URL,
    NominatimGeocoder,
    fetch_text,
    normalize_geocode_query,
    parse_index,
    parse_place_detail,
)
from citydatebot.postgres_store import (
    connect,
    load_cached_geocodes,
    upsert_geocode,
    upsert_places,
)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    user_agent = os.environ.get("CITYDATEBOT_GEOCODER_USER_AGENT", "citydatebot-dev/0.1")
    index_html = fetch_text(args.index_url, user_agent=user_agent)
    index_items = parse_index(index_html, args.index_url)

    if args.limit:
        index_items = index_items[: args.limit]

    places = []
    for number, item in enumerate(index_items, start=1):
        print(f"[{number}/{len(index_items)}] Fetching {item.title}: {item.url}", flush=True)
        if number > 1 and args.crawl_delay:
            time.sleep(args.crawl_delay)
        detail_html = fetch_text(item.url, user_agent=user_agent)
        place = parse_place_detail(detail_html, source_url=item.url, index_item=item)
        places.append(place)

    if args.dry_run:
        _print_dry_run(places)
        return 0

    database_url = os.environ.get(
        "DATABASE_URL",
        "postgresql://citydatebot:citydatebot@localhost:5432/citydatebot",
    )

    with connect(database_url) as connection:
        geocoding_by_address = {}
        if args.geocode:
            geocoding_by_address = _geocode_locations(connection, places, args)

        place_count, location_count = upsert_places(
            connection,
            places,
            geocoding_by_address=geocoding_by_address,
        )
        print(f"Imported {place_count} places and {location_count} locations.")

    return 0


def _parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Import GreatList Moscow places.")
    parser.add_argument("--index-url", default=GREATLIST_MSK_URL)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--crawl-delay", type=float, default=0.25)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--geocode",
        action="store_true",
        help="resolve addresses with a Nominatim-compatible provider",
    )
    parser.add_argument(
        "--geocoder-url",
        default=os.environ.get(
            "CITYDATEBOT_NOMINATIM_URL",
            "https://nominatim.openstreetmap.org/search",
        ),
    )
    parser.add_argument(
        "--geocoder-delay",
        type=float,
        default=float(os.environ.get("CITYDATEBOT_GEOCODER_DELAY_SECONDS", "1.1")),
    )
    return parser.parse_args(argv)


def _geocode_locations(connection, places, args) -> dict[str, object]:
    cached = load_cached_geocodes(connection, "nominatim")
    geocoder = NominatimGeocoder(
        base_url=args.geocoder_url,
        user_agent=os.environ.get("CITYDATEBOT_GEOCODER_USER_AGENT", "citydatebot-dev/0.1"),
        delay_seconds=args.geocoder_delay,
    )
    geocoding_by_address = {}

    for place in places:
        for location in place.locations:
            request_query = normalize_geocode_query(location.address)
            normalized_query = normalize_address(request_query)
            result = cached.get(normalized_query)
            if result is None:
                print(f"Geocoding {location.address}", flush=True)
                result = geocoder.geocode(location.address)
                upsert_geocode(connection, result)
                connection.commit()
            geocoding_by_address[location.normalized_address] = result

    return geocoding_by_address


def _print_dry_run(places) -> None:
    location_count = sum(len(place.locations) for place in places)
    print(f"Parsed {len(places)} places and {location_count} locations.")
    for place in places[:10]:
        print(f"- {place.title} [{place.category or 'unknown'}] {place.url}")
        for location in place.locations[:3]:
            print(f"  - {location.address}")


if __name__ == "__main__":
    raise SystemExit(main())
