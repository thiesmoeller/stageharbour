import type { ConstructionSnapshot } from './export.js';
import { resolveExportLayers, type ExportLayers } from './exportLayers.js';
import { wallCorners } from './layout.js';
import { resolveWall } from './wall-types.js';
import { stairCorners } from './levels.js';
import { overheadBoxCorners } from './overhead.js';
import { trussCorners } from './truss.js';
import { curtainEndTicks, curtainWavyPoints } from './curtains.js';
import { resolveFrozen } from './frozenParts.js';
import { planFigure, planSymbol, type PlanStrokeKind, type PlanSymbol } from './partDrawings.js';

type Point = { x: number; y: number };

const STROKE_STYLES: Record<PlanStrokeKind, { stroke: string; fill?: string }> = {
  solid: { stroke: '#4b5d42', fill: '#c9d6c3' },
  step: { stroke: '#4b5d42' },
  opening: { stroke: '#4b5d42', fill: '#ffffff' },
  leaf: { stroke: '#986122' },
  swing: { stroke: '#986122' },
};

/** Plan symbols of the frozen objects, lowest first so stacked parts paint over their support. */
export function snapshotPlanSymbols(snapshot: Pick<ConstructionSnapshot, 'layout' | 'venue' | 'library' | 'stock'>): PlanSymbol[] {
  return resolveFrozen(snapshot).objects.map(planSymbol)
    .sort((a, b) => a.elevation - b.elevation);
}
export type PlanFeature = { points: Point[]; closed: boolean; label?: string; fill?: string; stroke: string };

/** The same enabled geometry drives PDF painting and automatic framing. */
export function planFeatures(snapshot: ConstructionSnapshot, partial: Partial<ExportLayers>): PlanFeature[] {
  const layers = resolveExportLayers(partial);
  const features: PlanFeature[] = [];
  const add = (points: Point[], stroke: string, label?: string, fill?: string, closed = true) =>
    features.push({ points, stroke, label: layers.labels ? label : undefined, fill, closed });
  if (layers.venueContext) {
    for (const platform of snapshot.venue.platforms ?? []) add(platform.outline, '#5a6e52', `${platform.label}${layers.dimensions ? ` · ${platform.elevation} mm` : ''}`, '#e8efe3');
    for (const stair of snapshot.venue.stairs ?? []) add(stairCorners(stair), '#718469', stair.label, '#f1f4ed');
  }
  if (layers.scenery) {
    const drawn = resolveFrozen(snapshot).objects
      .map(item => ({ symbol: planSymbol(item), figure: planFigure(item) }))
      .sort((a, b) => a.symbol.elevation - b.symbol.elevation);
    for (const { symbol, figure } of drawn) {
      add(figure.fill, '#4b5d42', symbol.label, '#dfe7d8');
      for (const opening of figure.openings) add(opening, '#4b5d42', undefined, '#ffffff');
      for (const frame of figure.frames) add(frame, '#6d6456', undefined, '#e7e0d2');
      for (const leaf of figure.leaves) {
        if (leaf.slab.length >= 3) add(leaf.slab, '#6d6456', undefined, '#c8c4b8');
        else add(leaf.points, '#986122', undefined, undefined, false);
        if (leaf.arc.length > 1) add(leaf.arc, '#986122', undefined, undefined, false);
      }
      for (const stroke of symbol.strokes) {
        if ((figure.leaves.length || figure.openings.length) && (stroke.kind === 'opening' || stroke.kind === 'leaf' || stroke.kind === 'swing')) continue;
        const style = STROKE_STYLES[stroke.kind];
        add(stroke.points, style.stroke, undefined, style.fill, stroke.closed);
      }
    }
  }
  if (layers.venueContext) {
    for (const wall of snapshot.venue.walls ?? []) add(wallCorners(resolveWall(wall, snapshot.venue.wallTypes ?? [])), '#625b50', wall.label, '#aaa397');
  }
  if (layers.softGoods) {
    for (const box of snapshot.venue.overheadBoxes ?? []) add(overheadBoxCorners(box), '#8a6a3a', box.label);
    for (const truss of snapshot.venue.trusses ?? []) add(trussCorners(truss), '#4f86ba', truss.label);
    for (const curtain of snapshot.venue.curtains ?? []) {
      for (const wave of curtainWavyPoints(curtain)) add(wave, '#1a1a1a', curtain.label, undefined, false);
      for (const tick of curtainEndTicks(curtain)) add([tick.a, tick.b], '#1a1a1a', undefined, undefined, false);
    }
  }
  if (layers.constraints) {
    for (const zone of snapshot.venue.keepClearZones ?? []) add(zone.polygon, '#b67c35', zone.label);
  }
  if (layers.infrastructure) {
    for (const corridor of snapshot.venue.cableRoutingCorridors ?? []) add(corridor.path, '#5a6e8a', corridor.label, undefined, false);
    for (const pin of snapshot.venue.connectionPoints ?? []) {
      add([{ x: pin.x - 60, y: pin.y }, { x: pin.x + 60, y: pin.y }], '#986122', pin.label, undefined, false);
      add([{ x: pin.x, y: pin.y - 60 }, { x: pin.x, y: pin.y + 60 }], '#986122', undefined, undefined, false);
    }
  }
  if (layers.cables) {
    for (const run of snapshot.layout.cableRuns ?? []) {
      add(run.path, '#9b3f64', `${run.label} · ${run.quantity}× ${run.cableType}`, undefined, false);
    }
  }
  return features;
}
