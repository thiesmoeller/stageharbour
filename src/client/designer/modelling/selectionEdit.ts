import {
  copyRotateSelection, copySelection, moveSelection, rotateSelection,
  type EditResult, type SelectionTargets,
} from '../../../shared/parts/directEdit.js';
import type { PartDefinition } from '../../../shared/parts/definition.js';
import { normalize, scale, sub, type Vec3 } from '../../../shared/parts/math.js';
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
