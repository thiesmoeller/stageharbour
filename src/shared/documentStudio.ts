import { freezeSnapshot } from './export.js';
import {
  bodyRect, composeDocument, defaultCamera,
  type DocumentFrame, type DocumentLayout, type DocumentPage, type DocumentPurpose,
  type DrawnSheet, type ExportDocumentSpec, type FrameKind, type Rect,
  sectionsForPurpose, layersForPurpose,
} from './exportDocument.js';
import type { Scene } from './layout.js';
import type { Inventory } from './inventory.js';
import { freezePackage } from './package.js';

export const FRAME_LABELS: Record<FrameKind, string> = {
  plan: 'Grundriss', elevation: 'Wandansicht', view3d: 'Raumsicht', notes: 'Text und Hinweise', schedule: 'Stückliste',
};
export const PAGE_LAYOUTS = [
  { id: 'plan', label: 'Großer Grundriss', hint: 'Eine Zeichnung, viel Platz', kinds: ['plan'] },
  { id: 'plan-notes', label: 'Plan und Hinweise', hint: 'Grundriss mit rechter Notizspalte', kinds: ['plan', 'notes'] },
  { id: 'elevations', label: 'Zwei Wandansichten', hint: 'Ansichten untereinander', kinds: ['elevation', 'elevation'] },
  { id: 'presentation', label: 'Plan und Raumsicht', hint: 'Orientierung und räumlicher Eindruck', kinds: ['plan', 'view3d'] },
] as const;
export type PageLayoutId = typeof PAGE_LAYOUTS[number]['id'];

export function studioSpec(purpose: DocumentPurpose, sceneIds: string[], revisionName = 'Aufbauplan'): ExportDocumentSpec {
  return {
    schemaVersion: 1, purpose, sections: sectionsForPurpose(purpose), layers: layersForPurpose(purpose),
    preset: purpose === 'technical' ? 'construction' : 'presentation', revisionName,
    paper: purpose === 'technical' ? 'A3' : 'A4', orientation: 'auto', scale: 50,
    kind: sceneIds.length > 1 ? 'package' : 'scene',
    scenes: sceneIds.map(sceneId => ({ sceneId, elevationGroupIds: [] })),
    planScope: purpose === 'technical' ? 'scenery' : 'venue',
  };
}

/** Immediate design preview from the same geometry/layout pipeline as the final PDF. */
export function studioLayout(spec: ExportDocumentSpec, scenes: readonly Scene[], issuedAt: Date, measure?: Parameters<typeof composeDocument>[0]['measure'], inventory?: Pick<Inventory, 'panels' | 'ballast'>): DocumentLayout {
  const selected = spec.scenes.map(entry => scenes.find(scene => scene.id === entry.sceneId)).filter((scene): scene is Scene => !!scene);
  if (!selected.length) throw new Error('Für dieses Dokument ist kein Bühnenbild verfügbar.');
  const labels = Object.fromEntries((inventory?.panels ?? []).map(panel => [panel.id, panel.label]));
  const stock = (spec.kind === 'package' || selected.length > 1) ? freezePackage(selected, { id: selected[0]!.id, name: spec.revisionName || 'Entwurf', issuedAt, paper: spec.paper, scale: spec.scale }, inventory?.panels, inventory?.ballast).stock : undefined;
  return composeDocument({
    spec, productionName: scenes[0]?.productionName ?? 'Produktion', issuedAtLabel: issuedAt.toLocaleDateString('de-DE'), measure, stock,
    scenes: selected.map(scene => ({
      sceneId: scene.id, sceneName: scene.name, venueName: scene.venueName,
      snapshot: freezeSnapshot(scene, {
        id: scene.id, name: spec.revisionName || 'Entwurf', issuedAt, paper: spec.paper, scale: spec.scale,
        elevationGroupIds: spec.scenes.find(entry => entry.sceneId === scene.id)?.elevationGroupIds, layers: spec.layers,
      }, labels),
    })),
  });
}

/** Generated pages keep live references. Tables, cables and continuation sheets are never discarded. */
export function arrangedPages(layout: DocumentLayout): DocumentPage[] {
  return layout.sheets.map(sheet => ({
    id: crypto.randomUUID(), name: sheet.title, paper: sheet.paper, orientation: sheet.orientation,
    automaticKey: sheet.sourceKey, frames: [],
  }));
}

export function newStudioPage(spec: Pick<ExportDocumentSpec, 'paper' | 'orientation' | 'scale'>, sceneId: string, layoutId: PageLayoutId = 'plan'): DocumentPage {
  const orientation = spec.orientation === 'auto' ? 'landscape' : spec.orientation;
  const body = bodyRect(spec.paper, orientation);
  const preset = PAGE_LAYOUTS.find(item => item.id === layoutId)!;
  const gap = 8;
  return {
    id: crypto.randomUUID(), name: preset.label, paper: spec.paper, orientation,
    frames: preset.kinds.map((kind, index) => {
      const box = layoutId === 'plan-notes' ? {
        ...body, x: index ? body.x + body.width * 0.7 + gap : body.x,
        width: body.width * (index ? 0.3 : 0.7) - (index ? gap : 0),
      } : layoutId === 'elevations' ? {
        ...body, y: body.y + index * (body.height + gap) / 2, height: (body.height - gap) / 2,
      } : layoutId === 'presentation' ? {
        ...body, x: body.x + index * (body.width + gap) / 2, width: (body.width - gap) / 2,
      } : body;
      const frame = newStudioFrame(kind, box, sceneId, spec.scale);
      if (kind === 'elevation') frame.source.groupIndex = index;
      return frame;
    }),
  };
}

