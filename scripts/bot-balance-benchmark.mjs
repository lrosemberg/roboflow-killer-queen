import { writeFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { createGameServer } from '../server.js';
import { decodeSnapshot } from '../shared/protocol.js';

// Natural matches: passive human hosts and ordinary bots from their spawn.
// No position, velocity, inventory, score or life changes are made by this test.
const mode = process.argv[2] === 'xxl' ? 'xxl' : 'normal';
const difficulty = process.env.BOT_DIFFICULTY || 'normal';
const duration = Number(process.env.DURATION_SECONDS) || (mode === 'xxl' ? 15 : 120);
const trials = mode === 'xxl' ? 1 : 3;
const game = createGameServer({ port: 0, host: '127.0.0.1', countdownMs: 0 });
const { port } = await game.listen();
const started = Date.now(),
  clients = [],
  results = [];
const result = {
  testedAt: new Date().toISOString(),
  mode,
  difficulty,
  note: 'Natural local matches with passive human hosts; bots use standard inputs, physics and resources. Seed sequences are recorded. This is a balance sample, not a guarantee of human match duration.',
  trials: results,
};
for (let trial = 0; trial < trials; trial++) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?protocol=compact-v1`);
  clients.push(ws);
  const row = {
    trial,
    hostRole: trial === 0 ? 'queen' : 'worker',
    botCount: mode === 'xxl' ? 119 : 9,
    scores: [0, 0],
    snapshots: 0,
    deliveries: [],
    outcome: null,
  };
  results.push(row);
  const routes = new Map(),
    previousScores = new Map();
  let map;
  ws.on('message', (raw) => {
    const state = decodeSnapshot(JSON.parse(raw));
    if (state.type === 'welcome')
      ws.send(
        JSON.stringify({
          type: 'create',
          name: `Balance ${trial}`,
          role: row.hostRole,
          mode,
          botCount: row.botCount,
          botDifficulty: difficulty,
          private: true,
        }),
      );
    if (state.type === 'error') {
      row.error = state.message;
      return;
    }
    if (state.type === 'joined') {
      row.code = state.code;
      map = state.map;
      row.map = {
        width: map.width,
        height: map.height,
        target: map.scoreTarget,
        stock: map.berrySpawns.length,
      };
      row.botSeeds = [...game.rooms.get(state.code).players.values()]
        .filter((player) => player.bot)
        .map((player) => player.botSeed);
      ws.send(JSON.stringify({ type: 'start' }));
    }
    if (state.type !== 'state' || state.status === 'waiting' || row.outcome) return;
    row.snapshots++;
    row.scores = state.scores;
    for (const player of state.players) {
      if (!routes.has(player.id)) routes.set(player.id, new Set());
      if (player.grounded) routes.get(player.id).add(Math.round(player.y + 36));
      if (player.score > (previousScores.get(player.id) || 0)) {
        row.deliveries.push({
          seconds: +(state.elapsedSeconds + (((state.time - state.startsAt) / 1000) % 1)).toFixed(
            2,
          ),
          player: player.name,
          team: player.team,
          platformHeights: [...routes.get(player.id)].sort((a, b) => a - b),
        });
        routes.get(player.id).clear();
      }
      previousScores.set(player.id, player.score);
    }
    if (state.status === 'ended')
      row.outcome = {
        type: state.winType,
        seconds: +(state.victory.durationMs / 1000).toFixed(2),
        winner: state.winner,
      };
  });
}
await new Promise((resolve) => {
  const timer = setInterval(() => {
    const elapsed = (Date.now() - started) / 1000;
    console.log(
      JSON.stringify({
        elapsed: +elapsed.toFixed(1),
        trials: results.map(({ trial, scores, outcome }) => ({ trial, scores, outcome })),
      }),
    );
    if (results.every((row) => row.outcome || row.error) || elapsed >= duration) {
      clearInterval(timer);
      resolve();
    }
  }, 5000);
});
result.elapsedSeconds = +(Date.now() - started) / 1000;
result.health = await fetch(`http://127.0.0.1:${port}/api/health`).then((response) =>
  response.json(),
);
result.actualTicksPerSecond = +(game.metrics().totalTicks / result.elapsedSeconds).toFixed(2);
for (const row of results)
  row.snapshotsPerSecond = +(
    row.snapshots / (row.outcome?.seconds || result.elapsedSeconds)
  ).toFixed(2);
for (const ws of clients) ws.terminate();
await game.close();
await writeFile(
  process.argv[3] || `scripts/bot-balance-${mode}-result.json`,
  `${JSON.stringify(result, null, 2)}\n`,
);
console.log(JSON.stringify(result));
