# Delta for Place Data Ingestion

## ADDED Requirements

### Requirement: PostgreSQL Place Store

The system MUST provide a PostgreSQL schema that separates a venue from its
physical locations.

#### Scenario: Chain venue has many addresses

- GIVEN GreatList lists a restaurant chain with multiple addresses
- WHEN the importer stores the venue
- THEN one place row is stored
- AND each address is stored as a separate place location row

### Requirement: Geocoded Locations

The system MUST store latitude, longitude, and a PostGIS geography point for
geocoded locations.

#### Scenario: Location is geocoded

- GIVEN an address was resolved to coordinates
- WHEN the importer stores that location
- THEN latitude and longitude are saved
- AND the geography point is indexed for radius lookup

### Requirement: Geocoding Cache

The system MUST cache geocoding results by normalized query.

#### Scenario: Address was already geocoded

- GIVEN a normalized address exists in the geocoding cache
- WHEN a later import sees the same address
- THEN the importer reuses the cached coordinates
- AND does not call the external geocoding provider again

### Requirement: GreatList Import

The system SHOULD import factual Moscow venue metadata from GreatList pages.

#### Scenario: Import GreatList Moscow guide

- GIVEN the GreatList Moscow guide page is reachable
- WHEN the importer runs
- THEN it discovers venue detail URLs
- AND imports venue title, category, source URL, website, and address rows

### Requirement: Nearby Query

The database MUST support finding active geocoded locations within a radius in
meters from a user coordinate.

#### Scenario: Nearby places

- GIVEN a user coordinate and a search radius
- WHEN the nearby query runs
- THEN it returns active locations inside the radius
- AND orders them by distance in meters