export function newStudioFrame(kind: FrameKind, rect: Rect, sceneId: string, scale: 25 | 50 | 100): DocumentFrame {
  return {
    id: crypto.randomUUID(), kind, ...rect, rotation: 0, source: { role: 'primary', sceneId }, label: FRAME_LABELS[kind],
    ...(kind === 'plan' || kind === 'elevation' ? { scale } : {}),
    ...(kind === 'notes' ? { text: 'Hinweise für Aufbau und Probe' } : {}),
    ...(kind === 'view3d' ? { camera: defaultCamera({ minX: 0, minY: 0, maxX: 8000, maxY: 6000 }, 'audience') } : {}),
  };
}

/** A drawing becomes editable; other automatic pages retain their generated content. */
export function editableDrawingPage(page: DocumentPage, sheet: DrawnSheet, spec: ExportDocumentSpec): DocumentPage {
  if (!page.automaticKey) return page;
  const sceneId = spec.scenes.find(entry => sheet.sourceKey?.startsWith(entry.sceneId))?.sceneId ?? spec.scenes[0]!.sceneId;
  return {
    ...page, automaticKey: undefined,
    frames: sheet.frames.map(frame => ({
      ...newStudioFrame(frame.kind, frame.clip, sceneId, frame.scale === 25 || frame.scale === 100 ? frame.scale : 50),
      // A tiled source window is an intentional detail after being detached.
      ...(frame.window && frame.id.startsWith('plan-') ? { crop: frame.window } : {}),
      label: frame.sourceLabel,
      ...(frame.kind === 'elevation' ? { source: { role: 'primary' as const, sceneId,
        facingDegrees: Number(frame.id.slice(`elev-${sceneId}-`.length).replace(/-\d+-\d+$/, '')) || 0 } } : {}),
    })),
  };
}

export function duplicateStudioPage(page: DocumentPage): DocumentPage {
  return { ...structuredClone(page), id: crypto.randomUUID(), name: `${page.name.slice(0, 110)} · Kopie`,
    frames: page.frames.map(frame => ({ ...structuredClone(frame), id: crypto.randomUUID() })) };
}

export function constrainFrame(frame: DocumentFrame, page: Pick<DocumentPage, 'paper' | 'orientation'>): DocumentFrame {
  const body = bodyRect(page.paper, page.orientation);
  const width = Math.max(10, Math.min(frame.width, body.width));
  const height = Math.max(10, Math.min(frame.height, body.height));
  return { ...frame, width, height,
    x: Math.max(body.x, Math.min(frame.x, body.x + body.width - width)),
    y: Math.max(body.y, Math.min(frame.y, body.y + body.height - height)),
  };
}

export type SnapGuide = { axis: 'x' | 'y'; value: number };
/** Snap in screen pixels, then return paper millimetres. No construction geometry is scaled. */
export function moveStudioFrame(frame: DocumentFrame, dx: number, dy: number, page: DocumentPage, pixelsPerMm: number, snap = true): { frame: DocumentFrame; guides: SnapGuide[] } {
  const body = bodyRect(page.paper, page.orientation);
  let next = constrainFrame({ ...frame, x: frame.x + dx, y: frame.y + dy }, page);
  const guides: SnapGuide[] = [];
  if (snap) {
    for (const axis of ['x', 'y'] as const) {
      const size = axis === 'x' ? 'width' : 'height';
      const targets = [body[axis], body[axis] + body[size] / 2, body[axis] + body[size],
        ...page.frames.filter(other => other.id !== frame.id).flatMap(other => [other[axis], other[axis] + other[size] / 2, other[axis] + other[size]])];
      let best = 6 / Math.max(pixelsPerMm, 0.1);
      let delta = 0; let guide: number | undefined;
      for (const target of targets) for (const offset of [0, next[size] / 2, next[size]]) {
        const distance = target - (next[axis] + offset);
        if (Math.abs(distance) < best) { best = Math.abs(distance); delta = distance; guide = target; }
      }
      if (guide !== undefined) { next = { ...next, [axis]: next[axis] + delta }; guides.push({ axis, value: guide }); }
    }
  }
  return { frame: constrainFrame(next, page), guides };
}

export function resizeStudioFrame(frame: DocumentFrame, dx: number, dy: number, page: DocumentPage): DocumentFrame {
  return constrainFrame({ ...frame, width: frame.width + dx, height: frame.height + dy }, page);
}

