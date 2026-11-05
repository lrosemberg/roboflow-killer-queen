import assert from 'node:assert/strict';
import test from 'node:test';
import { NetworkInput } from '../public/network-input.js';
import { queuePlayerInput, consumePlayerInput } from '../shared/input-buffer.js';

function fixture() {
  let time = 0,
    buffered = 0,
    open = true,
    stalls = 0;
  const sent = [];
  const channel = new NetworkInput({
    now: () => time,
    isOpen: () => open,
    bufferedAmount: () => buffered,
    send: (input) => {
      sent.push(input);
      return true;
    },
    onStall: () => stalls++,
  });
  return {
    channel,
    sent,
    get stalls() {
      return stalls;
    },
    set time(value) {
      time = value;
    },
    set buffered(value) {
      buffered = value;
    },
    set open(value) {
      open = value;
    },
  };
}

test('changed input is immediate while identical active input uses a 250ms keepalive', () => {
  const f = fixture();
  f.channel.update({ right: true });
  for (let time = 10; time < 250; time += 10) {
    f.time = time;
    f.channel.update({ right: true });
  }
  assert.equal(f.sent.length, 1);
  f.time = 250;
  f.channel.tick(true);
  assert.equal(f.sent.length, 2);
  f.time = 260;
  f.channel.update({ left: true });
  assert.equal(f.sent.length, 3);
  assert.equal(f.sent[2].left, true);
  assert.equal(f.sent[2].right, false);
  f.time = 1000;
  f.channel.tick(false);
  assert.equal(f.sent.length, 3, 'Lobby/results do not send periodic input');
});

test('brief congestion retains rapid jump/action press and release in order', () => {
  const f = fixture();
  f.buffered = 5000;
  f.channel.update({ jump: true, action: true });
  f.time = 20;
  f.channel.update({});
  assert.equal(f.sent.length, 0);
  f.time = 100;
  f.buffered = 0;
  f.channel.tick(true);
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent[0].jump, true);
  assert.equal(f.sent[1].jump, false);
  const player = {};
  for (const input of f.sent) queuePlayerInput(player, input);
  const consumed = consumePlayerInput(player);
  assert.equal(consumed.jumpPressed, true);
  assert.equal(consumed.action, true);
  assert.equal(consumePlayerInput(player).jump, false);
  assert.equal(consumePlayerInput(player).action, false);
});

test('old queued commands are discarded and trigger one recovery instead of replaying', () => {
  const f = fixture();
  f.buffered = 5000;
  f.channel.update({ right: true, jump: true });
  f.time = 251;
  f.buffered = 0;
  f.channel.tick(true);
  assert.equal(f.stalls, 1);
  assert.equal(f.sent.length, 0);
  assert.equal(f.channel.pending.length, 0);
  f.channel.tick(true);
  f.channel.update({ left: true });
  assert.equal(f.stalls, 1);
  assert.equal(f.sent.length, 0);
  f.channel.reset();
  f.channel.update({}, { reset: true, active: false });
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].reset, true);
  assert.equal(f.sent[0].jump, false);
});

test('lifecycle reset clears unsent edges and a disconnected socket cannot accumulate input', () => {
  const f = fixture();
  f.buffered = 5000;
  f.channel.update({ jump: true });
  f.time = 40;
  f.channel.update({ jump: true }, { reset: true, active: false });
  f.buffered = 0;
  f.channel.tick(false);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].reset, true);
  assert.equal(f.sent[0].jump, false);
  f.open = false;
  f.channel.update({ right: true });
  assert.equal(f.channel.pending.length, 0);
});

test('input FIFO is bounded even if transitions arrive faster than the socket drains', () => {
  const f = fixture();
  f.buffered = 5000;
  for (let i = 0; i < 30; i++) {
    f.time = i;
    f.channel.update({ jump: i % 2 === 0 });
  }
  assert.equal(f.stalls, 1);
  assert.equal(f.channel.pending.length, 0);
  assert.equal(f.sent.length, 0);
});

test('keepalive also detects a socket stuck draining without a new button press', () => {
  const f = fixture();
  f.channel.update({ right: true });
  f.buffered = 5000;
  f.time = 500;
  f.channel.tick(true);
  f.time = 751;
  f.channel.tick(true);
  assert.equal(f.stalls, 1);
  assert.equal(f.sent.length, 1);
});
