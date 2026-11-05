import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import WebSocket from 'ws';

// Local-only, real-time match samples. No positions, inventory, lives, bot
// decisions or room state are patched. BENCH_SOURCE_DIR can pin an immutable
// before snapshot; the same ordered scenarios produce the same botSeed roster.
// The separate runner section is a deterministic, uncontested physics route
// measurement, not a prediction of human or bot match duration.
// Examples:
// DURATION_SECONDS=180 node scripts/pacing-benchmark.mjs natural /tmp/after.json
// DURATION_SECONDS=20 node scripts/pacing-benchmark.mjs stress /tmp/stress.json
// BENCH_SOURCE_DIR=/tmp/pinned-before node scripts/pacing-benchmark.mjs runners
// BASELINE_REPORT=/tmp/before.json adds matched-seed comparisons to an after run.
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Usage: node scripts/pacing-benchmark.mjs [suite] [output.json]

Suites:
  natural       Five concurrent rooms: 3 with 9 bots, 2 with 3 bots (default).
  fresh-worker  One fresh server: passive Worker seed 1, nine bot seeds 2–10.
  runners       Fast deterministic route measurements; no live match or bots.
  stress        One XXL room: 119 bots and one passive WebSocket observer.

Environment:
  DURATION_SECONDS  Real-time cap; default 180, or 20 for stress (max 1800).
  BOT_DIFFICULTY    easy | normal | hard; default normal.
  BENCH_SOURCE_DIR  Immutable game source directory for a before run.
  BASELINE_REPORT   Prior report from the same suite/difficulty; verifies seeds.

