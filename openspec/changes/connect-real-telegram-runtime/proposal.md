# Proposal: Connect Real Telegram Runtime

## Intent

Make the MVP bot easy to connect to a real Telegram bot token and run locally for
manual testing.

## Scope

In scope:

- Add a command-line runtime that can validate configuration before starting.
- Keep the bot token in `.env` or shell environment variables.
- Start Telegram polling with aiogram when `BOT_TOKEN` is configured.
- Drop pending updates on startup by default to avoid replaying stale test
  messages.
- Add a local run helper script and update README instructions.
- Add tests around configuration parsing and CLI check behavior.

Out of scope:

- Creating a Telegram bot through BotFather automatically.
- Webhook deployment.
- Docker, process managers, or cloud hosting.
- Secret storage beyond local environment variables.

## Success Criteria

- `python3 -m citydatebot --check` validates data paths and token presence
  without requiring Telegram network access.
- `scripts/run_bot.sh` starts the bot after dependencies are installed and
  `BOT_TOKEN` is set.
- Missing token errors are clear and do not print secrets.
- Existing recommendation tests remain green.

