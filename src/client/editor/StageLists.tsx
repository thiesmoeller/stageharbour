import type { BraceSolid } from '../../shared/braceTransforms.js';
import type { Curtain } from '../../shared/curtains.js';
import type { OverheadBox } from '../../shared/overhead.js';
import type { PlaceholderSolid } from '../../shared/placeholders.js';
import type { StageModel } from '../../shared/transforms.js';
import type { Truss } from '../../shared/truss.js';

/*
 * Text equivalents of what the Raumsicht draws, for screen readers and tests. Kept free of
 * three.js so the editor shell does not pull the 3D code into the first load.
 */

export function StagePlaceholderList({ placeholders }: { placeholders: PlaceholderSolid[] }) {
  if (!placeholders.length) return null;
  return <ul aria-label="Platzhalter in der Raumsicht">{placeholders.map(item => <li key={item.id} data-testid={`stage-placeholder-${item.id}`}
    data-x={item.center.x} data-y={item.center.y} data-z={item.center.z}
    data-height={item.size.y} data-width={item.size.x} data-depth={item.size.z} data-kind={item.kind}
    data-seated={item.seatedFigure ? 'true' : undefined}>
    {item.label}: {item.size.x} × {item.size.z} mm, {item.size.y} mm hoch{item.seatedFigure ? ', Sitzfigur' : ''}</li>)}</ul>;
}

export function StageBraceList({ braces }: { braces: BraceSolid[] }) {
  if (!braces.length) return null;
  return <ul aria-label="Stützen in der Raumsicht">{braces.map(brace => <li key={brace.id} data-testid={`stage-brace-${brace.id}`}
    data-x={brace.center.x} data-y={brace.center.y} data-z={brace.center.z}
    data-slabs={brace.ballast.filter(part => part.kind === 'slab').length} data-straps={brace.ballast.some(part => part.kind === 'buckle') ? 1 : 0}
    data-height={brace.size.y} data-footprint-width={brace.size.x} data-footprint-depth={brace.size.z}>
    {brace.label}: Stützdreieck {brace.size.x} × {brace.size.z} mm, {brace.size.y} mm hoch</li>)}</ul>;
}

export function StageLevelList({ model }: { model: StageModel }) {
  if (!model.platforms.length && !model.stairs.length) return null;
  return <ul aria-label="Ebenen in der Raumsicht">
    {model.platforms.map(platform => <li key={platform.id} data-testid={`stage-platform-${platform.id}`} data-elevation={platform.elevation}>
      {platform.label}: {platform.elevation} mm über Fußboden</li>)}
    {model.stairs.map(stair => <li key={stair.id} data-testid={`stage-stair-${stair.id}`} data-rise={stair.rise}>
      {stair.label}: {stair.rise} mm Steigung</li>)}
  </ul>;
}

export function StageOverheadList({ boxes, trusses = [] }: { boxes: OverheadBox[]; trusses?: Truss[] }) {
  if (!boxes.length && !trusses.length) return null;
  return <ul aria-label="Überbauungen in der Raumsicht">
    {boxes.map(box => <li key={box.id} data-testid={`stage-overhead-${box.id}`}
      data-x={box.x} data-z={box.y} data-bottom={box.bottomHeight} data-thickness={box.thickness}
      data-length={box.length} data-width={box.width} data-rotation={box.rotation}>
      {box.label}: Unterkante {box.bottomHeight} mm, {box.length} × {box.width} × {box.thickness} mm</li>)}
    {trusses.map(truss => <li key={truss.id} data-testid={`stage-truss-${truss.id}`}
      data-x={truss.x} data-z={truss.y} data-bottom={truss.bottomHeight} data-thickness={truss.thickness}
      data-length={truss.length} data-width={truss.sectionWidth} data-rotation={truss.rotation}>
      {truss.label}: Unterkante {truss.bottomHeight} mm, {truss.length} × {truss.sectionWidth} × {truss.thickness} mm</li>)}
  </ul>;
}

export function StageCurtainList({ curtains }: { curtains: Curtain[] }) {
  if (!curtains.length) return null;
  return <ul aria-label="Molton-Vorhänge in der Raumsicht">
    {curtains.map(curtain => <li key={curtain.id} data-testid={`stage-curtain-${curtain.id}`}
      data-x={curtain.x} data-z={curtain.y} data-length={curtain.length} data-height={curtain.height}
      data-open={curtain.openPercent} data-opening={curtain.opening} data-rotation={curtain.rotation}>
      {curtain.label}: {curtain.length} × {curtain.height} mm · {curtain.opening === 'traveler' ? 'Traveler' : curtain.opening === 'stackLeft' ? 'Stapel links' : 'Stapel rechts'} · {Math.round(curtain.openPercent)}% offen
    </li>)}
  </ul>;
}
