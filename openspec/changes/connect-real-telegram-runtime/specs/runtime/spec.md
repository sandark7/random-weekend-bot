# Delta for Telegram Runtime

## ADDED Requirements

### Requirement: Runtime Configuration Check

The application MUST provide a configuration check command that verifies required
runtime inputs before polling starts.

#### Scenario: Complete configuration

- GIVEN `BOT_TOKEN` is configured
- AND the data and anchors files exist
- WHEN the operator runs the check command
- THEN the application reports that configuration is ready
- AND exits successfully

#### Scenario: Missing bot token

- GIVEN `BOT_TOKEN` is not configured
- WHEN the operator runs the check command
- THEN the application reports that the token is missing
- AND exits with a non-zero status

### Requirement: Polling Startup

The application MUST start Telegram polling only after configuration has been
loaded and validated.

#### Scenario: Start with token

- GIVEN a valid `BOT_TOKEN` is configured
- WHEN the operator runs the bot command
- THEN the application creates the Telegram bot client
- AND starts polling for updates

### Requirement: Local Run Helper

The project SHOULD include a local helper script for starting the bot from the
repository root.

#### Scenario: Run helper

- GIVEN dependencies are installed
- AND `BOT_TOKEN` is set in `.env` or the environment
- WHEN the operator runs the helper script
- THEN the script checks configuration
- AND starts the bot process

