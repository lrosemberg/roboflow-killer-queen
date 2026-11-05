# Adding a RoboQueen map

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

| Property                | Classic                                 | XXL                         |
| ----------------------- | --------------------------------------- | --------------------------- |
| World dimensions        | 1,440 × 820                             | 7,200 × 1,600               |
| Capacity                | 10 total players                        | 120 total players           |
| Supply locations        | 6 grouped piles                         | 12 grouped piles            |
| Starting stock          | `max(60, 6 × participants)`             | `max(60, 6 × participants)` |
| Per-team victory target | `max(12, ceil(12 × participants / 10))` | The same formula            |
| Queen quota             | One per five teammates, rounded up      | The same formula            |
| Ride route              | Symmetric ground route                  | Symmetric ground route      |

Participants include humans and bots. A room with 1–10 participants needs 12 chips per team and starts with 60 chips; 20 participants need 24 per team with 120 in stock; 120 participants need 144 per team with 720 in stock. `economyPlayerCount` remains the actual roster count, including in small rooms. The server recalculates the economy while waiting and freezes it from countdown through the results. Geography and theme must not change the economic formula, jump height, movement speed, Queen lives or ride pacing.

For Classic, `steps` lists four **left-side** ledges as `[x, y, width]`. The builder mirrors each across the arena, then adds both HQ roofs, the center roof and the central supply bridge. `home` is the left HQ x-coordinate; `roof`, `center` and `bridge` are `[x, width]`. `ground` contains four pile x-coordinates, while `raised` contains two pile x-coordinates on the supply bridge. Machines stand on real ledges and mirror across the map.

The tested recipes use alternating outer and inner ledges with consecutive rises of 106–112 world pixels. Two tiers together exceed the ordinary worker's roughly 199-pixel ballistic jump apex, preventing a straight climb that skips the delivery route. Individual gaps must still be reachable with the navigation safety margin. Never infer reachability from a screenshot: run the actual movement tests with ordinary and speed-upgraded workers. Full routes from an HQ to a pile and back should take approximately 7–11 seconds in the deterministic center-to-center test. Actual pickup and doorway tolerances shorten those measurements slightly.

For XXL, `xxl` defines `spacing`, `stagger`, three repeating platform `widths`, and the first-column `offset`. Rows rise in reachable 180-pixel increments. Every destination mirrors the full skyline and adds center connectors, including Miami. Twelve piles span several districts; avoid placing the nearest supply immediately beside an HQ or funneling a 120-player room into one central pile. Raised piles snap to an actual first-tier platform. Ground and raised supplies must both reach either HQ.

Leave enough room between pile racks, station silhouettes and doors for players to read them. Scenery can overlap visually behind gameplay, but must not create invisible collisions, hide a landing edge or suggest a solid floor where none exists.

## Art and controls

Add a preview SVG and a renderer theme keyed by the catalog ID. Queen styles and mounts can change their shape and animations, but retain team colors, local-player markers, life indicators and the existing collision dimensions. The wire objective remains `winType: 'gator'` for compatibility even when its visible character is a cable car, subway train, delivery bike or riverboat. Use the catalog ride name in player-facing explanations and victory copy. Brazil represents a Rio de Janeiro route, with an iFood backpack on its delivery bike. Visible finish arches must be anchored at the actual `gatorTrack.x1` and `gatorTrack.x2` trigger coordinates and clearly identify which team owns each goal; decorative goals must never imply a different finish point.

Inspect both notebook and touch landscape layouts. Classic must keep the whole arena readable; XXL must follow the local player. The mobile joystick stays on the right and action buttons on the left. Each fresh jump press flaps once for Queens and Warriors; holding does not repeat. Bots generate the same press/release inputs and obey the same cooldown, gravity and collision rules. Background decoration must not intercept input.

## Room protocol

Creation and quick-play messages accept `mapId`. Quick play matches both city and size. Room listings, `joined.room` and snapshots include `mapId`, `mapName` and `mapRevision`.

Only the current host can send `{ type: 'map', mapId }`, and only in a waiting lobby. The server rebuilds navigation and geometry, resets the waiting round and respawns the existing crew while preserving teams, roles, bot count and difficulty. Every peer receives one `{ type: 'map-changed', map, mapId, mapName, mapRevision, players }` packet followed by current state. The client must replace its map, reset prediction and held inputs, and refresh its renderer without changing the room URL. Full geometry is not repeated in 20 Hz snapshots. Countdown, live play and results reject map changes; return to the next-round lobby first.

## Validation before marking available

1. Run `node --test test/map-catalog.test.mjs test/map-selection.test.mjs`. These checks cover deterministic and distinct geometry, proportional stock, all supply routes, machine access, ordinary and upgraded worker movement, map authority, lobby propagation, active-round locking and city-aware matchmaking.
2. Run the full `npm test` suite and format only changed files with Prettier.
3. Use `scripts/map-smoke.mjs` against a fresh local server and the deployment. Test both Classic and XXL with two connected clients. A single browser preview does not verify multiplayer propagation.
4. Inspect the workshop and real rooms in the browser. Capture Classic, an XXL camera view, themed Queens and rides, lobby selection and a victory screen.
5. For meaningful geometry changes, repeat unopposed delivery measurements and natural bot rounds. Report their limits: a deterministic route is not a promise about match duration, and bot simulations are not 120 physical players.

## Arcade flight reference

The official [Killer Queen how-to](https://killerqueenarcade.com/howtoplay) gives flight to Queens and upgraded Warriors, and a downward dive to Queens. Developer BumbleBear’s [release notes](https://bumblebeargames.com/blogs/news/changelogs) explicitly describe the “tap to flap” prompt. RoboQueen follows that press-based interaction; its numeric speeds and cooldowns are game-specific, not a claim to reproduce unpublished arcade constants.

A valid fresh press applies the existing upward speed of 430 px/s for a Queen or 390 px/s for a Warrior, with respective minimum intervals of 190 and 220 ms. Presses during the cooldown or a Queen dive are consumed immediately. They never queue a later flap. Network input retains a single rising edge until the next physics step so a complete rapid tap is not lost; lifecycle resets discard it. Client prediction uses the same edge buffering and movement function.

The first-person [KQPDX player guide](https://killerqueenpdx.squarespace.com/blog/how-to-play) also documents variable worker jump height, above-and-facing military contact, nonlethal bumps and screen wrapping. RoboQueen implements release-shortened worker jumps, height-and-facing sword contact, downward Queen dives and bounded opposing-player bumps that can interrupt AI1 installation. Friendly players pass through each other, and a crowd cannot accumulate enough push to stop a player walking away. The guide describes observed rules, not the arcade’s internal physics constants.

Deliberate adaptation: these themed maps have closed ends, finish arches and an XXL following camera; they do not wrap around. The exact arcade gravity, acceleration, friction and jump values were not published in the official sources reviewed. RoboQueen retains its tuned movement values and does not claim bit-identical arcade physics. The operator manual covers installation and service rather than those simulation parameters.

Nonlethal bump velocity is authoritative. Legacy player objects include `bumpVx`; compact-v1 retains its original 34-field tuple and sends active impulses in the sparse snapshot `bumps` extension. Current clients restore missing entries to zero and use shared decay during prediction. Respawns and new rounds clear the impulse.
