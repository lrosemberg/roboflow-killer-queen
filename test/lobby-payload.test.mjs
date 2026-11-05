import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGameServer } from '../server.js';

test('120-player lobby sends a compact full roster while retaining nearby movement state', async (t) => {
  const game = createGameServer({ port: 0, host: '127.0.0.1', countdownMs: 0 });
  const { port } = await game.listen();
  t.after(() => game.close());
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const state = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Lobby snapshot timeout')), 4000);
    ws.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    ws.on('message', (bytes) => {
      const message = JSON.parse(bytes);
      if (message.type === 'welcome')
        ws.send(
          JSON.stringify({
            type: 'create',
            mode: 'xxl',
            private: true,
            botCount: 119,
            role: 'worker',
            name: 'Payload test',
          }),
        );
      if (message.type === 'state' && message.lobbyPlayers?.length === 120) {
        clearTimeout(timer);
        resolve(message);
      }
    });
  });
  assert.equal(state.status, 'waiting');
  assert.deepEqual(state.queenQuota, [12, 12]);
  assert.equal(state.lobbyPlayers.filter((player) => player.role === 'queen').length, 24);
  for (const player of state.lobbyPlayers) {
    assert.deepEqual(Object.keys(player).sort(), ['bot', 'id', 'name', 'role', 'team']);
  }
  const rosterBytes = Buffer.byteLength(JSON.stringify(state.lobbyPlayers));
  assert.ok(rosterBytes < 14000, `Lobby roster is too large: ${rosterBytes} bytes`);
  assert.ok(
    state.players.length > 1 && state.players.length < 120,
    'World state still uses the viewport interest window',
  );
  assert.equal(typeof state.players[0].x, 'number');
  assert.equal(typeof state.players[0].vy, 'number');
  t.diagnostic(
    `120-player role roster: ${rosterBytes} bytes; full recipient snapshot: ${Buffer.byteLength(JSON.stringify(state))} bytes`,
  );
  ws.terminate();
});
