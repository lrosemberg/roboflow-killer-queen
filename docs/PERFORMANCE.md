# Performance measurements

Local measurements on November 5, 2026 kept the 120-player simulation near 60 Hz. In the dense human-client fixture, packet optimizations reduced server CPU use by 28.5% and snapshot callback p95 time by 53%. Sprite caching reduced renderer CPU p95 time from 2.3 ms to 1.6 ms in a separate 120-character browser scene.

The local comparisons below are short synthetic tests on an **Apple M3 Max desktop**, not evidence from 120 physical laptops or a real mobile device. A separate public Railway test completed 120 connections for 60 seconds, but exposed substantial latency spikes, documented below. Each local comparison contains one run per configuration; percentages describe those observations, not confidence bounds or guaranteed headroom.

## Local server comparison

The server ran on macOS with Node 24.15.0, separately from the client-generator process. All clients requested `compact-v1` snapshots with `permessage-deflate`. Tests used the current 7,200 × 1,600 XXL layout, filled its 24 Queen seats through the lobby protocol, and measured after countdown and warm-up.

- **Distributed:** 120 synthetic human clients placed across the map once, then moved with ordinary inputs. Workers also jumped. Median visibility was 26 players per snapshot in both runs.
- **Dense:** 120 synthetic human clients placed together once, then moved on the ground. All 120 remained alive and visible. This is the strongest controlled comparison of packet work.
- **Bots:** one human client and 119 ordinary bots, using natural spawns and AI. The match was allowed to finish normally.

Values below are **before → after** packet optimization. CPU is average cores consumed by the server process; 0.220 means roughly 22% of one local core. RSS is peak sampled resident memory.

| Scenario           | CPU cores     | RSS, MiB      | Active tick p95, ms | Snapshot callback p95, ms | Received wire kbps/client |
| ------------------ | ------------- | ------------- | ------------------- | ------------------------- | ------------------------- |
| 120 distributed    | 0.228 → 0.226 | 256.7 → 190.4 | 0.394 → 0.441       | 1.416 → 1.420             | 107.4 → 99.3              |
| 120 dense          | 0.307 → 0.220 | 285.7 → 242.8 | 0.406 → 0.431       | 2.336 → 1.097             | 413.1 → 381.4             |
| 1 human + 119 bots | 0.288 → 0.218 | 128.3 → 128.4 | 3.368 → 2.805       | 1.116 → 0.494             | 69.2 → 63.8               |

Both human scenarios ran for the full 60 seconds before and after, at approximately 60 simulation ticks and 19.7 snapshots per client per second, with zero skipped snapshots. The optimized dense run used 28.5% less CPU, 15% less sampled peak RSS, and 7.7% less wire bandwidth. Its snapshot p99 fell from 2.475 ms to 1.525 ms. Distributed snapshot p95 was effectively unchanged; its bandwidth fell 7.6%.

The baseline bot run reached the 60-second cap; the optimized bot match ended naturally after **58.994 seconds**, still at approximately 60 Hz with zero skipped snapshots. Combat and visibility differed: median visible players changed from 22 to 13, and median alive players from 116 to 120. **Do not attribute the bot deltas solely to optimization**, or call the second run a completed 60-second sustained test.

The changes measured were wire velocity rounding without changing authoritative physics, one-pass supply-pile counting, serialization of only requested encodings, and reuse of identical encoded snapshots within one broadcast. Simulation rates, visibility rules, and gameplay physics stayed the same.

### What the timing includes

Active tick timing divides a callback's duration by the fixed simulation steps it performed. Snapshot timing covers serialization and queueing, but excludes asynchronous compression. Process CPU includes native compression work. RSS was sampled every 200 ms.

Local application ping also includes decoding up to 120 clients in one generator process. It is not an estimate of player internet latency. These fixtures do not measure browser rendering or long-running stability.

**Dense bandwidth remains substantial:** 381.4 kbps × 120 clients is approximately **46 Mbps of server-to-client traffic**, before external transport overhead. A host's CPU and memory limits alone do not establish network capacity or egress cost. The distributed fixture received approximately 12 Mbps in total.

## Renderer comparison

The separate browser fixture used New York, **120 visible together**, a 1,366 × 768 viewport at device-pixel ratio 1, and a 1,366 × 522 canvas. Each mode had two seconds of warm-up and ten seconds of measurement, producing 1,201 samples.

