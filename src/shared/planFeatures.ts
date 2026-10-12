import type { ConstructionSnapshot } from './export.js';
import { resolveExportLayers, type ExportLayers } from './exportLayers.js';
import { wallCorners } from './layout.js';
import { resolveWall } from './wall-types.js';
import { stairCorners } from './levels.js';
import { overheadBoxCorners } from './overhead.js';
import { trussCorners } from './truss.js';
import { curtainEndTicks, curtainWavyPoints } from './curtains.js';

type Point = { x: number; y: number };
export type PlanFeature = { points: Point[]; closed: boolean; label?: string; fill?: string; stroke: string };

/** The same enabled geometry drives PDF painting and automatic framing. */
export function planFeatures(snapshot: ConstructionSnapshot, partial: Partial<ExportLayers>): PlanFeature[] {
  const layers = resolveExportLayers(partial);
  const features: PlanFeature[] = [];
  const add = (points: Point[], stroke: string, label?: string, fill?: string, closed = true) =>
    features.push({ points, stroke, label: layers.labels ? label : undefined, fill, closed });
  for (const source of [layers.venueContext ? snapshot.venue : undefined, layers.scenery ? snapshot.layout : undefined]) {
    if (!source) continue;
    for (const platform of source.platforms ?? []) add(platform.outline, '#5a6e52', `${platform.label}${layers.dimensions ? ` · ${platform.elevation} mm` : ''}`, '#e8efe3');
    for (const stair of source.stairs ?? []) add(stairCorners(stair), '#718469', stair.label, '#f1f4ed');
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
