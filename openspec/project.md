# Project: Moscow Random Walk Bot

## Vision

A Telegram bot that helps people in central Moscow turn a walk into a small
adventure: pick a nearby activity at random, with enough context to go do it
right now.

## Product Principles

- Random, but not careless: suggestions should be nearby and categorized.
- Low friction: location sharing, manual address input, or no-location random.
- Curated over exhaustive: the dataset starts as a hand-picked list and can grow
  later through admin tools or imports.
- Offline-first MVP: local data and local address anchors before external APIs.

## Incremental Roadmap

1. MVP bot: curated local places, manual/location input, random suggestions.
2. Better matching: mood, price, opening hours, repeat avoidance.
3. Geocoding: Yandex/2GIS/OpenStreetMap provider behind a single interface.
4. Curation tools: import/export, admin commands, quality flags.
5. Personalization: date style, walking range, favorites, history.

