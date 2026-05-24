# Proposal: Fix Location Button Fallback

## Intent

Make the "share location" path understandable on Telegram clients where the
special location-request keyboard button does not open native location sharing.

## Scope

In scope:

- Handle the location button text as a fallback message.
- Keep real Telegram `location` messages routed to nearby recommendations.
- Document that desktop/web clients may need manual location sharing or address
  input.

Out of scope:

- Replacing Telegram native location sharing with an external map UI.
- Live geocoding APIs.

## Success Criteria

- If a real location message arrives, the bot recommends nearby activity.
- If the location button only sends text, the bot explains how to send location
  manually and keeps the main keyboard visible.

