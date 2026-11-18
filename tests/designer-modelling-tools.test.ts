import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyHistory, record, redo, undo } from '../src/client/designer/modelling/history.js';
import { MODEL_TOOLS, parseValueBox, toolForKey } from '../src/client/designer/modelling/tools.js';

test('value box reads numbers, semicolons and a decimal comma', () => {
  assert.deepEqual(parseValueBox('750'), [750]);
  assert.deepEqual(parseValueBox(' 1200 ; 600 '), [1200, 600]);
  assert.deepEqual(parseValueBox('12,5'), [12.5]);
  assert.deepEqual(parseValueBox('-25 mm'), [-25]);
  assert.deepEqual(parseValueBox('45°'), [45]);
  assert.equal(parseValueBox(''), undefined);
  assert.equal(parseValueBox('1200;'), undefined);
  assert.equal(parseValueBox('abc'), undefined);
});

test('every tool has its own single-key shortcut', () => {
  const keys = MODEL_TOOLS.map(tool => tool.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(toolForKey('P'), 'pushpull');
  assert.equal(toolForKey('r'), 'rect');
  assert.equal(toolForKey('c'), 'circle');
  assert.equal(toolForKey('v'), 'polygon');
  assert.equal(toolForKey(' '), 'select');
  assert.equal(toolForKey('x'), undefined);
  assert.equal(MODEL_TOOLS.find(tool => tool.id === 'circle')?.label, 'Kreis');
  assert.equal(MODEL_TOOLS.find(tool => tool.id === 'polygon')?.label, 'Vieleck');
});

test('undo history: one step per record, tagged edits merge within a moment', () => {
  let history = record(emptyHistory<string>(), 'a', undefined, 0);
  history = record(history, 'b', 'panel', 10);
  history = record(history, 'c', 'panel', 500);
  assert.deepEqual(history.past, ['a', 'b']);
  history = record(history, 'd', 'panel', 5000);
  assert.deepEqual(history.past, ['a', 'b', 'd']);

  const back = undo(history, 'e')!;
  assert.equal(back.value, 'd');
  assert.deepEqual(back.history.future, ['e']);
  const forward = redo(back.history, back.value)!;
  assert.equal(forward.value, 'e');
  assert.deepEqual(forward.history.past, ['a', 'b', 'd']);
  assert.equal(undo(emptyHistory<string>(), 'x'), undefined);
  assert.equal(redo(emptyHistory<string>(), 'x'), undefined);
});
