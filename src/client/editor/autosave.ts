import type { Layout } from '../../shared/layout.js';

export type SaveState = { status: 'saved' | 'pending' | 'saving' | 'failed' | 'conflict'; dirty: boolean; revision: number; conflictKind?: 'revision' | 'lease' };
export class SaveConflict extends Error {
  constructor(public kind: 'revision' | 'lease' = 'revision') { super(); }
}

/** Serializes saves and retains edits made while an earlier request is in flight. */
export class Autosave {
  private saved: string;
  private latest: Layout;
  private timer?: ReturnType<typeof setTimeout>;
  private inFlight = false;
  private listeners = new Set<() => void>();
  private state: SaveState;
  constructor(layout: Layout, revision: number, private save: (layout: Layout, revision: number) => Promise<number>, private delay = 500) {
    this.latest = layout;
    this.saved = JSON.stringify(layout);
    this.state = { status: 'saved', dirty: false, revision };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(status: SaveState['status'], dirty: boolean, revision = this.state.revision, conflictKind?: SaveState['conflictKind']) {
    this.state = { status, dirty, revision, ...(status === 'conflict' ? { conflictKind: conflictKind ?? this.state.conflictKind ?? 'revision' } : {}) };
    for (const listener of this.listeners) listener();
  }
  queue(layout: Layout) {
    this.latest = structuredClone(layout);
    clearTimeout(this.timer);
    if (this.state.status === 'conflict' || this.state.status === 'failed') {
      this.publish(this.state.status, true, this.state.revision, this.state.conflictKind);
      return;
    }
    if (this.inFlight) { this.publish('saving', true); return; }
    if (JSON.stringify(this.latest) === this.saved) { this.publish('saved', false); return; }
    this.publish('pending', true);
    this.timer = setTimeout(() => { void this.flush(); }, this.delay);
  }
  retry() {
    if (this.state.status === 'failed') {
      this.publish('pending', true);
      void this.flush();
    }
  }
  /** Flush pending edits immediately (e.g. Ctrl+S). */
  saveNow() {
    if (this.state.status === 'conflict') return;
    clearTimeout(this.timer);
    if (JSON.stringify(this.latest) === this.saved && !this.inFlight) {
      this.publish('saved', false);
      return;
    }
    void this.flush();
  }
  markConflict(kind: 'revision' | 'lease' = 'revision') {
    clearTimeout(this.timer);
    this.publish('conflict', JSON.stringify(this.latest) !== this.saved, this.state.revision, kind);
  }
  adopt(layout: Layout, revision: number) {
    clearTimeout(this.timer);
    this.latest = structuredClone(layout);
    this.saved = JSON.stringify(layout);
    this.inFlight = false;
    this.publish('saved', false, revision);
  }
  /** Bump the acknowledged revision after a side-channel save (e.g. template migration) without touching the draft. */
  acknowledgeRevision(revision: number) {
    this.publish(this.state.status, this.state.dirty, revision, this.state.conflictKind);
  }
  private async flush() {
    if (this.inFlight || this.state.status === 'conflict') return;
    const layout = structuredClone(this.latest);
    this.inFlight = true;
    this.publish('saving', true);
    try {
      const revision = await this.save(layout, this.state.revision);
      this.saved = JSON.stringify(layout);
      this.inFlight = false;
      if (this.getSnapshot().status === 'conflict') {
        this.publish('conflict', JSON.stringify(this.latest) !== this.saved, revision);
        return;
      }
      this.publish('saved', JSON.stringify(this.latest) !== this.saved, revision);
      this.queue(this.latest);
    } catch (error) {
      this.inFlight = false;
      if (this.getSnapshot().status === 'conflict') return;
      this.publish(error instanceof SaveConflict ? 'conflict' : 'failed', true, this.state.revision, error instanceof SaveConflict ? error.kind : undefined);
    }
  }
  dispose() { clearTimeout(this.timer); }
}
