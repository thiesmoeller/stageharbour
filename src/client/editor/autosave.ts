import type { Layout } from '../../shared/layout.js';

export type SaveState = { status: 'saved' | 'pending' | 'saving' | 'failed' | 'conflict'; dirty: boolean; revision: number };
export class SaveConflict extends Error {}

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
  private publish(status: SaveState['status'], dirty: boolean, revision = this.state.revision) {
    this.state = { status, dirty, revision };
    for (const listener of this.listeners) listener();
  }
  queue(layout: Layout) {
    this.latest = structuredClone(layout);
    clearTimeout(this.timer);
    if (this.state.status === 'conflict' || this.state.status === 'failed') {
      this.publish(this.state.status, true);
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
  private async flush() {
    if (this.inFlight || this.state.status === 'conflict') return;
    const layout = structuredClone(this.latest);
    this.inFlight = true;
    this.publish('saving', true);
    try {
      const revision = await this.save(layout, this.state.revision);
      this.saved = JSON.stringify(layout);
      this.inFlight = false;
      this.publish('saved', JSON.stringify(this.latest) !== this.saved, revision);
      this.queue(this.latest);
    } catch (error) {
      this.inFlight = false;
      this.publish(error instanceof SaveConflict ? 'conflict' : 'failed', true);
    }
  }
  dispose() { clearTimeout(this.timer); }
}
