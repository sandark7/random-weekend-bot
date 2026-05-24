# Delta for Bot Location Button Fallback

## ADDED Requirements

### Requirement: Location Button Fallback

The bot MUST handle clients that send the location button label as text instead
of sending a Telegram location object.

#### Scenario: Location button sends text

- GIVEN a Telegram client does not open native location sharing
- WHEN the user presses the location button and the bot receives the button text
- THEN the bot explains how to send a location manually
- AND keeps the main keyboard available

### Requirement: Desktop Manual Location Input

The bot MUST provide a desktop-friendly location path that does not depend on
Telegram native location sharing.

#### Scenario: User enters coordinates

- GIVEN the user is using Telegram Desktop
- WHEN the user enters coordinates as text
- THEN the bot uses those coordinates for nearby recommendations

### Requirement: Venue Location Input

The bot SHOULD accept Telegram venue messages as coordinate-bearing input.

#### Scenario: User sends a venue

- GIVEN the user sends a Telegram venue object
- WHEN the venue contains a location
- THEN the bot uses the venue coordinates for nearby recommendations
