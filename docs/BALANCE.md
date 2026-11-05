# Pacing validation

Current RoboQueen rooms require `max(12, ceil(12 × participants / 10))` chips per team and have `max(60, 6 × participants)` chips in supply. Participants include humans and bots. Rooms with up to ten participants therefore need twelve deliveries per team; a full 120-player room needs 144. The roster sets these values in the lobby, and they remain fixed throughout the round.

## Current natural-play measurements

Measured on November 5, 2026 at 00:04 Florida time (`2026-11-05T05:04:46Z`), with Normal bots on Miami Classic. Each room had one passive human host and the remaining participants were bots. The private loopback benchmark used ordinary lobby/start messages and natural movement, combat, collection and upgrades. All five rounds finished before the 180-second cap.

| Participants and host role | Chips required per team | Outcome  | Round duration | Final Purple / Sunset chips |
| -------------------------- | ----------------------- | -------- | -------------- | --------------------------- |
| 10, Queen host             | 12                      | Gator    | 54.5 s         | 0 / 6                       |
| 10, Worker host A          | 12                      | Military | 95.0 s         | 8 / 9                       |
| 10, Worker host B          | 12                      | Military | 54.9 s         | 3 / 6                       |
| 4, Queen host              | 12                      | Economic | 90.5 s         | 10 / 12                     |
| 4, Worker host             | 12                      | Economic | 104.3 s        | 0 / 12                      |

The recorded report is `scripts/roboqueen-pacing.json`; its backend source hashes matched the reviewed release. Its separate unopposed worker test completed three collection loops per pile and team using actual pickup and doorway tolerances. Route medians ranged from 6.90 to 8.62 seconds, with no stalled routes. These measurements cover Miami Classic, not natural-play match duration on every destination or XXL. All five destinations in both sizes separately pass worker navigation tests for every supply-to-HQ route and every AI1 station.

Outcomes remain sensitive to combat and real-time scheduling. These samples do not establish minimum or average human match duration. Fast military victories remain possible; there is no artificial minimum round length, hidden invulnerability extension or timeout winner.

## Changes

- Classic keeps its 1,440 × 820 arena, but workers climb mirrored zig-zag ledges from central supplies to the elevated vaults. Unopposed round trips now take about 7–9 seconds instead of the shortest old routes of about 3 seconds. Pickup and deposit remain immediate, with one chip carried at a time.
- XXL stockpiles remain distributed across twelve locations, with the nearest supplies moved farther from the vaults.
- A normal-speed getaway ride from the center to either goal takes 70 seconds on every destination and size. An earned speed upgrade reduces that to approximately 47 seconds. Interrupted or stolen rides retain their position.
- A bounded number of armed bots defend against approaching economic/gator victories and protect threatened Queens. Queens avoid unsafe gate approaches, retreat from unfavorable fights, and anticipate visible opponents during spawn protection. Combat eligibility and three-life rules are unchanged.

## Historical matched local samples

These earlier measurements predate selectable destinations and the twelve-chip minimum. That version used `ceil(12 × participants / 10)`, which required only five chips per team in four-participant rooms. Its small-room durations below are historical, not predictions for the current twelve-chip objective.

Measured on November 4, 2026 (Florida time), using ordinary bot inputs on private loopback servers. The human host stayed passive. Each before/after pair used the same bot seeds and room setup. The comparison isolates the earlier collection-route, ride-speed and bot-defense update; it does not isolate the later minimum-objective change.

| Participants and host role | Before            | After              |
| -------------------------- | ----------------- | ------------------ |
| 10, Queen host             | 28.5 s · Gator    | 54.5 s · Gator     |
| 10, Worker host A          | 43.6 s · Gator    | 95.0 s · Military  |
| 10, Worker host B          | 55.5 s · Military | 54.9 s · Military  |
| 4, Queen host              | 19.4 s · Economic | 38.1 s · Economic  |
| 4, Worker host             | 19.2 s · Economic | 50.1 s · Economic  |
| 10, first-room Worker host | 28.4 s · Gator    | 109.8 s · Economic |

## Reproduce

```sh
npm ci
npm test
node scripts/pacing-benchmark.mjs --help
node scripts/pacing-benchmark.mjs natural /tmp/pacing-natural.json
node scripts/pacing-benchmark.mjs fresh-worker /tmp/pacing-fresh.json
node scripts/pacing-benchmark.mjs runners /tmp/pacing-routes.json
DURATION_SECONDS=20 node scripts/pacing-benchmark.mjs stress /tmp/pacing-stress.json
```

Reports record source hashes, bot rosters, outcomes, delivery timing, Queen knockouts, defense assignments, simulation performance and loopback latency. The stress suite uses 119 bots and one synthetic client; it does not establish capacity for 120 internet clients or physical devices.