| Metric                   | Direct drawing | Cached sprites |
| ------------------------ | -------------- | -------------- |
| Renderer CPU p50         | 2.1 ms         | 1.1 ms         |
| Renderer CPU p95         | 2.3 ms         | 1.6 ms         |
| Renderer CPU maximum     | 2.6 ms         | 2.0 ms         |
| Observed frame rate      | 119.98 fps     | 119.99 fps     |
| Frame interval p95       | 9.8 ms         | 8.9 ms         |
| Frames longer than 50 ms | 0              | 0              |

Both final frames reported 120 visible and drawn characters. Cached rendering lowered CPU p95 by approximately 30%; the observed frame rate stayed near the desktop's 120 Hz cadence. The bounded cache reached 192 entries, with an estimated 9 MiB of pixel storage. That estimate excludes additional browser overhead.

This fixture uses the real renderer, synthetic character motion, and periodic state updates. Renderer CPU time excludes final GPU presentation. It does not include a live game's full network/UI workload and does not prove performance on phones or lower-powered laptops.

## Repeat the measurements

From the repository root, install dependencies with `npm ci`. Run these server fixtures **sequentially** so they do not compete for the same machine:

```sh
PLAYERS=120 DURATION_MS=60000 SCENARIO=distributed node scripts/load-test.mjs scripts/performance-local-distributed.json
PLAYERS=120 DURATION_MS=60000 SCENARIO=dense node scripts/load-test.mjs scripts/performance-local-dense.json
PLAYERS=120 DURATION_MS=60000 SCENARIO=bots node scripts/load-test.mjs scripts/performance-local-bots.json
```

The harness starts and closes its own isolated local server. Reports record source hashes, duration, natural match completion, CPU/RSS, timing percentiles, protocol, visibility and input checks. `DURATION_MS` accepts 2–120 seconds; a natural victory can shorten a bot run. These commands measure the currently checked-out source, not an automatically restored historical baseline.

