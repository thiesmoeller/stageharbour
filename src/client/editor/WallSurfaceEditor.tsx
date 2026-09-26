import { useState } from 'react';
import { MATERIAL_CATALOG, toLibraryMaterialRef } from '@pascal-app/core';
import {
  DEFAULT_LIBRARY_SCALE_MM, DEFAULT_SURFACE_SPLIT_MM, SURFACE_ROTATIONS_DEG,
  applyUniformFinish, faceIsBanded, patchWallSurfaces, resolveFaceBand, resolveUniformFinish,
  surfacesArePerFace,
  type FaceBandId, type SurfaceFinish, type SurfaceRotationDeg, type WallFaceId, type WallSurfaces,
} from '../../shared/surfaces.js';
import { RAL_PAINT_SWATCHES, ralLabel } from '../../shared/ral.js';

const TEXTURED_CATEGORIES = new Set([
  'wood', 'stone', 'brick', 'tile', 'concrete', 'metal', 'fabric', 'leather', 'roofing', 'ground', 'glass',
]);

const libraryItems = MATERIAL_CATALOG.filter(item => TEXTURED_CATEGORIES.has(item.category));

function FinishEditor({
  id, finish, onChange, faceHeightMm,
}: {
  id: string;
  finish: SurfaceFinish | undefined;
  onChange: (next: SurfaceFinish | undefined) => void;
  faceHeightMm: number;
}) {
  const kind = finish?.kind ?? 'none';
  return <div className="surface-finish-editor" data-testid={id}>
    <label>
      Art
      <select aria-label={`${id} Art`} value={kind} onChange={event => {
        const value = event.target.value;
        if (value === 'none') onChange(undefined);
        else if (value === 'paint') onChange({ kind: 'paint', ral: finish?.kind === 'paint' ? finish.ral : '9010' });
        else {
          const ref = finish?.kind === 'library' ? finish.ref : toLibraryMaterialRef(libraryItems[0]?.id ?? 'wood-finewood27');
          onChange({
            kind: 'library', ref,
            scaleMm: finish?.kind === 'library' ? finish.scaleMm : DEFAULT_LIBRARY_SCALE_MM,
            rotationDeg: finish?.kind === 'library' ? finish.rotationDeg : 0,
          });
        }
      }}>
        <option value="none">Sperrholz (Standard)</option>
        <option value="paint">RAL-Wandfarbe</option>
        <option value="library">Bibliothek (Holz, Stoff, …)</option>
      </select>
    </label>
    {finish?.kind === 'paint' && <div className="ral-picker" data-testid={`${id}-paint`}>
      <div className="ral-swatches" role="listbox" aria-label="RAL-Wandfarbe">
        {RAL_PAINT_SWATCHES.map(swatch => <button key={swatch.code} type="button" role="option"
          className={`ral-swatch${finish.ral === swatch.code ? ' is-selected' : ''}`}
          aria-selected={finish.ral === swatch.code}
          title={ralLabel(swatch.code)}
          style={{ background: swatch.hex }}
          onClick={() => onChange({ kind: 'paint', ral: swatch.code })} />)}
      </div>
    </div>}
    {finish?.kind === 'library' && <>
      <label>
        Oberfläche
        <select aria-label={`${id} Bibliothek`} value={finish.ref} onChange={event => onChange({ ...finish, ref: event.target.value })}>
          {libraryItems.map(item =>
            <option key={item.id} value={toLibraryMaterialRef(item.id)}>{item.label} · {item.category}</option>)}
        </select>
      </label>
      <label>
        Mustermaß (mm)
        <input aria-label={`${id} Mustermaß`} type="number" min={50} max={20000} step={50}
          value={finish.scaleMm ?? DEFAULT_LIBRARY_SCALE_MM}
          onChange={event => onChange({ ...finish, scaleMm: Number(event.target.value) || DEFAULT_LIBRARY_SCALE_MM })} />
      </label>
      <label>
        Faserrichtung
        <select aria-label={`${id} Faserrichtung`} value={finish.rotationDeg ?? 0}
          onChange={event => onChange({ ...finish, rotationDeg: Number(event.target.value) as SurfaceRotationDeg })}>
          {SURFACE_ROTATIONS_DEG.map(deg => <option key={deg} value={deg}>{deg}°</option>)}
        </select>
      </label>
      <p className="muted">Mustermaß ≈ Kachelbreite auf der Fläche ({Math.round(faceHeightMm)} mm hoch).</p>
    </>}
  </div>;
}

