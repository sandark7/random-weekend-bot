# Design: Location Button Fallback

Telegram `request_location` buttons are client-dependent. Mobile clients usually
send a location object. Some desktop/web clients may not have native geolocation
or may send only the button text.

The adapter should treat `F.location` as the source of truth for nearby
recommendations and separately handle the button text with a help message. It
should also accept `F.venue` because Telegram map sharing can produce venue
objects with embedded coordinates.

For desktop testing, manual input should accept coordinates in addition to local
anchor aliases. Moscow-specific coordinate-order normalization handles both
`55.73178, 37.63674` and Yandex-style `37.63674, 55.73178`.
