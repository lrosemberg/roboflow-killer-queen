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

## Connection resilience: release 1.3.0

This release addresses failure recovery as well as capacity. Inputs are sent on transitions plus a 250 ms active keepalive; the browser retains at most 24 short transitions, stops queueing above 4 KiB of socket backlog, and replaces a transport stalled for 250 ms instead of replaying old controls. Lobby/results do not periodically send blank input. An eight-second handshake or state watchdog replaces a stalled connection, with bounded retry delay. A tab displaced by another tab stops automatically reconnecting.

A private 256-bit session capability reserves a disconnected player's seat for 15 seconds. It remains stable during recovery so a lost resume response cannot strand the player, and is invalidated on explicit leave or expiry. The same player object is restored, including current role, lives, scores and upgrades. Inputs are cleared and the character remains vulnerable during the interruption; the world continues. These are in-memory sessions, not persistence across server restarts.

Live state remains authoritative and replaceable. Each room retains the latest 256 activity events with per-client acknowledgement and duplicate suppression before visual/audio effects. A prolonged gap can exceed that bounded history: the latest scores, lives and map recover, but the entire historical activity feed is not guaranteed. A congested critical control message closes the transport for full room/map resynchronization instead of silently discarding it. Idle room snapshots run at 4 Hz; live gameplay stays at 20 Hz with 60 Hz physics.

### Failure-injection checks

The isolated `network-resilience-test.mjs` completed all eight phases with **120 actual localhost WebSocket connections**. It recovered 24 role events after deliberately skipping snapshots, resumed full map geometry after a synthetic 300 KiB control backlog, preserved three reconnecting identities while rejecting a 121st player, released exactly one expired reservation, and recovered after an oversized input burst was deliberately rejected by the abuse limit. All 120 clients moved through acknowledged inputs. The final cleanup removed every test seat and room.

The test uses deterministic application delivery/backpressure shims, not actual TCP packet loss. Its 4.215-second run shares one process between server and generator, so its approximately 60 Hz observation is **not a capacity benchmark**. Reported snapshot skips mostly come from the injected control failure; they are not a packet-loss rate. Separate server regressions verify that a disconnected Queen can lose a life normally and resume that current defeated state.

### Browser recovery with a full room

A desktop browser joined a private XXL Brazil room alongside 119 synthetic WebSocket clients. Both reloading the tab and deliberately withholding its state/pong messages recovered the same player ID, team, role and three lives, with 120 seats preserved. The stale-open-connection test suppressed 164 messages; the browser replaced its transport after approximately **8.08 seconds** and resumed with a monotonically increasing input sequence. The UI returned to the running match without a stuck connection overlay or captured console errors. This tests one browser against synthetic peers, not 120 physical devices.

### Sustained local protocol check

A separate pre-release test ran 120 ordinary clients for **60 seconds**, using the same bounded input helper as the browser. All moved, received acknowledgements, remained connected and left cleanly; the 121st client was rejected. The lowest observed simulation rate was **59.97 Hz**, with **19.86 snapshots/client/second** on average. Input traffic averaged **4.19 messages/client/second**, compared with the previous fixed 30 Hz sender. This is a reduction in command count, not a claim of the same percentage reduction in total network bandwidth.

Local RTT p95 was 9.04 ms; snapshot gap p95 was 52.95 ms and the maximum was 67.31 ms. Received wire traffic averaged 96.79 kbps/client. The process loaded package metadata before the version bump, so that local report's health endpoint says 1.2.1; the tested server contained the new recovery implementation. These localhost measurements cannot predict public-route latency. The prior public latency spikes above remain relevant until measured again.

Reproduce the fault checks with:

```sh
node scripts/network-resilience-test.mjs scripts/network-resilience-report.json
```

The reports are `scripts/network-resilience-final.json`, `scripts/release-1.3.0-browser-recovery.json`, and `scripts/release-1.3.0-local-120-load.json`. They are ignored by Git. The fault report records stable source hashes. The browser QA server and its 119 synthetic clients were shut down after verification.

### Public 120-client result and latency investigation

Deployment `500e9e91-71c4-4ea6-bd29-a12f4232dd78` served 1.3.0 from commit `153c980`; public hashes matched the local app, network helpers, stylesheet and HTML. A public **120-second** run starting at 17:08:18 UTC completed all connection/movement/cleanup checks: all 120 clients moved and received acknowledgements, the 121st was rejected, physics stayed near **59.98 Hz**, and snapshots averaged **19.90/client/second**. Input traffic was **4.18 messages/client/second** and received wire traffic **100.02 kbps/client**.

**Latency was unacceptable in that run.** Application RTT was 65.96 ms median, **6,586.67 ms p95**, and **16,684.19 ms maximum**. Snapshot gaps were 113.09 ms p95 and 2,651.47 ms maximum. Regular snapshot spacing does not prove that the snapshots themselves are fresh. The test originally lacked input acknowledgement timing and snapshot-age drift, so those extreme RTT values cannot retrospectively be localized to one direction or interpreted as exact movement delay. This failed latency result is retained separately from its successful capacity checks.

The highest available 30-second Railway CPU sample was **0.575 cores**, with **0.1154 GB** memory, under the configured one-core/1 GB limits. These coarse trailing-hour summaries include startup/ramp/cleanup and are not instantaneous peak measurements. There was no evidence of sustained CPU or memory saturation sufficient to justify claiming that buying more resources would fix the delay.

An instrumented 30-second repeat from 17:15:09 UTC used the same deployed source and recorded input acknowledgement RTT, relative snapshot age and generator event-loop delay. It observed RTT p95 **88.57 ms**, input acknowledgement p95 **130.50 ms** (maximum 590.35 ms), and relative snapshot-age drift p95 **4.65 ms**. Generator event-loop p95 was 11.26 ms, maximum 21.32 ms. It processed almost the same decoded bytes per second as the poor run. This shorter result demonstrates variability; it does **not** replace the poor two-minute result or establish reliable low latency.

