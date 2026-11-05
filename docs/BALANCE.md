# Pacing validation — historical baseline

These measurements describe the earlier pacing release, before selectable destinations and the 12-chip minimum. Current RoboQueen rooms require `max(12, ceil(12 × participants / 10))` chips per team and have `max(60, 6 × participants)` chips in supply. The small-room samples below used five-chip goals and are retained as historical measurements, not current match-duration predictions.

The pacing update lengthens collection journeys, slows the crocodile, and adds limited objective defense. It preserved the economic target of `ceil(12 × participants / 10)`, including bots. That version required five chips per team in a four-participant room, 12 in full Classic and 144 in full XXL.

## Changes

- Classic keeps its 1,440 × 820 arena, but workers climb mirrored zig-zag ledges from central supplies to the elevated vaults. Unopposed round trips now take about 7–9 seconds instead of the shortest old routes of about 3 seconds. Pickup and deposit remain immediate, with one chip carried at a time.
- XXL stockpiles remain distributed across twelve locations, with the nearest supplies moved farther from the vaults.
- A normal-speed crocodile ride from the center to either goal takes 70 seconds. An earned speed upgrade reduces that to approximately 47 seconds. Interrupted or stolen rides retain their position.
- A bounded number of armed bots defend against approaching economic/gator victories and protect threatened Queens. Queens avoid unsafe gate approaches, retreat from unfavorable fights, and anticipate visible opponents during spawn protection. Combat eligibility and three-life rules are unchanged.

## Matched local samples

Measured on November 4, 2026 (Florida time), using ordinary bot inputs on private loopback servers. The human host stayed passive. Each before/after pair used the same bot seeds and room setup. Outcomes remain sensitive to combat and real-time scheduling; these six samples are not a promise of minimum or average human match duration.

| Participants and host role | Before            | After              |
| -------------------------- | ----------------- | ------------------ |
| 10, Queen host             | 28.5 s · Gator    | 54.5 s · Gator     |
| 10, Worker host A          | 43.6 s · Gator    | 95.0 s · Military  |
| 10, Worker host B          | 55.5 s · Military | 54.9 s · Military  |
| 4, Queen host              | 19.4 s · Economic | 38.1 s · Economic  |
| 4, Worker host             | 19.2 s · Economic | 50.1 s · Economic  |
| 10, first-room Worker host | 28.4 s · Gator    | 109.8 s · Economic |

Fast military victories remain possible. There is no artificial minimum round length, hidden invulnerability extension, or timeout winner.

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
