/**
 * One-shot: create Goldbekhaus Bühne zum Hof and mut! theater in the local workspace.
 * Run: node --env-file=.env --import tsx scripts/seed-hamburg-venues.ts
 *
 * Geometry is from public floor plans; platform elevations and mut! room envelope are estimates.
 * Open each venue in the UI to calibrate the PDF underlay and refine the outline.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { AUDIENCE_FLOOR_ID } from '../src/shared/levels.js';
import type { VenueGeometry } from '../src/shared/layout.js';
import { newTruss } from '../src/shared/truss.js';

const ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:5174';
// Always hit loopback; HOST=localhost can resolve to a LAN address that the API is not bound to.
const API = `http://127.0.0.1:${process.env.PORT ?? '3100'}`;
const WS = process.env.WORKSPACE_ID;
if (!WS) throw new Error('WORKSPACE_ID missing');

const jar = new Map<string, string>();

function storeCookies(res: Response) {
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const cookie of raw) {
    const [pair] = cookie.split(';');
    const i = pair!.indexOf('=');
    jar.set(pair!.slice(0, i), pair!.slice(i + 1));
  }
}

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function api<T = unknown>(
  method: string,
  path: string,
  options: { json?: unknown; body?: Uint8Array; headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Origin: ORIGIN,
      Cookie: cookieHeader(),
      ...(options.json ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    body: options.json ? JSON.stringify(options.json) : options.body ? Buffer.from(options.body) : undefined,
  });
  storeCookies(res);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  return data as T;
}

type VenueRecord = {
  id: string;
  name: string;
  venueVersionId: string;
  width: number;
  depth: number;
  venue?: VenueGeometry;
};

async function uploadPdf(path: string, name: string) {
  const bytes = new Uint8Array(readFileSync(path));
  return api<{ id: string }>('POST', `/api/workspaces/${WS}/venue-references`, {
    body: bytes,
    headers: { 'Content-Type': 'application/pdf', 'x-file-name': name },
  });
}

async function createAndPublish(name: string, width: number, depth: number, geometry: VenueGeometry) {
  const created = await api<VenueRecord>('POST', `/api/workspaces/${WS}/venues`, {
    json: { name, width, depth },
  });
  await api('POST', `/api/workspaces/${WS}/venues/${created.id}/lease`);
  const published = await api<VenueRecord>('PUT', `/api/workspaces/${WS}/venues/${created.id}`, {
    json: { venueVersionId: created.venueVersionId, venue: geometry },
  });
  try {
    await api('POST', `/api/workspaces/${WS}/venues/${created.id}/lease/release`);
  } catch {
    /* lease may already have expired */
  }
  return published;
}

const login = await api<{ user?: { email?: string } }>('POST', '/api/auth/sign-in/email', {
  json: { email: 'admin@example.test', password: 'local-admin-7319' },
});
console.log('signed in as', login.user?.email ?? 'ok');

const existing = await api<VenueRecord[]>('GET', `/api/workspaces/${WS}/venues`);
const names = new Set(existing.map(v => v.name));
console.log('existing:', [...names].join(', ') || '(none)');

if (!names.has('Goldbekhaus Bühne zum Hof')) {
  const goldRef = await uploadPdf('data/venue-imports/goldbekhaus_bzh.pdf', 'Raumplan_BzH.pdf');
  const goldW = 9900;
  const goldD = 13400;
  const gold = await createAndPublish('Goldbekhaus Bühne zum Hof', goldW, goldD, {
    schemaVersion: 1,
    width: goldW,
    depth: goldD,
    outline: [
      { x: 0, y: 0 }, { x: goldW, y: 0 }, { x: goldW, y: goldD }, { x: 0, y: goldD },
    ],
    trace: { fileId: goldRef.id, page: 1 },
    stageCentreline: { x: goldW / 2, y: goldD - 2500, rotation: 90 },
  });
  console.log('created Goldbekhaus', gold.id, `${gold.width}×${gold.depth}`, 'ref', goldRef.id);
} else {
  console.log('skip Goldbekhaus (already present)');
}

if (!names.has('mut! theater')) {
  const mutRef = await uploadPdf('data/venue-imports/mut_buehnenplan.pdf', 'Buehnenplan.pdf');
  // Envelope estimate — calibrate PDF in UI and tighten outline.
  const mutW = 12000;
  const mutD = 14000;
  const mut = await createAndPublish('mut! theater', mutW, mutD, {
    schemaVersion: 1,
    width: mutW,
    depth: mutD,
    outline: [
      { x: 0, y: 0 }, { x: mutW, y: 0 }, { x: mutW, y: mutD }, { x: 0, y: mutD },
    ],
    trace: { fileId: mutRef.id, page: 1 },
    ceilingHeight: 4000,
    // Centreline through the 6×7 m Spielbühne (flat dance floor — not a raised platform).
    stageCentreline: { x: mutW / 2, y: 500 + 3500, rotation: 90 },
    platforms: [
      {
        id: randomUUID(),
        label: 'Technik-Podest',
        elevation: 400,
        outline: [
          { x: 500, y: mutD - 1800 }, { x: 2400, y: mutD - 1800 },
          { x: 2400, y: mutD - 500 }, { x: 500, y: mutD - 500 },
        ],
      },
      {
        id: randomUUID(),
        label: 'Podeste Zuschauer',
        elevation: 600,
        outline: [
          { x: 4500, y: 8500 }, { x: 11000, y: 8500 },
          { x: 11000, y: 13000 }, { x: 4500, y: 13000 },
        ],
      },
      {
        id: randomUUID(),
        label: 'Podest-Reihen Seite',
        elevation: 400,
        outline: [
          { x: 500, y: 4500 }, { x: 2500, y: 4500 },
          { x: 2500, y: 7500 }, { x: 500, y: 7500 },
        ],
      },
    ],
    walls: [{
      id: randomUUID(),
      label: 'Betonpfeiler',
      x: 3200, y: 5500, rotation: 0,
      width: 600, height: 4000, thickness: 600,
      supportingSurfaceId: AUDIENCE_FLOOR_ID,
    }],
    placeholders: [{
      id: randomUUID(), kind: 'table', label: 'Theke Bar',
      x: 2000, y: mutD - 2500, rotation: 0,
      width: 2200, depth: 350, height: 1100,
      supportingSurfaceId: AUDIENCE_FLOOR_ID,
    }],
    trusses: [
      { ...newTruss(randomUUID(), mutW / 2, 2000, { length: 6000, rotation: 0, bottomHeight: 3500 }), label: 'Traverse vorn' },
      { ...newTruss(randomUUID(), mutW / 2, 5500, { length: 6000, rotation: 0, bottomHeight: 3500 }), label: 'Traverse hinten' },
      { ...newTruss(randomUUID(), mutW / 2 - 2500, 3750, { length: 4000, rotation: 90, bottomHeight: 3500 }), label: 'Traverse Seite L' },
      { ...newTruss(randomUUID(), mutW / 2 + 2500, 3750, { length: 4000, rotation: 90, bottomHeight: 3500 }), label: 'Traverse Seite R' },
    ],
  });
  console.log('created mut!', mut.id, `${mut.width}×${mut.depth}`, 'ceiling', mut.venue?.ceilingHeight, 'ref', mutRef.id);
} else {
  console.log('skip mut! theater (already present)');
}

const list = await api<VenueRecord[]>('GET', `/api/workspaces/${WS}/venues`);
console.log('venues now:', list.map(v => `${v.name} (${v.width}×${v.depth} mm)`).join('\n  '));