The server is private and binds only to 127.0.0.1 on an ephemeral port.
Natural matches stop early when all rooms finish. Run stress separately from
other benchmarks to avoid sharing CPU load. The runner suite takes <1 second;
natural/fresh-worker take up to their real-time cap plus setup/cleanup.
Reports record source hashes, rosters, victories/censored matches, Queen KOs,
delivery loops, observed defensive jobs, ticks, snapshot cadence and ping RTT.
Stress represents bot simulation cost, not 120 human connections or internet.
Output defaults to a timestamped file in scripts/. Existing files are never
overwritten. Historical result files and live/public rooms are not touched.`);
  process.exit(0);
}
const source = resolve(process.env.BENCH_SOURCE_DIR || fileURLToPath(new URL('..', import.meta.url)));
const suite = process.argv[2] || 'natural';
if (!['natural', 'fresh-worker', 'runners', 'stress'].includes(suite)) throw new Error('Usage: node scripts/pacing-benchmark.mjs natural|fresh-worker|runners|stress [output.json]');
const duration = Number(process.env.DURATION_SECONDS || (suite === 'stress' ? 20 : 180));
if (!(duration > 0 && duration <= 1800)) throw new Error('DURATION_SECONDS must be between 0 and 1800');
const difficulty = process.env.BOT_DIFFICULTY || 'normal';
const load = path => import(pathToFileURL(resolve(source, path)).href);
const [{ createGameServer }, { decodeSnapshot }, world, { createNavigator }] = await Promise.all([
  load('server.js'), load('shared/protocol.js'), load('shared/world.js'), load('shared/navigation.js'),
]);
const hashes = {};
for (const path of ['server.js', ...(await readdir(resolve(source, 'shared'))).filter(path => path.endsWith('.js')).sort().map(path => `shared/${path}`)]) hashes[path] = createHash('sha256').update(await readFile(resolve(source, path))).digest('hex');
const timestamp = new Date().toISOString();
const report = {
  testedAt: timestamp, source, hashes, suite, difficulty, durationCapSeconds: duration, nodeVersion: process.version,
  benchmarkSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
  methodology: 'Private loopback server; ordinary lobby/start messages; passive human host; bots use natural inputs, physics and finite resources. Ordered room creation preserves botSeed assignments. Outcomes remain sensitive to realtime scheduling. Duration caps are right-censored, not victories. Pickup/deposit/KO times are snapshot observations (approximately 50 ms granularity); victory duration is authoritative. Runner routes are measured separately with shared physics and navigation at 60 Hz.',
};
const rounded = n => +n.toFixed(3);
function summary(values) {
  if (!values.length) return { count: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = q => sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)];
  return { count: sorted.length, min: rounded(sorted[0]), median: rounded(at(.5)), p95: rounded(at(.95)), max: rounded(sorted.at(-1)), mean: rounded(sorted.reduce((a, b) => a + b, 0) / sorted.length) };
}

function runnerRoutes() {
  const map = world.createMap('normal', 10), rows = [];
  for (const base of map.bases) for (const pile of map.berryPiles) {
    const navigator = createNavigator(map);
    const home = { x: base.door.x + base.door.w / 2 - world.PLAYER_W / 2, y: base.y + base.h - world.PLAYER_H };
    const player = { ...home, alive: true, role: 'worker', grounded: true, vx: 0, vy: 0, jumpHeld: false, carrying: false };
    let frames = 0, pickupAt = null, jumps = 0, pathLength = 0;
    const heights = new Set(), times = [], pickups = [], returns = [];
    for (let loop = 0; loop < 3; loop++) {
      const loopStart = frames;
      // Use a real chip position from this pile. Chips vary a few pixels within
      // a stockpile; this repeatable representative is not an injected pickup.
      const chip = map.berrySpawns.find(berry => berry.pileId === pile.id);
      const target = { x: chip.x - world.PLAYER_W / 2, y: chip.y - 20 };
      let delivered = false;
      while (frames - loopStart < 60 * 90) {
        const input = navigator.steer(player, player.carrying ? home : target);
        if (player.grounded) { heights.add(player.y + world.PLAYER_H); if (input.jump && !player.jumpHeld) jumps++; }
        const x = player.x, y = player.y;
        world.movePlayer(player, input, map, 1 / 60, frames * 1000 / 60);
        frames++; pathLength += Math.hypot(player.x - x, player.y - y);
        if (!player.carrying && Math.abs(player.x + 14 - chip.x) < 31 && Math.abs(player.y + 20 - chip.y) < 36) { player.carrying = true; pickupAt = frames; }
        const atDoor = player.grounded && Math.abs(player.y + world.PLAYER_H - base.y - base.h) < 3 && player.x + world.PLAYER_W / 2 >= base.door.x && player.x + world.PLAYER_W / 2 <= base.door.x + base.door.w;
        if (player.carrying && atDoor) {
          times.push((frames - loopStart) / 60); pickups.push((pickupAt - loopStart) / 60); returns.push((frames - pickupAt) / 60);
          player.carrying = false; delivered = true; break;
        }
      }
      if (!delivered) break;
    }
    rows.push({ team: base.team, pileId: pile.id, pile: { x: pile.x, y: pile.y }, speedBoost: false, completedLoops: times.length,
      loopSeconds: summary(times), outboundSeconds: summary(pickups), carryingReturnSeconds: summary(returns),
      groundedPlatformHeights: [...heights].sort((a, b) => a - b), jumps, pathPixels: rounded(pathLength), stalled: times.length !== 3 });
  }
  return { note: 'Unopposed normal-speed worker, three trips per pile and team. Actual pickup and doorway tolerances, fixed 60 Hz physics, no teleporting or speed modification. Repeat trips assume that pile still has stock. This isolates map traversal from combat and bot priorities.', rows };
}

if (suite !== 'stress') {
  const runnerStart = performance.now();
  report.unopposedRunners = runnerRoutes();
  report.runnerBenchmarkWallMs = rounded(performance.now() - runnerStart);
}
if (suite !== 'runners') {
  const scenarios = suite === 'stress'
    ? [{ name: 'xxl-119bots-queen', mode: 'xxl', hostRole: 'queen', botCount: 119 }]
    : suite === 'fresh-worker'
    ? [{ name: 'normal-9bots-fresh-worker', mode: 'normal', hostRole: 'worker', botCount: 9 }]
    : [
      { name: 'normal-9bots-queen', mode: 'normal', hostRole: 'queen', botCount: 9 },
      { name: 'normal-9bots-worker-a', mode: 'normal', hostRole: 'worker', botCount: 9 },
      { name: 'normal-9bots-worker-b', mode: 'normal', hostRole: 'worker', botCount: 9 },
      { name: 'normal-3bots-queen', mode: 'normal', hostRole: 'queen', botCount: 3 },
      { name: 'normal-3bots-worker', mode: 'normal', hostRole: 'worker', botCount: 3 },
    ];
  const game = createGameServer({ port: 0, host: '127.0.0.1', countdownMs: 0 });
  const { port } = await game.listen();
  const clients = [], rows = [], raw = new Map();
  const start = performance.now(), cpuStart = process.cpuUsage();
  let pingTimer, progressTimer;
  try {
    // Await each joined response so botSeed allocation cannot depend on the
    // arrival order of concurrent WebSocket handshakes. Matches still overlap.
    for (const scenario of scenarios) {
      const row = { ...scenario, scores: [0, 0], snapshots: 0, deliveries: [], queenKnockouts: [], pickups: 0, knockouts: 0, upgrades: 0, rides: 0, maxAbsoluteGatorProgress: 0, outcome: null };
      rows.push(row);
      const data = { intervals: [], rtts: [], bytes: 0, events: new Set(), pickups: new Map(), lastDeposit: new Map(), previousScore: new Map(), routes: new Map(), previousTime: null, lastElapsed: 0,
        strategy: null, planSamples: 0, assignedPlanSamples: 0, assignments: { gator: 0, carrier: 0 }, maxDefenders: 0, maxTeamDefenders: [0, 0], defenders: new Set(), jobs: {} };
      raw.set(row, data);
      await new Promise((resolveJoined, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?protocol=compact-v1`); clients.push(ws);
        const timeout = setTimeout(() => reject(new Error(`Join timeout: ${scenario.name}`)), 10000);
        ws.on('error', error => { row.error = error.message; clearTimeout(timeout); reject(error); });
        ws.on('message', bytes => {
          const state = decodeSnapshot(JSON.parse(bytes));
          if (state.type === 'welcome') ws.send(JSON.stringify({ type: 'create', name: scenario.name, role: row.hostRole, mode: row.mode, botCount: row.botCount, botDifficulty: difficulty, private: true }));
          if (state.type === 'error') { row.error = state.message; clearTimeout(timeout); reject(new Error(state.message)); return; }
          if (state.type === 'pong') { data.rtts.push(performance.now() - state.time); return; }
          if (state.type === 'joined') {
            clearTimeout(timeout); row.code = state.code;
            const room = game.rooms.get(state.code);
            row.initialRoster = [...room.players.values()].map(({ name, team, role, bot, botSeed }) => ({ name, team, role, bot, botSeed }));
            ws.send(JSON.stringify({ type: 'start' })); resolveJoined(); return;
          }
          if (state.type !== 'state' || state.status === 'waiting' || row.outcome) return;
          const elapsed = Math.max(0, (state.time - state.startsAt) / 1000);
          data.lastElapsed = elapsed; data.bytes += bytes.length;
          if (data.previousTime !== null) data.intervals.push(performance.now() - data.previousTime);
          data.previousTime = performance.now();
          row.snapshots++; row.scores = state.scores; row.queenLives = state.queenLives;
          row.scoreTarget = state.scoreTarget; row.resourceCount = state.resourceCount;
          row.maxAbsoluteGatorProgress = Math.max(row.maxAbsoluteGatorProgress, Math.abs(state.gator.progress));
          const room = game.rooms.get(row.code), strategy = room?.botStrategy;
          if (strategy && strategy !== data.strategy) {
            data.strategy = strategy; data.planSamples++;
            data.jobs = {};
            for (const job of strategy.jobs.values()) data.jobs[job] = (data.jobs[job] || 0) + 1;
            const teamCounts = [0, 0];
            if (strategy.defense.size) data.assignedPlanSamples++;
            for (const [id, assignment] of strategy.defense) {
              data.assignments[assignment.kind] = (data.assignments[assignment.kind] || 0) + 1;
              data.defenders.add(id); teamCounts[room.players.get(id).team]++;
            }
            data.maxDefenders = Math.max(data.maxDefenders, strategy.defense.size);
            data.maxTeamDefenders = teamCounts.map((count, team) => Math.max(count, data.maxTeamDefenders[team]));
          }
          for (const event of state.events || []) {
            if (data.events.has(event.id)) continue;
            data.events.add(event.id);
            if (event.type === 'pickup') { row.pickups++; data.pickups.set(event.actor?.id, elapsed); }
            if (event.type === 'ko') {
              row.knockouts++; data.pickups.delete(event.target?.id);
              const victim = room?.players.get(event.target?.id);
              if (victim?.role === 'queen') row.queenKnockouts.push({ seconds: rounded(elapsed), victim: event.target.name, victimBot: event.target.bot, team: event.target.team, killer: event.actor?.name, killerRole: room.players.get(event.actor?.id)?.role, remainingLives: victim.queenLives, x: rounded(event.x), y: rounded(event.y) });
            }
            if (event.type === 'upgrade') { row.upgrades++; data.pickups.delete(event.actor?.id); }
            if (event.type === 'ride') row.rides++;
          }
          for (const player of state.players) {
            if (!data.routes.has(player.id)) data.routes.set(player.id, new Set());
            if (player.grounded) data.routes.get(player.id).add(Math.round(player.y + world.PLAYER_H));
            if (player.score > (data.previousScore.get(player.id) || 0)) {
              const pickedUp = data.pickups.get(player.id), previous = data.lastDeposit.get(player.id);
              row.deliveries.push({ seconds: rounded(elapsed), player: player.name, team: player.team, score: player.score,
                pickupToDeliverySeconds: pickedUp === undefined ? null : rounded(elapsed - pickedUp),
                previousDeliverySeconds: previous === undefined ? null : rounded(elapsed - previous),
                platformHeights: [...data.routes.get(player.id)].sort((a, b) => a - b) });
              data.routes.get(player.id).clear(); data.pickups.delete(player.id); data.lastDeposit.set(player.id, elapsed);
            }
            data.previousScore.set(player.id, player.score);
          }
          if (state.status === 'ended') row.outcome = { type: state.winType, seconds: rounded(state.victory.durationMs / 1000), winner: state.winner };
        });
      });
    }
    pingTimer = setInterval(() => { for (const ws of clients) if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping', time: performance.now() })); }, 250);
    await new Promise(resolveDone => {
      let lastLog = -10;
      progressTimer = setInterval(() => {
        const elapsed = (performance.now() - start) / 1000;
        if (elapsed - lastLog >= 10) {
          lastLog = elapsed;
          console.log(JSON.stringify({ elapsed: rounded(elapsed), trials: rows.map(({ name, scores, outcome, error }) => ({ name, scores, outcome, error })) }));
        }
        if (rows.every(row => row.outcome || row.error) || elapsed >= duration) resolveDone();
      }, 1000);
    });
    clearInterval(progressTimer); clearInterval(pingTimer);
    const seconds = (performance.now() - start) / 1000;
    report.wallSeconds = rounded(seconds); report.actualTicksPerSecond = rounded(game.metrics().totalTicks / seconds);
    report.health = await fetch(`http://127.0.0.1:${port}/api/health`).then(response => response.json());
    report.cpuMs = Object.fromEntries(Object.entries(process.cpuUsage(cpuStart)).map(([key, value]) => [key, rounded(value / 1000)]));
    report.memoryMb = Object.fromEntries(Object.entries(process.memoryUsage()).map(([key, value]) => [key, rounded(value / 1024 / 1024)]));
    report.trials = rows.map(row => {
      const data = raw.get(row), observed = row.outcome?.seconds || data.lastElapsed;
      return { ...row, maxAbsoluteGatorProgress: rounded(row.maxAbsoluteGatorProgress), observedSeconds: rounded(observed), censored: !row.outcome && !row.error,
        snapshotsPerSecond: rounded(row.snapshots / Math.max(.001, observed)), snapshotIntervalMs: summary(data.intervals), pingRttMs: summary(data.rtts), decodedPayloadKbps: rounded(data.bytes * 8 / 1000 / Math.max(.001, observed)),
        strategyObservation: { supported: Boolean(data.strategy), planSamples: data.planSamples, assignedPlanSamples: data.assignedPlanSamples, objectiveAssignmentSamples: data.assignments, maxSimultaneousDefenders: data.maxDefenders, maxDefendersPerTeam: data.maxTeamDefenders, uniqueDefenders: data.defenders.size, lastJobCounts: data.jobs },
        pickupToDeliverySeconds: summary(row.deliveries.flatMap(delivery => delivery.pickupToDeliverySeconds === null ? [] : [delivery.pickupToDeliverySeconds])),
        consecutiveDeliverySeconds: summary(row.deliveries.flatMap(delivery => delivery.previousDeliverySeconds === null ? [] : [delivery.previousDeliverySeconds])) };
    });
    report.warning = suite === 'stress' ? '119 simulated bots plus one WebSocket observer. This measures server AI/simulation cost, not 120 human connections or internet latency.' : `${scenarios.length} simultaneous local room(s); passive hosts affect team strength. Natural results are a small scheduling-sensitive sample; censored matches have no measured finish time.`;
  } finally {
    clearInterval(progressTimer); clearInterval(pingTimer);
    for (const ws of clients) ws.terminate();
    await game.close();
  }
}
if (process.env.BASELINE_REPORT) {
  const before = JSON.parse(await readFile(resolve(process.env.BASELINE_REPORT), 'utf8'));
  if (before.suite !== suite || before.difficulty !== difficulty) throw new Error('Baseline suite and difficulty must match');
  report.comparison = {
    baseline: resolve(process.env.BASELINE_REPORT), baselineTestedAt: before.testedAt,
    trials: report.trials?.map(row => {
      const previous = before.trials?.find(candidate => candidate.name === row.name);
      const sameRoster = previous && JSON.stringify(previous.initialRoster) === JSON.stringify(row.initialRoster);
      if (!sameRoster) throw new Error(`Baseline roster/seed mismatch: ${row.name}`);
      return { name: row.name, matchedRosterAndSeeds: true, beforeOutcome: previous.outcome, afterOutcome: row.outcome,
        finishSecondsChange: previous.outcome && row.outcome ? rounded(row.outcome.seconds - previous.outcome.seconds) : null,
        beforeCensored: previous.censored, afterCensored: row.censored };
    }),
    runnerRoutes: report.unopposedRunners?.rows.map(row => {
      const previous = before.unopposedRunners?.rows.find(candidate => candidate.team === row.team && candidate.pileId === row.pileId);
      return { team: row.team, pileId: row.pileId, beforeMedianLoopSeconds: previous?.loopSeconds.median ?? null, afterMedianLoopSeconds: row.loopSeconds.median ?? null, stalled: row.stalled };
    }),
  };
}
const output = resolve(process.argv[3] || `scripts/pacing-${suite}-${timestamp.replaceAll(/[:.]/g, '-')}.json`);
await mkdir(dirname(output), { recursive: true });
// Never silently replace an earlier benchmark, including a named output.
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ output, suite, wallSeconds: report.wallSeconds, trials: report.trials?.map(({ name, scores, outcome, censored }) => ({ name, scores, outcome, censored })) }));
