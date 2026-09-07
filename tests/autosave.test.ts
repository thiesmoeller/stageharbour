import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Autosave, SaveConflict, type SaveState } from '../src/client/editor/autosave.js';
import { newWall, type Layout } from '../src/shared/layout.js';

const empty: Layout = { schemaVersion: 1, walls: [], braces: [] };
const placed: Layout = { schemaVersion: 1, walls: [newWall(randomUUID(), 1000, 2000)], braces: [] };
function waitFor(saver: Autosave, status: SaveState['status']) {
  if (saver.getSnapshot().status === status) return Promise.resolve();
  return new Promise<void>(resolve => {
    const unsubscribe = saver.subscribe(() => { if (saver.getSnapshot().status === status) { unsubscribe(); resolve(); } });
  });
}
test('in-flight saves serialize later edits and undo, with the acknowledged revision', async () => {
  const calls: { layout: Layout; revision: number; resolve: (revision: number) => void }[] = [];
  const saver = new Autosave(empty, 7, (layout, revision) => new Promise(resolve => calls.push({ layout, revision, resolve })), 0);
  saver.queue(placed);
  await waitFor(saver, 'saving');
  saver.queue(empty); // Undo while the creation is being persisted.
  assert.equal(calls.length, 1);
  calls[0]!.resolve(8);
  await waitFor(saver, 'pending');
  await waitFor(saver, 'saving');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1]!.layout, empty);
  assert.equal(calls[1]!.revision, 8);
  calls[1]!.resolve(9);
  await waitFor(saver, 'saved');
  assert.equal(saver.getSnapshot().dirty, false);
  saver.dispose();
});
test('failed saves retain the latest draft and retry; conflicts never automatically overwrite', async () => {
  let fail = true;
  const saved: Layout[] = [];
  const saver = new Autosave(empty, 0, async layout => { if (fail) throw new Error('offline'); saved.push(layout); return 1; }, 0);
  saver.queue(placed); await waitFor(saver, 'failed');
  saver.queue(empty);
  assert.equal(saver.getSnapshot().dirty, true);
  fail = false; saver.retry(); await waitFor(saver, 'saved');
  assert.deepEqual(saved, [empty]);
  saver.dispose();
  let attempts = 0;
  const conflicted = new Autosave(empty, 0, async () => { attempts++; throw new SaveConflict(); }, 0);
  conflicted.queue(placed); await waitFor(conflicted, 'conflict');
  conflicted.queue(empty); conflicted.retry();
  assert.equal(attempts, 1); assert.equal(conflicted.getSnapshot().status, 'conflict');
  assert.equal(conflicted.getSnapshot().dirty, true);
  assert.equal(conflicted.getSnapshot().conflictKind, 'revision');
  conflicted.dispose();
  const lost = new Autosave(empty, 0, async () => { throw new SaveConflict('lease'); }, 0);
  lost.queue(placed); await waitFor(lost, 'conflict');
  assert.equal(lost.getSnapshot().conflictKind, 'lease');
  assert.equal(lost.getSnapshot().dirty, true);
  lost.markConflict('lease'); lost.retry();
  assert.equal(lost.getSnapshot().status, 'conflict');
  lost.dispose();
});
