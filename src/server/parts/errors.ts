import type { CatalogIssue } from '../../shared/parts/catalog.js';
import type { CatalogFailure } from '../../shared/parts/catalogPlans.js';

export class PartsError extends Error {
  constructor(public statusCode: CatalogFailure['status'], message: string, public issues?: CatalogIssue[]) { super(message); }
}

export function raise(failure: CatalogFailure): never {
  throw new PartsError(failure.status, failure.message, failure.issues);
}

/** Unwraps a plan: its value, or the failure as an error the app answers with. */
export function unwrap<T>(plan: { ok: true; value: T } | { ok: false; failure: CatalogFailure }): T {
  if (!plan.ok) raise(plan.failure);
  return plan.value;
}

const UNIQUE_VIOLATION = '23505';

/** Runs a write and turns a lost race on a unique key into the 409 the caller would have got a moment later. */
export async function onConflict<T>(message: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
    if (code === UNIQUE_VIOLATION) throw new PartsError(409, message);
    throw error;
  }
}