Independent two-socket probes ran in a separate process. Before load, with zero rooms, both WebSocket variants simultaneously reached approximately 1.41-second RTT and HTTP reached 1.54 seconds, while probe event-loop maximum was 16.8 ms. A probe overlapping mainly the join ramp had WebSocket p95 409–433 ms; the final probe ran **after** load, again with zero rooms, and saw 842–919 ms WebSocket peaks. These correlated idle delays support a shared delivery-path problem, but do not identify whether it is the client network, internet route, Railway edge, or other shared processing. No claim is made that moving provider will resolve it.

The 1.3.0 event counters included lobby/setup: 2.29 million duplicate event entries versus 56,700 processed entries in the long public run, compared with only two duplicates locally. Delayed ACKs amplified retransmission on the same ordered WebSocket stream. The subsequent patch sends each event once per live transport and replays unprocessed history on resume. This removes avoidable redundancy; it is not presented as a fix for the observed external latency variability.

The remote harness now reports a separate latency budget (p95 input acknowledgement/RTT ≤200 ms and snapshot gap ≤150 ms), input acknowledgement ages, relative snapshot-age drift, event-loop delay, timestamped pings and explicitly scoped event counters. Its functional `success` flag alone must not be used as a low-lag certification.

Artifacts: `scripts/release-1.3.0-public-120-load.json`, `release-1.3.0-public-120-diagnostic.json`, `release-1.3.0-public-verification.json`, `release-1.3.0-metrics-summary.json`, and the three `release-1.3.0-independent-*-probe.json` reports. The file named `independent-steady-probe` records **post-load idle** in its metadata; it did not overlap sustained load. All diagnostic clients closed afterward.

## Final validation: release 1.3.1

Deployment `b65b920d-9e92-444d-ae56-79216a07e4c2` published source commit `54e9de2`. Public asset hashes and health version matched. **185 tests passed**, including input-ack age recovery, and local/public two-client checks passed all ten destination/size combinations. The updated isolated 120-client fault harness passed nine phases, including an event intentionally left unprocessed, no repeated delivery over subsequent live states, and recovery of that event after a same-player resume.

The browser now treats an active command unacknowledged for two seconds as a stalled transport even if snapshots continue arriving. Tracking is bounded and clears for inactive/dead/countdown/modal states and session replacement. This prevents continuing indefinitely on an ordered backlog; it does not erase latency or freeze the world during recovery.

The final public run started at **17:26:37 UTC on November 5, 2026** and measured **120 seconds** with 120 synthetic clients, ordinary spawns/inputs and no bots. All moved, received acknowledgements, stayed connected and explicitly left; the 121st was rejected. Its separate functional and latency outcomes were:

| Measure                                       | Result                                       |
| --------------------------------------------- | -------------------------------------------- |
| Functional capacity/recovery checks           | Passed                                       |
| Measured latency budget                       | **Failed**                                   |
| Simulation rate                               | Approximately 60 Hz                          |
| Snapshots/client/second                       | 19.97 average; 19.96 minimum                 |
| Snapshot skips during measured match          | **0** (counter stayed at 40 after join ramp) |
| Input messages/client/second                  | 4.18                                         |
| Input acknowledgement RTT p50 / p95 / maximum | 93.02 / **362.91** / **2,354.53 ms**         |
| Application ping p50 / p95 / maximum          | 51.44 / **386.57** / **2,274.12 ms**         |
| Snapshot gap p95 / maximum                    | 90.95 / 1,136.75 ms                          |
| Relative snapshot-age drift p95 / maximum     | 198.77 / 1,839.88 ms                         |
| Generator event-loop p95 / maximum            | 11.35 / 16.83 ms                             |
| Event deliveries during measurement           | 66,720 aggregate; **zero repeated entries**  |
| Received wire traffic                         | 81.96 kbps/client; 140.70 MiB total          |

The final traffic sample was lower than the prior run, and duplicate event retransmissions were eliminated, but player visibility and network conditions differed. **Do not attribute the RTT improvement or entire bandwidth difference solely to this patch.** The 200 ms p95 input/RTT target still failed. The earlier 1.3.0 result with a 16.7-second maximum remains part of the evidence; no later run is used to erase it.

The CLI load clients use the browser's input queue/keepalive helper, but do **not** run its renderer, prediction or automatic input-ACK reconnect guard. They intentionally stay connected to measure raw delivery latency. Browser recovery was tested separately in the full-room fixture and real-handler regressions. Therefore this does not certify the combined experience on 120 physical phones/laptops or all networks.

Railway's trailing-hour summaries still included earlier releases, so their CPU maximum is not a release-specific peak; the latest zero-valued CPU buckets are not interpreted as zero processing cost. The largest memory sample in that window was 0.1471 GB. Public health reported active tick maximum 10.63 ms and snapshot callback maximum 9.94 ms since the deployment, neither of which measures asynchronous compression. No hardware/region change was made without evidence that it would fix the intermittent shared-path delays.

The application remains available on Railway and as a local/LAN server. **Server capacity passed this bounded test; consistently low internet latency is not yet established.** Use independent client origins and actual intended devices to localize the remaining variation rather than assuming a larger hosting plan removes it.

Final artifacts: `scripts/release-1.3.1-public-120-load.json`, `release-1.3.1-public-verification.json`, `release-1.3.1-metrics-summary.json`, `network-resilience-1.3.1.json`, and the local/public map and smoke reports. All test clients and temporary QA servers were cleaned up; the normal local game server remains available.
