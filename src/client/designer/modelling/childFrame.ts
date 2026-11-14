import type { PartDefinition } from '../../../shared/parts/definition.js';
import { calculateFormula } from '../../../shared/parts/formula.js';
import { elementScope } from '../../../shared/parts/handles.js';
import { add, quatFromEulerDegrees, rotate, sub, type RigidTransform, type Vec3 } from '../../../shared/parts/math.js';
import type { ResolvedPart, ResolvedSolid } from '../../../shared/parts/resolve.js';

/** Where the first instance of a child sits in the parent, for editing it in place. */
export function childFrame(definition: PartDefinition, resolved: ResolvedPart, childKey: string): RigidTransform | undefined {
  const child = definition.children?.find(item => item.key === childKey);
  if (!child) return undefined;
  const scope = elementScope(resolved, child, child.repeat ? [0, 0, 0] : []);
  try {
    const vec = (formulas: readonly (number | string)[]): Vec3 => {
      const [x, y, z] = formulas.map(formula => calculateFormula(formula, scope));
      return { x: x!, y: y!, z: z! };
    };
    const at = vec(child.at);
    const angles = child.rotation ? vec(child.rotation) : { x: 0, y: 0, z: 0 };
    const pivot = child.pivot ? vec(child.pivot) : at;
    const rotation = quatFromEulerDegrees(angles.x, angles.y, angles.z);
    return { rotation, translation: add(pivot, rotate(rotation, sub(at, pivot))) };
  } catch {
    return undefined;
  }
}

/** Solids of the parent that the edited child draws itself. */
export const solidOfChild = (childKey: string) => (solid: ResolvedSolid) => solid.path[0]?.replace(/\[.*$/, '') === childKey;