function FaceEditors({
  surfaces, panelHeight, onChange,
}: {
  surfaces: WallSurfaces | undefined;
  panelHeight: number;
  onChange: (next: WallSurfaces | undefined) => void;
}) {
  const faces: { id: WallFaceId; label: string }[] = [
    { id: 'front', label: 'Vorderseite' },
    { id: 'back', label: 'Rückseite' },
    { id: 'edge', label: 'Kante' },
  ];
  return <>
    {faces.map(face => {
      if (face.id === 'edge') {
        const edge = surfaces?.edge;
        return <details key={face.id} open={!!edge}>
          <summary>{face.label}</summary>
          <FinishEditor id={`surface-${face.id}`} finish={edge} faceHeightMm={panelHeight}
            onChange={next => onChange(patchWallSurfaces(surfaces, 'edge', { edge: next ?? null }))} />
        </details>;
      }
      const faceSurf = surfaces?.[face.id];
      const banded = faceIsBanded(faceSurf);
      const split = faceSurf?.splitMm ?? DEFAULT_SURFACE_SPLIT_MM;
      return <details key={face.id} open={!!faceSurf}>
        <summary>{face.label}</summary>
        <label>
          Aufteilung
          <select aria-label={`${face.label} Aufteilung`} value={banded ? 'bands' : 'full'}
            onChange={event => {
              const mode = event.target.value as 'full' | 'bands';
              onChange(patchWallSurfaces(surfaces, face.id, { mode, splitMm: split }));
            }}>
            <option value="full">Ganzflächig</option>
            <option value="bands">Zwei Streifen</option>
          </select>
        </label>
        {banded && <label>
          Teilungshöhe (mm von unten)
          <input aria-label={`${face.label} Teilungshöhe`} type="number" min={1} max={panelHeight - 1}
            value={split}
            onChange={event => onChange(patchWallSurfaces(surfaces, face.id, {
              mode: 'bands', splitMm: Number(event.target.value) || DEFAULT_SURFACE_SPLIT_MM,
            }))} />
        </label>}
        {!banded && <FinishEditor id={`surface-${face.id}-full`}
          finish={resolveFaceBand(faceSurf, 'full')} faceHeightMm={panelHeight}
          onChange={next => onChange(patchWallSurfaces(surfaces, face.id, { mode: 'full', full: next ?? null }))} />}
        {banded && (['lower', 'upper'] as FaceBandId[]).map(band => <div key={band}>
          <h5>{band === 'lower' ? 'Unterer Streifen' : 'Oberer Streifen'}</h5>
          <FinishEditor id={`surface-${face.id}-${band}`}
            finish={resolveFaceBand(faceSurf, band)}
            faceHeightMm={band === 'lower' ? split : Math.max(1, panelHeight - split)}
            onChange={next => onChange(patchWallSurfaces(surfaces, face.id, {
              mode: 'bands', splitMm: split, [band]: next ?? null,
            }))} />
        </div>)}
      </details>;
    })}
  </>;
}

export function WallSurfaceEditor({
  surfaces, panelHeight, onChange, readOnly = false,
}: {
  surfaces: WallSurfaces | undefined;
  panelHeight: number;
  onChange: (next: WallSurfaces | undefined) => void;
  readOnly?: boolean;
}) {
  const dataNeedsPerFace = surfacesArePerFace(surfaces);
  const [forcePerFace, setForcePerFace] = useState(dataNeedsPerFace);
  const perFace = forcePerFace || dataNeedsPerFace;
  return <fieldset className="wall-surface-editor" disabled={readOnly} data-testid="surface-editor">
    <legend>Oberflächen</legend>
    <label>
      Zuweisung
      <select aria-label="Oberflächen-Zuweisung" data-testid="surface-assignment-mode"
        value={perFace ? 'perFace' : 'uniform'}
        onChange={event => {
          const next = event.target.value === 'perFace';
          setForcePerFace(next);
          if (!next) onChange(applyUniformFinish(resolveUniformFinish(surfaces)));
        }}>
        <option value="uniform">Alle Seiten gleich</option>
        <option value="perFace">Pro Seite (Vorderseite / Rückseite / Kante)</option>
      </select>
    </label>
    {!perFace && <>
      <p className="muted">Ein Material für Vorderseite, Rückseite und Kante.</p>
      <FinishEditor id="surface-uniform" finish={resolveUniformFinish(surfaces)} faceHeightMm={panelHeight}
        onChange={next => onChange(applyUniformFinish(next))} />
    </>}
    {perFace && <>
      <p className="muted">Farbe oder Bibliotheksmaterial je Seite — optional zwei Streifen (unten/oben).</p>
      <FaceEditors surfaces={surfaces} panelHeight={panelHeight} onChange={onChange} />
    </>}
  </fieldset>;
}
