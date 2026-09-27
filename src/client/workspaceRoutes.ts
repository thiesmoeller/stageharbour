/** Hash paths for workspace destinations (U02 / U07). Account entry routes stay in main.tsx. */

export type WorkspaceLocation =
  | { section: 'plans' }
  | { section: 'plans'; sceneId: string }
  | { section: 'venues' }
  | { section: 'venues'; venueId: string }
  | { section: 'bestand' }
  | { section: 'account' }
  | { section: 'admin' }
  | { section: 'help' }
  | { section: 'help'; topic: string };

export function parseWorkspaceLocation(raw: string): WorkspaceLocation | undefined {
  const path = raw.replace(/^#/, '');
  if (!path || path === '/' || path === '/produktionen') return { section: 'plans' };
  const scene = /^\/szenen\/([^/]+)$/.exec(path);
  if (scene) return { section: 'plans', sceneId: decodeURIComponent(scene[1]!) };
  if (path === '/spielstaetten') return { section: 'venues' };
  const venue = /^\/spielstaetten\/([^/]+)$/.exec(path);
  if (venue) return { section: 'venues', venueId: decodeURIComponent(venue[1]!) };
  if (path === '/bestand') return { section: 'bestand' };
  if (path === '/konto') return { section: 'account' };
  if (path === '/verwaltung') return { section: 'admin' };
  if (path === '/hilfe') return { section: 'help' };
  const helpTopic = /^\/hilfe\/([^/]+)$/.exec(path);
  if (helpTopic) return { section: 'help', topic: decodeURIComponent(helpTopic[1]!) };
  return undefined;
}

export function workspaceHash(location: WorkspaceLocation): string {
  if (location.section === 'venues') {
    return 'venueId' in location ? `#/spielstaetten/${encodeURIComponent(location.venueId)}` : '#/spielstaetten';
  }
  if (location.section === 'bestand') return '#/bestand';
  if (location.section === 'account') return '#/konto';
  if (location.section === 'admin') return '#/verwaltung';
  if (location.section === 'help') {
    return 'topic' in location ? `#/hilfe/${encodeURIComponent(location.topic)}` : '#/hilfe';
  }
  return 'sceneId' in location ? `#/szenen/${encodeURIComponent(location.sceneId)}` : '#/produktionen';
}

export function writeWorkspaceLocation(location: WorkspaceLocation) {
  const next = workspaceHash(location);
  if (window.location.hash === next) return;
  window.location.hash = next;
}
