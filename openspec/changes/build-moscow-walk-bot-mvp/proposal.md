# Proposal: Build Moscow Walk Bot MVP

## Intent

Rebuild the quick Telegram bot prototype as a maintainable Python project using
OpenSpec-style development. The first version should prove the core loop:
receive a location or text landmark, choose a random activity nearby, and return
a useful Telegram message.

## Scope

In scope:

- Telegram bot entrypoint with `/start`, location handling, manual address mode,
  and random suggestion mode.
- Local curated JSON dataset of activities in central Moscow.
- Local landmark/metro/address anchor resolver for manual input.
- Distance-based filtering with a configurable walking radius.
- Domain services that can be tested without Telegram.
- README, `.env.example`, and tests for the recommendation core.

Out of scope for this change:

- Production geocoding APIs.
- Persistence for users, favorites, or visit history.
- Admin UI or database-backed content management.
- Opening-hours validation and live venue availability.
- Deployment automation.

## Success Criteria

- A developer can run tests with the standard Python toolchain.
- The recommendation service returns a nearby activity for shared coordinates or
  a known manual anchor.
- The Telegram adapter is isolated from the domain logic.
- Runtime secrets are configured through environment variables, not committed.
- The next feature can extend the spec without rewriting the MVP.

