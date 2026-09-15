import type { Layout, VenueGeometry } from '../../shared/layout.js';
import { wallCorners } from '../../shared/layout.js';
import { resolveWall } from '../../shared/wall-types.js';

export type PlanPreviewData = {
  width: number;
  depth: number;
  walls: { corners: { x: number; y: number }[] }[];
  platforms: { outline: { x: number; y: number }[] }[];
};

export function planPreviewFromScene(venue: VenueGeometry, layout: Layout): PlanPreviewData {
  return {
    width: venue.width,
    depth: venue.depth,
    walls: (layout.walls ?? []).map(wall => ({
      corners: wallCorners(resolveWall(wall, layout.wallTypes ?? [])),
    })),
    platforms: [...(venue.platforms ?? []), ...(layout.platforms ?? [])].map(platform => ({ outline: platform.outline })),
  };
}

export function PlanPreview({ preview, label }: { preview: PlanPreviewData; label: string }) {
  const pad = Math.max(preview.width, preview.depth) * 0.06;
  const left = -pad, top = -pad - preview.depth;
  const width = preview.width + pad * 2, height = preview.depth + pad * 2;
  return <svg className="plan-preview" role="img" aria-label={label} viewBox={`${left} ${top} ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
    <rect x={0} y={-preview.depth} width={preview.width} height={preview.depth} className="plan-preview-floor" />
    {preview.platforms.map((platform, index) =>
      <polygon key={`p-${index}`} className="plan-preview-platform"
        points={platform.outline.map(point => `${point.x},${-point.y}`).join(' ')} />)}
    {preview.walls.map((wall, index) =>
      <polygon key={`w-${index}`} className="plan-preview-wall"
        points={wall.corners.map(point => `${point.x},${-point.y}`).join(' ')} />)}
  </svg>;
}
