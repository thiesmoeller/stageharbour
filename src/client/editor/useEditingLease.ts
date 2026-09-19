import { useEffect, useState } from 'react';
import { ApiError, request } from '../api.js';
import { LEASE_HEARTBEAT_MS } from '../../shared/leases.js';

// Share inventory ownership between the panel and object library in this tab.
const owners = new Map<string, { users: number; held: boolean; message: string; listeners: Set<() => void>; timer?: number; pending: Promise<unknown> }>();
export function useEditingLease(base: string, enabled: boolean) {
  const [, refresh] = useState(0);
  let entry = owners.get(base);
  if (!entry) { entry = { users: 0, held: false, message: '', listeners: new Set(), pending: Promise.resolve() }; owners.set(base, entry); }
  const state = entry;
  const notify = () => state.listeners.forEach(listener => listener());
  const failed = (error: unknown) => {
    state.held = false;
    state.message = error instanceof ApiError ? error.message : 'Verbindung unterbrochen. Bearbeitung bitte erneut anfordern.';
    notify();
  };
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = state.pending.then(operation);
    state.pending = result.catch(() => {});
    return result;
  }
  async function acquire() {
    if (!enabled) return false;
    return serial(async () => {
      if (!state.users) return false;
      try {
        await request(`${base}/lease`, {});
        state.held = true; state.message = 'Sie bearbeiten diesen Bereich.'; notify(); return true;
      } catch (error) { failed(error); return false; }
    });
  }
  useEffect(() => {
    if (!enabled) return;
    const listener = () => refresh(value => value + 1);
    state.listeners.add(listener); state.users++;
    if (!state.timer) state.timer = window.setInterval(() => {
      void serial(async () => {
        if (state.held && state.users) await request(`${base}/lease/heartbeat`, {}).catch(failed);
      });
    }, LEASE_HEARTBEAT_MS);
    return () => {
      state.listeners.delete(listener); state.users--;
      if (!state.users) {
        clearInterval(state.timer); state.timer = undefined;
        void serial(async () => {
          if (state.users) return;
          if (state.held) await request(`${base}/lease/release`, {}).catch(() => {});
          state.held = false; state.message = '';
        });
      }
    };
  }, [base, enabled]);
  return { holding: enabled && state.held, message: state.message, acquire };
}
