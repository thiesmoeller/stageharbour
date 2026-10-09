import { useEffect, useMemo } from 'react';
import { DoubleSide, Shape, ShapeGeometry } from 'three';
import { createMaterialFromPresetRef } from '@pascal-app/viewer';
import type { VenueGeometry } from '../../shared/layout.js';
import { measuredOutline } from '../../shared/venue.js';

export function VenueFloor({ venue, lit = false, onClearSelection }: {
  venue: VenueGeometry; lit?: boolean; onClearSelection?: () => void;
}) {
  const outlineKey = venue.outline?.map(point => `${point.x},${point.y}`).join(';') ?? `${venue.width}x${venue.depth}`;
  const geometry = useMemo(() => {
    const points = measuredOutline(venue), shape = new Shape();
    points.forEach((p, i) => i ? shape.lineTo(p.x, p.y) : shape.moveTo(p.x, p.y));
    shape.closePath();
    const result = new ShapeGeometry(shape); result.rotateX(Math.PI / 2); return result;
  }, [outlineKey, venue.width, venue.depth]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  // Pascal presets are cached NodeMaterials and cannot be compiled by the
  // simple view's classic WebGLRenderer. The cache owns their lifecycle.
  const finishMaterial = useMemo(
    () => lit ? createMaterialFromPresetRef(venue.floorFinish) : null,
    [venue.floorFinish, lit],
  );
  return <mesh name="venue-floor" geometry={geometry} position={[0, -1, 0]} receiveShadow
    onClick={event => { event.stopPropagation(); onClearSelection?.(); }}>
    {finishMaterial
      ? <primitive object={finishMaterial} attach="material" dispose={null} />
      : lit
        ? <meshStandardMaterial color="#dce4d4" side={DoubleSide} roughness={.9} />
        : <meshBasicMaterial color="#dce4d4" side={DoubleSide} />}
  </mesh>;
}
