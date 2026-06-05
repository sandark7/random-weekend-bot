# Delta for Bot Natural Language Input

## ADDED Requirements

### Requirement: Explicit Natural-Language Requests

The bot MUST treat natural-language scenario parsing as an opt-in layer that activates only when the message contains a clear request marker.

Clear request markers include words such as `хочу`, `хочется`, `где`, `куда`, `найди`, `посоветуй`, `покажи`, `подбери`, or `ищу`.

#### Scenario: Intent with location is parsed

- GIVEN the user sends `Метро Китай город хочу музеев и искусства`
- WHEN the bot parses the message
- THEN it extracts the scenario `see`
- AND narrows categories to `culture`
- AND resolves `метро китай город` as the location query

#### Scenario: Intent with saved location is parsed

- GIVEN the user has already saved a location
- WHEN the user sends `хочу кофе`
- THEN the bot uses the saved location
- AND searches the `coffee_snack` scenario

#### Scenario: Bare location remains a location

- GIVEN the user sends `Парк Горького`
- WHEN the bot handles the text
- THEN it MUST NOT parse the text as a `see` request
- AND it passes the original text to the location resolver

#### Scenario: Bare POI remains a location

- GIVEN the user sends `бар Стрелка`
- WHEN the bot handles the text
- THEN it MUST NOT parse the text as a `drink` request
- AND it passes the original text to the location resolver

#### Scenario: Bare brand remains a location

- GIVEN the user sends `Кофемания на Павелецкой`
- WHEN the bot handles the text
- THEN it MUST NOT parse the text as a `coffee_snack` request
- AND it passes the original text to the location resolver

### Requirement: Beta Route State Is Explicit

The bot MUST expose only the beta route model: routes are built from the saved user start point, not from a previously suggested place.

#### Scenario: Place result route button uses saved start

- GIVEN the user has saved a location
- AND the bot has shown a place card
- WHEN the user presses `🧭 Собрать маршрут`
- THEN the bot asks `На сколько часов собрать маршрут?`
- AND it does not mention building a route from the place card

#### Scenario: Route updates do not affect single-place recent history

- GIVEN the user has seen single-place suggestions
- WHEN the bot builds, rebuilds, or edits a route
- THEN route place ids MUST NOT be appended to the recent-place history used for `Ещё вариант`

#### Scenario: Expired location confirmation is ignored

- GIVEN the bot asked the user to confirm a geocoded location
- AND the confirmation has expired
- WHEN the user presses `Да`
- THEN the bot MUST NOT save the expired location
- AND it treats the message as normal text or asks for a fresh location.
