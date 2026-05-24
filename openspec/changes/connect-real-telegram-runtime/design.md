# Design: Real Telegram Runtime

## Approach

Add a small CLI layer that does not import aiogram until the operator actually
starts polling. This keeps configuration checks and tests lightweight.

Commands:

- `python3 -m citydatebot --check`: validate local runtime config.
- `python3 -m citydatebot`: start Telegram polling.

## Configuration

Configuration continues to come from `.env` and shell environment variables.
Shell variables override `.env` values.

New setting:

- `CITYDATEBOT_DROP_PENDING_UPDATES`: defaults to `true`.

## Startup Sequence

```text
load settings
validate data files and BOT_TOKEN
create app services
create aiogram Bot
delete webhook with drop_pending_updates setting
start polling
```

## Secret Handling

The CLI must never print `BOT_TOKEN`. It may report whether a token is present.

