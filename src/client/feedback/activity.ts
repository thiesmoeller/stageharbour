import { feedbackActivitySchema, type FeedbackActivity } from '../../shared/feedback.js';
let enabled = false;
let events: FeedbackActivity[] = [];
export function enableFeedbackActivity(value: boolean) { enabled = value; if (!value) events = []; }
export function recordFeedbackActivity(event: Omit<FeedbackActivity, 'at'>, now = Date.now()) {
  if (!enabled) return;
  // Runtime allowlist also strips accidental extra fields at the instrumentation boundary.
  const parsed = feedbackActivitySchema.safeParse({ ...event, at: new Date(now).toISOString() });
  if (!parsed.success) return;
  events = [...events.filter(item => Date.parse(item.at) > now - 300_000), parsed.data].slice(-30);
}
export function feedbackActivity(now = Date.now()): FeedbackActivity[] {
  return events.filter(item => Date.parse(item.at) > now - 300_000).map(item => ({ ...item }));
}

/** Deliberately classify endpoint families, never retain paths, IDs, or query strings. */
export function recordApiFailure(path: string, status: number) {
  const segments = path.split(/[?#]/, 1)[0]!.split('/');
  const families = ['scenes', 'venues', 'inventory', 'exports', 'assets', 'feedback'] as const;
  const operation = families.find(name => segments.includes(name)) ??
    (segments.includes('auth') || segments.includes('me') ? 'account' : segments.includes('workspaces') ? 'workspace' : 'other');
  recordFeedbackActivity({ action: 'api.failure', area: 'api', operation, status });
}
