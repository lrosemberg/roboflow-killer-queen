import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapPicker } from '../public/map-picker.js';
import { MAP_CATALOG, PLAYABLE_MAPS } from '../shared/maps.js';

function fixture() {
  const document = {
    createElement(tagName) {
      return {
        tagName,
        ownerDocument: document,
        children: [],
        dataset: {},
        attributes: new Map(),
        style: { setProperty() {} },
        handlers: new Map(),
        append(...nodes) {
          this.children.push(...nodes);
        },
        replaceChildren(...nodes) {
          this.children = nodes;
        },
        setAttribute(name, value) {
          this.attributes.set(name, value);
        },
        addEventListener(type, callback) {
          this.handlers.set(type, callback);
        },
      };
    },
  };
  const container = document.createElement('div');
  const selected = [];
  const picker = createMapPicker(container, {
    name: 'test-destination',
    onSelect: (id) => selected.push(id),
  });
  const inputFor = (id) => container.children.find((card) => card.dataset.mapId === id).children[0];
  return { container, selected, picker, inputFor };
}

test('map choices are one native radio group with authoritative selected destination', () => {
  const { container, picker, inputFor, selected } = fixture();
  picker.update('san-francisco');
  assert.equal(container.children.length, MAP_CATALOG.length);
  assert.equal(container.children.filter((card) => card.children[0].checked).length, 1);
  for (const map of PLAYABLE_MAPS) {
    const input = inputFor(map.id);
    assert.equal(input.type, 'radio');
    assert.equal(input.name, 'test-destination');
    assert.equal(input.value, map.id);
    assert.equal(input.checked, map.id === 'san-francisco');
    assert.equal(input.disabled, false);
  }
  const choice = inputFor('brazil');
  choice.checked = true;
  choice.handlers.get('change')();
  assert.deepEqual(selected, ['brazil']);
  picker.update('brazil');
  assert.equal(container.children.filter((card) => card.dataset.selected === 'true').length, 1);
  assert.equal(inputFor('san-francisco').checked, false);
});

test('coming-soon destinations remain unavailable even after selection updates or forged changes', () => {
  const { picker, inputFor, selected } = fixture();
  const future = MAP_CATALOG.find((map) => map.status === 'coming-soon');
  picker.update(future.id);
  const input = inputFor(future.id);
  assert.equal(input.disabled, true);
  assert.equal(input.checked, false);
  assert.match(input.attributes.get('aria-label'), /Coming soon; not yet playable/);
  input.checked = true;
  input.handlers.get('change')();
  assert.deepEqual(selected, []);
  picker.update('miami', { disabled: false });
  assert.equal(input.disabled, true);
  assert.equal(input.checked, false);
});

test('room map browsing is read-only for guests and during rounds, and becomes selectable in the leader lobby', () => {
  const { container, picker, inputFor, selected } = fixture();
  picker.update('new-york', { disabled: true });
  assert.equal(container.dataset.readonly, 'true');
  for (const map of PLAYABLE_MAPS) assert.equal(inputFor(map.id).disabled, true);
  const choice = inputFor('singapore');
  choice.checked = true;
  choice.handlers.get('change')();
  assert.deepEqual(selected, []);
  picker.update('new-york', { disabled: false });
  assert.equal(container.dataset.readonly, 'false');
  choice.checked = true;
  choice.handlers.get('change')();
  assert.deepEqual(selected, ['singapore']);
});
