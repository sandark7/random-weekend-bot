# Delta for Bot MVP

## ADDED Requirements

### Requirement: Welcome and Choice Flow

The bot MUST welcome a user and present three paths: share location, enter an
address or landmark manually, or request a random activity without location.

#### Scenario: Start command

- GIVEN a user opens the bot
- WHEN the user sends `/start`
- THEN the bot replies with a short explanation
- AND the bot presents actions for location sharing, manual address input, and
  no-location random activity

### Requirement: Location-Based Suggestions

The bot MUST accept a Telegram location and return one randomly selected
activity within the configured walking radius when at least one match exists.

#### Scenario: Nearby activity exists

- GIVEN the curated activity dataset contains an activity within the walking
  radius
- WHEN the user shares a location
- THEN the bot returns the activity name, category, address, approximate
  distance, and a short description

#### Scenario: No nearby activity exists

- GIVEN the curated activity dataset contains no activities within the walking
  radius
- WHEN the user shares a location
- THEN the bot explains that no nearby option was found
- AND the bot suggests trying a random activity without location or another
  address

### Requirement: Manual Location Input

The bot MUST allow text input for known local anchors such as metro stations,
streets, and landmarks.

#### Scenario: Known anchor

- GIVEN the anchor dataset contains an alias matching the user's text
- WHEN the user enters that text in manual address mode
- THEN the bot uses the anchor coordinates for nearby recommendations

#### Scenario: Unknown anchor

- GIVEN the anchor dataset has no matching alias
- WHEN the user enters that text in manual address mode
- THEN the bot asks for a clearer landmark or a shared location

### Requirement: No-Location Random Activity

The bot MUST support a no-location mode that returns a random curated activity
from the dataset.

#### Scenario: Random activity

- GIVEN the dataset contains active activities
- WHEN the user requests a random activity without location
- THEN the bot returns one active activity without distance-specific language

### Requirement: Testable Recommendation Core

The recommendation logic MUST be usable without Telegram dependencies.

#### Scenario: Unit test imports recommendation service

- GIVEN the Telegram bot adapter is not imported
- WHEN tests instantiate the repository, geocoder, and recommender
- THEN suggestions can be generated from plain Python objects