For rendering, run `npm start`, open [the local performance lab](http://localhost:8787/performance-lab.html), and set the viewport to 1,366 × 768 at DPR 1. Choose **New York**, **120 visible together**, and **Direct sprites**, then run the sample. Repeat with **Cached sprites** in the same foreground browser and copy the JSON results. Record device, browser, viewport and refresh conditions when comparing other machines.

The recorded local artifacts were `scripts/performance-baseline-summary.json`, `scripts/performance-after-summary.json`, their six raw scenario reports, `scripts/render-direct-final.json`, and `scripts/render-cached-final.json`. Generated JSON reports are ignored by Git; this document preserves the measured results. Server source SHA-256 prefixes were `df565852403f` before and `5145f7736d3e` after. Source hashes were stable during each run and consistent across scenarios within each version.

## Railway production test: release 1.2.0

Release **1.2.0**, source commit `1381faabc5ae9324d6c8c6eeb799350961e0f693`, was tested on the [public Railway service](https://roboflow-killer-queen.up.railway.app/). Deployment `1becd5ff-4ec6-4075-a458-da30132d8b34` reported `SUCCESS`; served asset hashes matched the source. The configured limits were **1 vCPU, 1,000,000,000 bytes of RAM, one replica, US East** (`us-east4-eqdc4a`). This verifies the service configuration, not the account's billing-plan name.

Separate local and public map checks passed all ten destination/size combinations with two synchronized clients, host-only map selection, active-round map-change rejection, and movement checks. These are functional checks, separate from the load measurements.

### First 120-client, 60-second run

The first public run began at 06:42 UTC on November 5, 2026. It used 120 synthetic clients from one machine/network, `compact-v1` over WSS with compression, ordinary spawns and inputs, and a private XXL room with no bots. All clients moved, received input acknowledgements, remained connected and left cleanly. The 121st client was rejected as full.

| Metric                           | Observed result                  |
| -------------------------------- | -------------------------------- |
| Measured duration                | 60.000 seconds                   |
| Lowest observed simulation rate  | 59.95 Hz                         |
| Mean snapshots/client/second     | 19.96; minimum 19.95             |
| Received snapshots               | 143,746                          |
| Server skipped-snapshot counter  | 0 → 36                           |
| Application RTT p50 / p95 / p99  | 35.71 / **915.64** / 1,351.35 ms |
| Maximum application RTT          | **3,504.51 ms**                  |
| Snapshot gap p95 / p99 / maximum | 56.22 / 155.17 / 2,797.39 ms     |
| Received wire traffic            | 102.1 kbps/client average        |

This passed the connection, movement and sustained-throughput checks; it **does not certify low or zero lag**. Average snapshot delivery conceals significant pauses, and the original high-latency result is retained rather than replaced by a better later sample. The 36 server skips are a server counter change, not a measured packet-loss rate.

Railway's available 30-second busy-period CPU samples were **0.323 and 0.260 cores** against the 1-core limit. The largest reported memory sample was **0.110 GB** (about 110.2 MB / 105.1 MiB). These are coarse samples, not instantaneous peaks. HTTP observations of the latest snapshot callback had a 3.32 ms p95 across 29 samples; they are not percentiles of every callback. Available measurements show no sustained application-server CPU saturation, but cannot exclude brief unobserved stalls.

### Follow-up latency diagnosis

A separate 20-second, 120-client diagnostic run instrumented the generator and ran an independent idle WebSocket probe in another process. That probe joined no room and received no game-state stream. The diagnostic run also completed its throughput checks, with RTT p50 / p95 / p99 of 34.58 / 393.75 / 1,160.13 ms; this shorter run does not replace the first result.

- At 06:47:53 UTC, the generator and independent probe both showed hundreds-of-milliseconds delays. At 06:47:59, they reached approximately 1.34 and 1.03 seconds respectively.
- The idle probe also recorded a 1.42-second delay after the load generator had finished. The large tail therefore was not confined to the load generator's own decoding work.
- Generator event-loop delay never exceeded 21.4 ms in the recorded samples. Its maximum inflate queue wait was 25.2 ms and maximum inflate service time 12.7 ms, far below the observed RTT spikes.
- HTTP health requests during the diagnostic match took 34.8–57.9 ms, including requests near the WebSocket spikes; the first pre-match request took 122.2 ms.

These observations are **consistent with delay along the shared WebSocket delivery path**, rather than generator decoding alone. That is an inference, not a localized cause: one client origin cannot distinguish its network link, internet route, proxy/edge, or server-side WebSocket handling. It does not establish that changing hosting providers or adding CPU would remove the spikes.

A later 15-second idle sample had RTT p50 33.56 ms, p95 35.83 ms and maximum 170.61 ms across 74 replies. This confirms variability; it does not erase the earlier multi-second pauses. Longer tests from independent origins and physical devices remain necessary before claiming consistently low latency.

All load/diagnostic sockets were closed. The final 06:50:41 UTC health check showed no rooms, one unrelated existing browser connection, and version 1.2.0. Recorded artifacts are `scripts/release-1.2.0-public-120-load.json`, `release-1.2.0-railway-load-metrics.json`, `release-1.2.0-public-120-diagnostic-load.json`, `release-1.2.0-generator-diagnostics.json`, `release-1.2.0-independent-ping-probe.json`, `release-1.2.0-latency-correlation.json`, `release-1.2.0-idle-ping-probe.json`, `release-1.2.0-public-hashes.json`, and `release-1.2.0-deployment-summary.json`, all under `scripts/` and ignored by Git.

### Repeat a public-route test

Keep one process/replica: rooms live in memory, and independent replicas do not share them. Scaling horizontally requires room-aware routing/state ownership first.

A controlled staging or authorized production test can use the following commands after deployment. Replace the example host with the intended service:

```sh
node scripts/internet-smoke.mjs https://your-game.example
PLAYERS=120 DURATION_MS=60000 RAMP_BATCH_SIZE=12 RAMP_PAUSE_MS=100 node scripts/remote-load-test.mjs https://your-game.example scripts/performance-remote.json
```

The remote harness creates its own private room, joins through the public protocol, starts from ordinary spawns, sends inputs, and leaves afterward. It does not teleport players or control their distribution. Its HTTP timing samples are observations of the latest callback every two seconds, not full callback percentiles. Collect Railway CPU/RSS and network metrics over the same interval, plus actual player measurements in the intended regions. A successful short synthetic run still does not certify sustained 120-device play.
