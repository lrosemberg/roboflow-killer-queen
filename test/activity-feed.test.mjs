import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityFeed } from '../public/activity-feed.js';

const actor = (id, bot = false, team = 0) => ({ id, name: `Player ${id}`, bot, team });
const event = (id, type, person, extra = {}) => ({
  id,
  type,
  actor: person,
  x: 0,
  y: 0,
  amount: 1,
  ...extra,
});

test('feed keeps killer and victim identities outside the streamed roster', () => {
  const feed = new ActivityFeed(),
    killer = actor('queen', true),
    victim = actor('away', false, 1);
  const [row] = feed.consume([event(1, 'ko', killer, { target: victim })], {
    localId: 'me',
    now: 100,
  });
  killer.name = 'Changed';
  victim.name = 'Left room';
  assert.equal(row.actor.name, 'Player queen');
  assert.equal(row.target.name, 'Player away');
  assert.equal(row.target.team, 1);
});

test('resource aggregation counts each event once and never merges different actors or actions', () => {
  const feed = new ActivityFeed(),
    a = actor('a'),
    b = { ...actor('b'), name: a.name };
  feed.consume([event(1, 'pickup', a)], { now: 0 });
  let rows = feed.consume(
    [event(1, 'pickup', a), event(2, 'pickup', a), event(3, 'pickup', b), event(4, 'deposit', a)],
    { now: 500 },
  );
  assert.equal(rows.length, 3);
  assert.equal(rows.find((row) => row.actor.id === 'a' && row.type === 'pickup').count, 2);
  assert.equal(rows.find((row) => row.actor.id === 'b').count, 1);
  assert.equal(rows.find((row) => row.type === 'deposit').count, 1);
  rows = feed.consume([event(5, 'pickup', a)], { now: 3000 });
  assert.equal(rows.filter((row) => row.actor.id === 'a' && row.type === 'pickup').length, 2);
});

test('XXL resource bursts cannot hide combat or the local player and ambient cards are bounded', () => {
  const feed = new ActivityFeed();
  feed.consume(
    [event(1, 'ko', actor('enemy'), { target: actor('me') }), event(2, 'deposit', actor('me'))],
    { localId: 'me', mode: 'xxl', now: 0 },
  );
  for (let frame = 0; frame < 20; frame++) {
    feed.consume(
      Array.from({ length: 20 }, (_, i) =>
        event(3 + frame * 20 + i, 'pickup', actor(`bot-${frame}-${i}`, true)),
      ),
      { localId: 'me', mode: 'xxl', now: frame * 50 },
    );
  }
  assert.equal(feed.entries.filter((row) => row.type === 'pickup').length, 2);
  assert.ok(feed.entries.some((row) => row.id === 1));
  assert.ok(feed.entries.some((row) => row.id === 2));
  assert.ok(feed.entries.length <= 5);
});

test('feed expires quietly and clears previous round actions on the start event', () => {
  const feed = new ActivityFeed();
  feed.consume([event(1, 'pickup', actor('a'))], { now: 10 });
  assert.equal(feed.consume([], { now: 6509 }).length, 1);
  assert.equal(feed.consume([], { now: 6510 }).length, 0);
  feed.consume([event(2, 'ko', actor('a'), { target: actor('b') })], { now: 7000 });
  assert.deepEqual(feed.consume([{ id: 3, type: 'start' }], { now: 7100 }), []);
  feed.reset();
  assert.equal(feed.consume([event(1, 'pickup', actor('new-room'))], { now: 0 }).length, 1);
});
