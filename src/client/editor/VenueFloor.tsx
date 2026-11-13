import { useLayoutEffect, useState } from 'react';
import { Shape, ShapeGeometry, type Material } from 'three';
import type { VenueGeometry } from '../../shared/layout.js';
import { measuredOutline } from '../../shared/venue.js';
import { geometryKey } from '../stage/geometryCache.js';
import { libraryMaterial } from '../stage/materialLibrary.js';
import { useCachedGeometry } from '../stage/StageInstances.js';
import { stageMaterials } from '../stage/stageAssets.js';
import { libraryFloorTiling } from '../stage/surfaceMaterials.js';
import { useFlatMaterial, useStageDisplay } from './stageMaterialHooks.js';

const DEFAULT_FLOOR = { color: '#dce4d4', roughness: 0.9, doubleSided: true } as const;

/** The floor outline as a flat mesh; texture coordinates run 0..1 across its bounding rectangle. */
function buildFloor(points: readonly { x: number; y: number }[]) {
  const shape = new Shape();
  points.forEach((point, index) => index ? shape.lineTo(point.x, point.y) : shape.moveTo(point.x, point.y));
  shape.closePath();
  const geometry = new ShapeGeometry(shape);
  const { minX, minY, width, depth } = floorExtent(points);
  const uv = geometry.getAttribute('uv');
  for (let index = 0; index < uv.count; index++) uv.setXY(index, (uv.getX(index) - minX) / width, (uv.getY(index) - minY) / depth);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

function floorExtent(points: readonly { x: number; y: number }[]) {
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  return { minX, minY, width: Math.max(1, Math.max(...xs) - minX), depth: Math.max(1, Math.max(...ys) - minY) };
}

/** The Spielstätte floor in millimetres, with its library finish at the library's tile size per metre. */
export function VenueFloor({ venue, onClearSelection }: { venue: VenueGeometry; onClearSelection?: () => void }) {
  const display = useStageDisplay();
  const points = measuredOutline(venue);
  const outline = points.map(point => [point.x, point.y] as const);
  const geometry = useCachedGeometry(geometryKey('venue-floor', outline), () => buildFloor(points));
  const { width, depth } = floorExtent(points);
  const fallback = useFlatMaterial(DEFAULT_FLOOR);
  const [finish, setFinish] = useState<Material | null>(null);
  useLayoutEffect(() => {
    const source = libraryMaterial(venue.floorFinish);
    if (!source) { setFinish(null); return; }
    const created = stageMaterials.createLibraryMaterial(source, libraryFloorTiling(source, { faceWidthMm: width, faceHeightMm: depth }), display);
    setFinish(created);
    return () => stageMaterials.disposeSurfaceMaterial(created);
  }, [venue.floorFinish, width, depth, display]);
  return <mesh name="venue-floor" geometry={geometry} material={finish ?? fallback} dispose={null} position={[0, -1, 0]} receiveShadow
    onClick={event => { event.stopPropagation(); onClearSelection?.(); }} />;
}
