import type { Layout, VenueGeometry } from '../../shared/layout.js';
import { wallCorners } from '../../shared/layout.js';
import { planReportExtent, type PlanReportScope } from '../../shared/planReportExtent.js';
import { resolveWall } from '../../shared/wall-types.js';

export type PlanPreviewData = {
  width: number;
  depth: number;
  /** Plan millimetres of the crop origin (defaults to venue 0,0). */
  originX?: number;
  originY?: number;
  walls: { corners: { x: number; y: number }[] }[];
  platforms: { outline: { x: number; y: number }[] }[];
};

export function planPreviewFromScene(
  venue: VenueGeometry,
  layout: Layout,
  scope: PlanReportScope = 'venue',
): PlanPreviewData {
  const extent = planReportExtent(venue, layout, scope, scope === 'scenery' ? 400 : 0);
  return {
    width: Math.max(1, extent.maxX - extent.minX),
    depth: Math.max(1, extent.maxY - extent.minY),
    originX: extent.minX,
    originY: extent.minY,
    walls: (layout.walls ?? []).map(wall => ({
      corners: wallCorners(resolveWall(wall, layout.wallTypes ?? [])),
    })),
    platforms: [...(venue.platforms ?? []), ...(layout.platforms ?? [])].map(platform => ({ outline: platform.outline })),
  };
}

export function PlanPreview({ preview, label }: { preview: PlanPreviewData; label: string }) {
  const originX = preview.originX ?? 0;
  const originY = preview.originY ?? 0;
  const pad = Math.max(preview.width, preview.depth) * 0.04;
  const left = originX - pad;
  const top = -(originY + preview.depth) - pad;
  const width = preview.width + pad * 2;
  const height = preview.depth + pad * 2;
  return <svg className="plan-preview" role="img" aria-label={label} viewBox={`${left} ${top} ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
    <rect x={originX} y={-(originY + preview.depth)} width={preview.width} height={preview.depth} className="plan-preview-floor" />
    {preview.platforms.map((platform, index) =>
      <polygon key={`p-${index}`} className="plan-preview-platform"
        points={platform.outline.map(point => `${point.x},${-point.y}`).join(' ')} />)}
    {preview.walls.map((wall, index) =>
      <polygon key={`w-${index}`} className="plan-preview-wall"
        points={wall.corners.map(point => `${point.x},${-point.y}`).join(' ')} />)}
  </svg>;
}
