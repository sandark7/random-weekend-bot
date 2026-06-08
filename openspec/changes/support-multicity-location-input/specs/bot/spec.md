# Delta for Multi-City Location Input

## ADDED Requirements

### Requirement: Supported City Text Resolution

The bot MUST resolve text locations against supported city contexts instead of always adding Moscow to the query.

Supported city contexts include:

- Moscow
- Krasnodar

#### Scenario: Explicit Krasnodar exact address

- GIVEN the user enters `Краснодар, Красная 50`
- WHEN the bot geocodes the address
- THEN the geocoder query is biased to Krasnodar
- AND Moscow is not prepended or appended to the query
- AND the result is accepted only if it is inside the Krasnodar bbox and belongs to Krasnodar.

#### Scenario: Bare Moscow address remains Moscow

- GIVEN the user enters `Тверская 7`
- WHEN the bot geocodes the address
- THEN Moscow remains one of the attempted city contexts
- AND a valid Moscow result is accepted.

#### Scenario: Bare supported-city address fallback

- GIVEN the user enters an exact address without an explicit city
- WHEN the first supported city context does not produce a valid result
- THEN the resolver MAY try another supported city context
- AND it MUST accept only candidates whose city and coordinates match that context.

#### Scenario: Loose location uses detected city

- GIVEN the user enters a loose place or area with a supported city name
- WHEN the bot geocodes the location
- THEN the query uses that city context
- AND the user-facing label is short, not the raw geocoder display name.

#### Scenario: City-aware user-facing text

- GIVEN the bot asks for a location
- WHEN the user reads the prompt
- THEN the prompt mentions that addresses can be provided for supported cities, including Moscow and Krasnodar.

#### Scenario: City-aware analytics

- GIVEN a text location is resolved
- WHEN the bot writes a product analytics event
- THEN the event payload includes the supported city slug
- AND still does not include the raw address text.

### Requirement: Shared Supported City Registry

Runtime geocoding and CSV validation MUST use the same supported city bbox definitions.

#### Scenario: Shared city bbox

- GIVEN Krasnodar is supported by the location resolver
- WHEN CSV validation checks coordinates
- THEN it uses the same Krasnodar bbox definition as the resolver.

### Requirement: Runtime City Metadata

The runtime places table MUST keep the supported city slug for each physical place when the city can be inferred.

#### Scenario: Import infers place city

- GIVEN a `places.csv` row has coordinates inside a supported city bbox
- WHEN CSV import writes the row to SQLite
- THEN `places.city_slug` is set to the matching supported city slug.

#### Scenario: Explicit CSV city must match coordinates

- GIVEN a `places.csv` row has `city_slug`
- WHEN CSV import validates the row
- THEN the city slug MUST be supported
- AND coordinates, when present, MUST be inside that city's bbox.

### Requirement: Persistent Geocode Cache

The geocoder SHOULD cache Nominatim-compatible responses in SQLite so repeated location resolution does not repeatedly call the external geocoder.

#### Scenario: Successful geocode cache hit

- GIVEN a query has been geocoded successfully
- WHEN the same normalized query and city options are requested again after a geocoder instance restart
- THEN the result is returned from SQLite cache
- AND the external geocoder is not called.

#### Scenario: Negative geocode cache hit

- GIVEN a query returned no geocoder results
- WHEN the same normalized query and city options are requested again
- THEN the cached empty result is returned
- AND the external geocoder is not called.

### Requirement: City-Aware Product Analytics

Product analytics events MUST include safe supported-city fields when a city is known.

#### Scenario: City-aware place event

- GIVEN the bot suggests a place
- WHEN it writes `place_suggested`
- THEN the payload includes the location city and the place city
- AND still omits raw address text and exact user coordinates.

#### Scenario: City-aware route event

- GIVEN the bot builds or fails to build a route
- WHEN it writes a route analytics event
- THEN the payload includes the route city.

### Requirement: Route Scoring Planner

Automatic route building MUST use scoring profiles and constraints instead of only fixed scenario sequences.

#### Scenario: Scored route preserves dramaturgy

- GIVEN the user asks for a route
- WHEN the planner chooses each next step
- THEN it scores candidate scenarios according to route phase
- AND still applies constraints for open duration, walking time, duplicate primary category, fine dining, bathhouse, breakfast, drink, and relax timing.

#### Scenario: Different city density can still produce routes

- GIVEN the local candidate density does not fit a single strict template
- WHEN a valid sequence satisfies the route constraints and fill ratio
- THEN the planner may choose that sequence even if it differs from another city's common route shape.

### Requirement: Whole-Route Map Link

Route output MUST include one pedestrian Yandex Maps link for the whole planned walk.

#### Scenario: Open whole route in maps

- GIVEN the bot builds a route with multiple points
- WHEN it formats the route response
- THEN the response includes an `Открыть маршрут в Яндекс Картах` link
- AND the link contains the start point and every route stop in walking-route order.
