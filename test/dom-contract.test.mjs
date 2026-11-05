import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [app, html] = await Promise.all([
  readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
]);

function referencedIds(source) {
  return new Set(
    [...source.matchAll(/(?<!\$)\$\(\s*(['"])#([\w-]+)\1\s*\)/g)].map((match) => match[2]),
  );
}
function declaredIds(source) {
  return [...source.matchAll(/\bid\s*=\s*(['"])([\w-]+)\1/g)].map((match) => match[2]);
}

// These elements are created synchronously during app startup. Keep the list
// explicit so a missing HTML target cannot be excused by an unrelated JS string.
const dynamicIds = new Map([
  ['create-bot-count', 'Create-room bot slider replaces the legacy checkbox.'],
  ['bot-count-label', 'Output for that slider.'],
  ['bot-count-max', 'Maximum for that slider.'],
  ['create-economy-preview', 'Economy preview beside that slider.'],
  ['host-bots-control', 'Host menu bot controls container.'],
  ['current-bot-count', 'Current count in the host controls.'],
  ['menu-bots', 'Bot count input in the host controls.'],
  ['apply-bots', 'Apply button in the host controls.'],
  ['menu-difficulty-description', 'Description in the host difficulty picker.'],
  ['swap-role', 'Role-guide button appended to the player card.'],
]);

test('every literal app ID lookup has a unique HTML target or a documented dynamic creation', () => {
  const references = referencedIds(app);
  const staticIds = declaredIds(html);
  const staticSet = new Set(staticIds);
  const generatedIds = new Set(declaredIds(app));
  assert.equal(staticSet.size, staticIds.length, 'HTML IDs must be unique');
  for (const [id, purpose] of dynamicIds) {
    assert.ok(references.has(id), `Remove stale dynamic exception: ${id}`);
    assert.ok(generatedIds.has(id), `Missing dynamic creation: ${id} (${purpose})`);
    assert.ok(!staticSet.has(id), `Remove dynamic exception now that ${id} is in HTML`);
  }
  const missing = [...references].filter((id) => !staticSet.has(id) && !dynamicIds.has(id));
  assert.deepEqual(missing, [], `Missing app render targets: ${missing.join(', ')}`);
});

test('every victory render target exists inside the results dialog before any round ends', () => {
  const resultsMarkup = html.match(
    /<dialog\b[^>]*\bid="results-dialog"[^>]*>[\s\S]*?<\/dialog>/,
  )?.[0];
  const resultsCode = app.match(
    /function showResults\(\) \{[\s\S]*?\nfunction renderVictoryScene/,
  )?.[0];
  assert.ok(resultsMarkup, 'Results dialog must exist');
  assert.ok(resultsCode, 'Victory renderer must exist');
  const available = new Set(declaredIds(resultsMarkup));
  const missing = [...referencedIds(resultsCode)].filter((id) => !available.has(id));
  assert.deepEqual(missing, [], `Missing victory targets: ${missing.join(', ')}`);
});
