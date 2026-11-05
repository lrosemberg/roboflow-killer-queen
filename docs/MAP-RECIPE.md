# Adding a Roboflow Rumble map

The five playable destinations are Miami, San Francisco, New York, Brazil and Singapore. Each has a Classic layout and an XXL layout. They share authoritative rules and physics, but have distinct collision layouts, scenery, Queen accessories and ride characters.

Use the [Map Workshop](/map-workshop.html) to inspect both sizes and the character sheet. The workshop is a preview; verify real multiplayer rooms before publishing a map.

## One catalog, two playable sizes

`shared/maps.js` is the identity catalog. Each entry has:

- A stable lowercase `id`, human-readable `name`, `subtitle`, `kicker` and `description`.
- `accent` and a local `preview` asset at `/assets/maps/<id>.svg`.
- `ride: { name, type }` and `queen: { name, style }` for themed art and copy.
- `status: 'available'` or `'coming-soon'`.

`PLAYABLE_MAPS` contains only available entries. `NEXT_MAP` is the intentionally unavailable **Next Onsite** card. To add a destination, give it a new stable ID, complete its geometry and art, then mark it available. A preview alone must never make it selectable. Network requests reject unknown and unavailable IDs. `normalizeMapId()` provides Miami as a compatibility fallback for missing local values.

The public factory is `createMap(mode, totalPlayers?, mapId = 'miami')`. Existing calls without a map ID retain Miami. Generated maps carry `mapId`, `name`, `subtitle`, `ride` and `queen` alongside collision geometry. Every generation must be deterministic, with a fresh mutable world rather than shared room state.

## Geometry recipe

Add the new ID to `LAYOUTS` in `shared/world.js` and to its XXL station offsets. Keep the following invariants:

| Property                | Classic                            | XXL                     |
| ----------------------- | ---------------------------------- | ----------------------- |
| World dimensions        | 1,440 × 820                        | 12,000 × 2,000          |
| Capacity                | 10 total players                   | 120 total players       |
| Supply locations        | 6 grouped piles                    | 12 grouped piles        |
| Starting stock          | 6 chips per participant            | 6 chips per participant |
| Per-team victory target | `ceil(12 × participants / 10)`     | The same formula        |
| Queen quota             | One per five teammates, rounded up | The same formula        |
| Ride route              | Symmetric ground route             | Symmetric ground route  |

Participants include humans and bots. The server recalculates the economy while waiting and freezes it from countdown through the results. Geography and theme must not change the economic formula, jump height, movement speed, Queen lives or ride pacing.

For Classic, `steps` lists four **left-side** ledges as `[x, y, width]`. The builder mirrors each across the arena, then adds both HQ roofs, the center roof and the central supply bridge. `home` is the left HQ x-coordinate; `roof`, `center` and `bridge` are `[x, width]`. `ground` contains four pile x-coordinates, while `raised` contains two pile x-coordinates on the supply bridge. Machines stand on real ledges and mirror across the map.

The tested recipes use alternating outer and inner ledges with consecutive rises of 106–112 world pixels. Two tiers together exceed the ordinary worker's roughly 199-pixel ballistic jump apex, preventing a straight climb that skips the delivery route. Individual gaps must still be reachable with the navigation safety margin. Never infer reachability from a screenshot: run the actual movement tests with ordinary and speed-upgraded workers. Full routes from an HQ to a pile and back should take approximately 7–11 seconds in the deterministic center-to-center test. Actual pickup and doorway tolerances shorten those measurements slightly.

For XXL, `xxl` defines `spacing`, `stagger`, three repeating platform `widths`, and the first-column `offset`. Rows rise in reachable 180-pixel increments. New destinations mirror the full skyline and add center connectors. Miami preserves its previous skyline. Twelve piles span several districts; avoid placing the nearest supply immediately beside an HQ or funneling a 120-player room into one central pile. Raised piles snap to an actual first-tier platform. Ground and raised supplies must both reach either HQ.

Leave enough room between pile racks, station silhouettes and doors for players to read them. Scenery can overlap visually behind gameplay, but must not create invisible collisions, hide a landing edge or suggest a solid floor where none exists.

## Art and controls

Add a preview SVG and a renderer theme keyed by the catalog ID. Queen styles and mounts can change their shape and animations, but retain team colors, local-player markers, life indicators and the existing collision dimensions. The wire objective remains `winType: 'gator'` for compatibility even when its visible character is a cable car, subway train, delivery bike or riverboat. Use the catalog ride name in player-facing explanations and victory copy. Brazil represents a Rio de Janeiro route, with an iFood backpack on its delivery bike. Visible finish arches must be anchored at the actual `gatorTrack.x1` and `gatorTrack.x2` trigger coordinates and clearly identify which team owns each goal; decorative goals must never imply a different finish point.

Inspect both notebook and touch landscape layouts. Classic must keep the whole arena readable; XXL must follow the local player. The mobile joystick stays on the right and action buttons on the left. Background decoration must not intercept input.

## Room protocol

Creation and quick-play messages accept `mapId`. Quick play matches both city and size. Room listings, `joined.room` and snapshots include `mapId`, `mapName` and `mapRevision`.

Only the current host can send `{ type: 'map', mapId }`, and only in a waiting lobby. The server rebuilds navigation and geometry, resets the waiting round and respawns the existing crew while preserving teams, roles, bot count and difficulty. Every peer receives one `{ type: 'map-changed', map, mapId, mapName, mapRevision, players }` packet followed by current state. The client must replace its map, reset prediction and held inputs, and refresh its renderer without changing the room URL. Full geometry is not repeated in 20 Hz snapshots. Countdown, live play and results reject map changes; return to the next-round lobby first.

## Validation before marking available

1. Run `node --test test/map-catalog.test.mjs test/map-selection.test.mjs`. These checks cover deterministic and distinct geometry, proportional stock, all supply routes, machine access, ordinary and upgraded worker movement, map authority, lobby propagation, active-round locking and city-aware matchmaking.
2. Run the full `npm test` suite and format only changed files with Prettier.
3. Use `scripts/map-smoke.mjs` against a fresh local server and the deployment. Test both Classic and XXL with two connected clients. A single browser preview does not verify multiplayer propagation.
4. Inspect the workshop and real rooms in the browser. Capture Classic, an XXL camera view, themed Queens and rides, lobby selection and a victory screen.
5. For meaningful geometry changes, repeat unopposed delivery measurements and natural bot rounds. Report their limits: a deterministic route is not a promise about match duration, and bot simulations are not 120 physical players.
