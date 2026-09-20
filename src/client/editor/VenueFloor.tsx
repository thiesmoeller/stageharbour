import { useEffect, useLayoutEffect, useMemo } from 'react';
import { DoubleSide, Shape, ShapeGeometry } from 'three';
import { createMaterialFromPresetRef } from '@pascal-app/viewer';
import type { VenueGeometry } from '../../shared/layout.js';
import { measuredOutline } from '../../shared/venue.js';

export function VenueFloor({ venue, lit = false, onClearSelection }: {
  venue: VenueGeometry; lit?: boolean; onClearSelection?: () => void;
}) {
  const geometry = useMemo(() => {
    const points = measuredOutline(venue), shape = new Shape();
    points.forEach((p, i) => i ? shape.lineTo(p.x, p.y) : shape.moveTo(p.x, p.y));
    shape.closePath();
    const result = new ShapeGeometry(shape); result.rotateX(Math.PI / 2); return result;
  }, [venue.outline, venue.width, venue.depth]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const finishMaterial = useMemo(() => createMaterialFromPresetRef(venue.floorFinish), [venue.floorFinish]);
  useLayoutEffect(() => () => { finishMaterial?.dispose(); }, [finishMaterial]);
  return <mesh name="venue-floor" geometry={geometry} position={[0, -1, 0]} receiveShadow
    onClick={event => { event.stopPropagation(); onClearSelection?.(); }}>
    {finishMaterial
      ? <primitive object={finishMaterial} attach="material" dispose={null} />
      : lit
        ? <meshStandardMaterial color="#dce4d4" side={DoubleSide} roughness={.9} />
        : <meshBasicMaterial color="#dce4d4" side={DoubleSide} />}
  </mesh>;
}
