/** Plan-space wall/opening corners — kept free of layout schema imports to avoid ESM cycles. */

type PlanPoint = { x: number; y: number };
type WallPose = { x: number; y: number; rotation: number; width: number; thickness: number };
type OpeningSpan = { left: number; width: number };

function planPoint(wall: Pick<WallPose, 'x' | 'y' | 'rotation'>, dx: number, dy: number): PlanPoint {
  const angle = wall.rotation * Math.PI / 180;
  return {
    x: wall.x + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: wall.y + dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}

// Millimetres, centre anchor, +x audience-right, +y away from the audience.
// Positive rotation is counterclockwise in the plan's Cartesian coordinates.
export function wallCorners(wall: WallPose): PlanPoint[] {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x = 0, y = 0]) =>
    planPoint(wall, x * wall.width / 2, y * wall.thickness / 2));
}

// Opening left is millimetres from the panel's left edge when facing the plywood front.
export function openingCorners(wall: WallPose, opening: OpeningSpan): PlanPoint[] {
  const left = -wall.width / 2 + opening.left;
  return [[left, -1], [left + opening.width, -1], [left + opening.width, 1], [left, 1]].map(([x = 0, y = 0]) =>
    planPoint(wall, x, y * wall.thickness / 2));
}
