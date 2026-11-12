import type { Layout, VenueGeometry } from '../../shared/layout.js';
import { planReportExtent, type PlanReportScope } from '../../shared/planReportExtent.js';
import type { ResolvedLayoutObject } from '../../shared/layoutObjects.js';

export type PlanPreviewData = {
  width: number;
  depth: number;
  /** Plan millimetres of the crop origin (defaults to venue 0,0). */
  originX?: number;
  originY?: number;
  /** Hall footprint; when set, drawn instead of the axis-aligned floor rectangle. */
  outline?: { x: number; y: number }[];
  walls: { corners: { x: number; y: number }[] }[];
  platforms: { outline: { x: number; y: number }[] }[];
};

/** Whole hall and scenery, so a rubber band can pick any part of the drawing. */
export function fullPlanPreview(venue: VenueGeometry, layout: Layout, objects: readonly ResolvedLayoutObject[] = []): PlanPreviewData {
  const hall = planReportExtent(venue, layout, 'venue', 0, objects);
  const scenery = planReportExtent(venue, layout, 'scenery', 0, objects);
  const minX = Math.min(hall.minX, scenery.minX);
  const minY = Math.min(hall.minY, scenery.minY);
  const maxX = Math.max(hall.maxX, scenery.maxX);
  const maxY = Math.max(hall.maxY, scenery.maxY);
  return {
    ...planPreviewFromScene(venue, layout, 'venue', objects),
    width: Math.max(1, maxX - minX),
    depth: Math.max(1, maxY - minY),
    originX: minX,
    originY: minY,
  };
}

export function planPreviewFromScene(
  venue: VenueGeometry,
  layout: Layout,
  scope: PlanReportScope = 'venue',
  objects: readonly ResolvedLayoutObject[] = [],
): PlanPreviewData {
  const extent = planReportExtent(venue, layout, scope, scope === 'scenery' ? 400 : 0, objects);
  return {
    width: Math.max(1, extent.maxX - extent.minX),
    depth: Math.max(1, extent.maxY - extent.minY),
    originX: extent.minX,
    originY: extent.minY,
    walls: objects.map(object => ({ corners: object.footprint })),
    platforms: (venue.platforms ?? []).map(platform => ({ outline: platform.outline })),
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
  const floor = preview.outline?.length
    ? <polygon className="plan-preview-floor" points={preview.outline.map(point => `${point.x},${-point.y}`).join(' ')} />
    : <rect x={originX} y={-(originY + preview.depth)} width={preview.width} height={preview.depth} className="plan-preview-floor" />;
  return <svg className="plan-preview" role="img" aria-label={label} viewBox={`${left} ${top} ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
    {floor}
    {preview.platforms.map((platform, index) =>
      <polygon key={`p-${index}`} className="plan-preview-platform"
        points={platform.outline.map(point => `${point.x},${-point.y}`).join(' ')} />)}
    {preview.walls.map((wall, index) =>
      <polygon key={`w-${index}`} className="plan-preview-wall"
        points={wall.corners.map(point => `${point.x},${-point.y}`).join(' ')} />)}
  </svg>;
}
