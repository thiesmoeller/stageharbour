import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Autosave, SaveConflict, type SaveState } from '../src/client/editor/autosave.js';
import { emptyLayout, type Layout } from '../src/shared/layout.js';
import { STARTER_PART_IDS } from '../src/shared/parts/starter/index.js';

const empty: Layout = emptyLayout();
const placed: Layout = {
  ...empty,
  objects: [{
    id: randomUUID(), label: 'Wand',
    part: { id: STARTER_PART_IDS.wall, revision: 1 },
    variant: 'plain', x: 1000, y: 2000, rotation: 0,
  }],
};
test('a late save response cannot clear lease loss or restart saving', async () => {
  let finish!: (revision: number) => void;
  let calls = 0;
  const saver = new Autosave(empty, 0, () => { calls++; return new Promise(resolve => { finish = resolve; }); }, 0);
  saver.queue(placed);
  await waitFor(saver, 'saving');
  saver.queue(empty);
  saver.markConflict('lease');
  finish(1);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(saver.getSnapshot().status, 'conflict');
  assert.equal(saver.getSnapshot().conflictKind, 'lease');
  assert.equal(saver.getSnapshot().dirty, true);
  assert.equal(calls, 1);
  saver.dispose();
});
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
test('adopting a saved venue apply replaces the draft without queueing another save', () => {
  const saver = new Autosave(empty, 4, async () => 5, 0);
  saver.queue(placed);
  saver.adopt(placed, 6);
  assert.equal(saver.getSnapshot().status, 'saved');
  assert.equal(saver.getSnapshot().dirty, false);
  assert.equal(saver.getSnapshot().revision, 6);
  saver.dispose();
});
test('acknowledgeRevision bumps revision for the next flush without clearing dirty edits', async () => {
  const calls: { layout: Layout; revision: number; resolve: (revision: number) => void }[] = [];
  const saver = new Autosave(empty, 0, (layout, revision) => new Promise(resolve => calls.push({ layout, revision, resolve })), 50);
  saver.queue(placed);
  assert.equal(saver.getSnapshot().status, 'pending');
  assert.equal(saver.getSnapshot().dirty, true);
  assert.equal(saver.getSnapshot().revision, 0);
  saver.acknowledgeRevision(1);
  assert.equal(saver.getSnapshot().revision, 1);
  assert.equal(saver.getSnapshot().dirty, true);
  assert.equal(saver.getSnapshot().status, 'pending');
  await waitFor(saver, 'saving');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.revision, 1);
  assert.deepEqual(calls[0]!.layout, placed);
  calls[0]!.resolve(2);
  await waitFor(saver, 'saved');
  assert.equal(saver.getSnapshot().revision, 2);
  assert.equal(saver.getSnapshot().dirty, false);
  saver.dispose();
});
