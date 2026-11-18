import {
  copyRotateSelection, copySelection, moveSelection, rotateSelection,
  type EditResult, type SelectionTargets,
} from '../../../shared/parts/directEdit.js';
import type { PartDefinition } from '../../../shared/parts/definition.js';
import { add, normalize, scale, sub, type Vec3 } from '../../../shared/parts/math.js';
import type { ResolvedPart } from '../../../shared/parts/resolve.js';

/**
 * Rigid move of the selection (or a copy). The Move tool never deforms a corner —
 * that stays on dedicated soft-edit paths, not Verschieben.
 */
export function moveEdit(
  definition: PartDefinition,
  resolved: ResolvedPart,
  targets: SelectionTargets,
  delta: Vec3,
  copy = false,
): EditResult {
  return copy
    ? copySelection(definition, resolved, targets, delta)
    : moveSelection(definition, resolved, targets, delta);
}

/** Rigid turn of the selection (or a copy when Ctrl/Meta was held on commit). */
export function rotateEdit(
  definition: PartDefinition,
  resolved: ResolvedPart,
  targets: SelectionTargets,
  axis: Vec3,
  degrees: number,
  pivot: Vec3 | undefined,
  copy = false,
): EditResult {
  return copy
    ? copyRotateSelection(definition, resolved, targets, axis, degrees, pivot)
    : rotateSelection(definition, resolved, targets, axis, degrees, pivot);
}

/**
 * Live push/pull preview without rewriting the draft: scale along the face axis about the
 * opposite face so React/resolve stay idle during the drag.
 */
export function pushPullPreviewScale(
  handle: { position: Vec3; axis: Vec3; measure?: { value: number } },
  distance: number,
): { pivot: Vec3; axis: Vec3; factor: number } | undefined {
  const measure = handle.measure?.value;
  if (measure === undefined || !(measure > 1e-6)) return undefined;
  const next = measure + distance;
  if (!(next > 1e-3)) return undefined;
  const axis = normalize(handle.axis);
  return {
    pivot: sub(handle.position, scale(axis, measure)),
    axis,
    factor: next / measure,
  };
}

/**
 * Live preview of Ctrl+Drücken/Ziehen: the face outline extruded by `distance` as line segments
 * (base loop, far loop, uprights). Empty when the side has no plane (e.g. a sheet rim).
 */
export function pushPullNewBodyPreview(
  axis: Vec3,
  distance: number,
  face: { plane?: { origin: Vec3; u: Vec3; v: Vec3; outline: readonly { x: number; y: number }[] } } | undefined,
): { points: Vec3[] }[] {
  if (!(Math.abs(distance) >= 1) || !face?.plane) return [];
  const { origin, u, v, outline } = face.plane;
  if (outline.length < 2) return [];
  const lift = scale(normalize(axis), distance);
  const base = outline.map(point => add(origin, add(scale(u, point.x), scale(v, point.y))));
  const far = base.map(point => add(point, lift));
  const lines: { points: Vec3[] }[] = [
    { points: [...base, base[0]!] },
    { points: [...far, far[0]!] },
  ];
  for (let i = 0; i < base.length; i++) lines.push({ points: [base[i]!, far[i]!] });
  return lines;
}
