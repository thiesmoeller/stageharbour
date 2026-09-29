import { useId } from 'react';
import { getCatalogMaterialById } from '@pascal-app/core';
import { openingOutlinePoints, type Opening, type WallElementType } from '../../shared/wall-types.js';
import { ralHex, ralLabel } from '../../shared/ral.js';
import type { SurfaceFinish, WallSurfaces } from '../../shared/surfaces.js';

export function finishLabel(finish?: SurfaceFinish): string {
  if (!finish) return 'Sperrholz';
  return finish.kind === 'paint' ? ralLabel(finish.ral) : getCatalogMaterialById(finish.ref.slice(8))?.label ?? finish.ref;
}

export function WallTypePreview({ type, cutouts = [], surfaces, label = type.name, side = 'front' }: {
  type: WallElementType; cutouts?: Opening[]; surfaces?: WallSurfaces; label?: string; side?: 'front' | 'back';
}) {
  const id = useId().replaceAll(':', '');
  const face = surfaces?.[side];
  const bands = face?.splitMm !== undefined
    ? [{ y: 0, height: Math.max(0, type.height - face.splitMm), finish: face.upper }, { y: Math.max(0, type.height - face.splitMm), height: Math.min(type.height, face.splitMm), finish: face.lower }]
    : [{ y: 0, height: type.height, finish: face?.full }];
  return <svg className="wall-type-preview" viewBox={`-60 -60 ${type.width + 120} ${type.height + 120}`} role="img" aria-label={`${label} · ${type.width} × ${type.height} mm · ${type.openings.length + cutouts.length} Öffnungen`}>
    {bands.map((band, index) => {
      const material = band.finish?.kind === 'library' ? getCatalogMaterialById(band.finish.ref.slice(8)) : undefined;
      const texture = material?.preset.maps.albedoMap ?? material?.previewThumbnailUrl;
      const color = band.finish?.kind === 'paint' ? ralHex(band.finish.ral) ?? '#d6d4cf' : material?.previewColor ?? '#d9c4a0';
      const size = band.finish?.kind === 'library' ? band.finish.scaleMm ?? 1000 : 1000;
      return <g key={index}>
        {texture && <defs><pattern id={`${id}-${index}`} width={size} height={size} patternUnits="userSpaceOnUse" patternTransform={`rotate(${band.finish?.kind === 'library' ? band.finish.rotationDeg ?? 0 : 0})`}><image href={texture} width={size} height={size} preserveAspectRatio="xMidYMid slice" /></pattern></defs>}
        <rect x={0} y={band.y} width={type.width} height={band.height} fill={texture ? `url(#${id}-${index})` : color} />
      </g>;
    })}
    <rect width={type.width} height={type.height} fill="none" stroke="#625b50" strokeWidth={12} />
    {[...type.openings, ...cutouts].map(opening => <polygon key={opening.id} points={openingOutlinePoints(opening).map(p => `${side === 'back' ? type.width - p.x : p.x},${type.height - p.y}`).join(' ')} fill="#f5f7f8" stroke="#625b50" strokeWidth={10}><title>{cutouts.includes(opening) ? 'Technikausschnitt' : 'Öffnung'} · {opening.width} × {opening.height} mm</title></polygon>)}
  </svg>;
}
