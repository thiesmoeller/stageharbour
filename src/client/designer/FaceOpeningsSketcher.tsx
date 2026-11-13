import { useEffect, useMemo, useRef, useState } from 'react';
import type { PartDefinition, PartMaterial } from '../../shared/parts/definition.js';
import type { Vec2 } from '../../shared/parts/math.js';
import type { ResolvedPart, ResolvedSheet } from '../../shared/parts/resolve.js';
import {
  HANDLES, boundsOf, boxFromDrag, boxLoop, clampBoxInside, cleanPolygon, clipBox, deleteOpening, describeBox, distance,
  fromSvg, geometryOf, handlePoint, isUsableBox, loopPath, moveBox, movePoints, moveVertex, newOpeningKey, normalizeBox,
  resizeBox, sketchOpenings, sketchViewBox, snap, writeOpening,
  type Box, type Handle, type OpeningGeometry, type SketchOpening, type SketchTool,
} from './faceSketchView.js';

type Drag =
  | { kind: 'create'; shape: 'rect' | 'arch'; start: Vec2; current: Vec2 }
  | { kind: 'move'; key: string; start: Vec2; current: Vec2; origin: OpeningGeometry }
  | { kind: 'resize'; key: string; handle: Handle; shape: 'rect' | 'arch'; box: Box; current: Vec2 }
  | { kind: 'vertex'; key: string; index: number; points: readonly Vec2[]; current: Vec2 };

const CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
};

const TOOLS: readonly { tool: Exclude<SketchTool, 'polygon'>; label: string; hint: string }[] = [
  { tool: 'select', label: 'Auswählen', hint: 'Öffnung anklicken, verschieben oder an den Griffen ziehen' },
  { tool: 'rect', label: 'Rechteck', hint: 'Rechteckige Öffnung aufziehen' },
  { tool: 'arch', label: 'Bogen', hint: 'Öffnung mit Rundbogen aufziehen' },
];

function asOpening(key: string, geometry: OpeningGeometry): SketchOpening {
  if (geometry.shape === 'polygon') {
    const points = [...geometry.points];
    return { key, shape: 'polygon', points, bounds: boundsOf(points) };
  }
  return { key, shape: geometry.shape, points: boxLoop(geometry.shape, geometry.box), bounds: geometry.box };
}

const errorText = (error: unknown) => error instanceof Error && error.message ? error.message : 'Die Öffnung konnte nicht gespeichert werden.';

/**
 * Face / elevation sketcher of the selected sheet: draw, move, resize and delete openings in the
 * sheet's own u/v frame. Every committed edit is written through the opening-parameter helpers, so
 * the hole formulas and their parameter group stay in sync with the drawing.
 */
export function FaceOpeningsSketcher({ definition, bodyKey, resolved, materials, disabled, onChange }: {
  definition: PartDefinition;
  bodyKey: string;
  resolved: Pick<ResolvedPart, 'solids'> | undefined;
  materials: readonly PartMaterial[];
  disabled: boolean;
  onChange: (definition: PartDefinition) => void;
}) {
  const body = definition.bodies.find(candidate => candidate.key === bodyKey);
  const solid = useMemo(
    () => resolved?.solids.find((candidate): candidate is ResolvedSheet => candidate.kind === 'sheet' && candidate.body === bodyKey),
    [resolved, bodyKey],
  );
  const color = materials.find(material => material.key === body?.material)?.color ?? '#c9cfd2';
  const [tool, setTool] = useState<SketchTool>('select');
  const [moreOpen, setMoreOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string>();
  const [drag, setDrag] = useState<Drag>();
  const [vertices, setVertices] = useState<Vec2[]>([]);
  const [hover, setHover] = useState<Vec2>();
  const [error, setError] = useState('');
  /** Just-committed shapes, shown until the deferred resolve catches up with the draft. */
  const [overrides, setOverrides] = useState<ReadonlyMap<string, SketchOpening | null>>(new Map());
  const svgRef = useRef<SVGSVGElement>(null);
  const canDraw = !disabled && !!solid;

  useEffect(() => { setOverrides(new Map()); }, [solid]);
  useEffect(() => {
    setSelectedKey(undefined); setDrag(undefined); setVertices([]); setHover(undefined); setError(''); setTool('select'); setMoreOpen(false);
  }, [bodyKey]);
  useEffect(() => {
    if (disabled) { setTool('select'); setDrag(undefined); setVertices([]); }
  }, [disabled]);

  const limit = useMemo<Box>(() => solid?.outline.length ? boundsOf(solid.outline) : { x: 0, y: 0, width: 0, height: 0 }, [solid]);
  const viewBox = useMemo(() => sketchViewBox(solid), [solid]);

  const openings = useMemo(() => {
    const merged = new Map<string, SketchOpening>();
    for (const opening of sketchOpenings(solid)) merged.set(opening.key, opening);
    for (const [key, opening] of overrides) {
      if (opening) merged.set(key, opening);
      else merged.delete(key);
    }
    return [...merged.values()];
  }, [solid, overrides]);

  const preview = useMemo(() => {
    if (!drag) return undefined;
    if (drag.kind === 'create') {
      const box = clipBox(boxFromDrag(drag.shape, drag.start, drag.current), limit);
      return { key: undefined, geometry: { shape: drag.shape, box: normalizeBox(drag.shape, box) } as OpeningGeometry, valid: isUsableBox(box) };
    }
    const dx = drag.kind === 'move' ? drag.current.x - drag.start.x : 0, dy = drag.kind === 'move' ? drag.current.y - drag.start.y : 0;
    if (drag.kind === 'move') {
      const origin = drag.origin;
      const geometry: OpeningGeometry = origin.shape === 'polygon'
        ? { shape: 'polygon', points: movePoints(origin.points, dx, dy) }
        : { shape: origin.shape, box: clampBoxInside(moveBox(origin.box, dx, dy), limit) };
      return { key: drag.key, geometry, valid: true };
    }
    if (drag.kind === 'resize') {
      const box = resizeBox(drag.box, drag.handle, drag.current, drag.shape);
      return { key: drag.key, geometry: { shape: drag.shape, box: clipBox(box, limit) } as OpeningGeometry, valid: true };
    }
    return { key: drag.key, geometry: { shape: 'polygon', points: moveVertex(drag.points, drag.index, drag.current) } as OpeningGeometry, valid: true };
  }, [drag, limit]);

  const shown = useMemo(() => openings.map(opening =>
    preview?.key === opening.key ? asOpening(opening.key, preview.geometry) : opening), [openings, preview]);
  const selected = shown.find(opening => opening.key === selectedKey);

  function pointer(event: React.PointerEvent): Vec2 {
    const svg = svgRef.current!;
    const matrix = svg.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = event.clientX; point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    return fromSvg({ x: local.x, y: local.y });
  }

  function commit(key: string, geometry: OpeningGeometry) {
    try {
      onChange(writeOpening(definition, bodyKey, key, geometry));
      setOverrides(current => new Map(current).set(key, asOpening(key, geometry)));
      setSelectedKey(key);
      setError('');
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  function remove(key: string) {
    try {
      onChange(deleteOpening(definition, bodyKey, key));
      setOverrides(current => new Map(current).set(key, null));
      setSelectedKey(undefined);
      setError('');
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  function finishPolygon(points: readonly Vec2[]) {
    const clean = cleanPolygon(points);
    if (clean.length > 1 && distance(clean[0]!, clean[clean.length - 1]!) === 0) clean.pop();
    setVertices([]); setHover(undefined);
    if (clean.length < 3) { setError('Ein Polygon braucht mindestens drei Punkte.'); return; }
    commit(newOpeningKey(definition, bodyKey), { shape: 'polygon', points: clean });
    setTool('select');
  }

  function chooseTool(next: SketchTool) {
    setTool(next); setVertices([]); setHover(undefined); setDrag(undefined); setError('');
    if (next !== 'select') setSelectedKey(undefined);
    setMoreOpen(false);
  }

  function onCanvasDown(event: React.PointerEvent<SVGSVGElement>) {
    if (!canDraw || event.button !== 0) return;
    (event.currentTarget.parentElement as HTMLElement | null)?.focus({ preventScroll: true });
    const point = pointer(event);
    if (tool === 'rect' || tool === 'arch') {
      event.currentTarget.setPointerCapture(event.pointerId);
      setDrag({ kind: 'create', shape: tool, start: point, current: point });
      setError('');
    } else if (tool === 'polygon') {
      const placed = { x: snap(point.x), y: snap(point.y) };
      const tolerance = viewBox.width * 0.02;
      if (vertices.length >= 3 && distance(placed, vertices[0]!) <= tolerance) finishPolygon(vertices);
      else setVertices(current => [...current, placed]);
    } else {
      setSelectedKey(undefined);
    }
  }

  function onCanvasMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!canDraw) return;
    const point = pointer(event);
    if (drag) setDrag({ ...drag, current: point });
    else if (tool === 'polygon' && vertices.length) setHover({ x: snap(point.x), y: snap(point.y) });
  }

  function onCanvasUp(event: React.PointerEvent<SVGSVGElement>) {
    if (!drag) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const finished = drag;
    setDrag(undefined);
    if (!preview) return;
    if (finished.kind === 'create') {
      if (preview.valid) {
        commit(newOpeningKey(definition, bodyKey), preview.geometry);
        setTool('select');
      }
      return;
    }
    const moved = finished.kind === 'move'
      ? snap(finished.current.x - finished.start.x) !== 0 || snap(finished.current.y - finished.start.y) !== 0
      : true;
    if (moved && preview.key) commit(preview.key, preview.geometry);
  }

  function startMove(event: React.PointerEvent, opening: SketchOpening) {
    if (!canDraw || tool !== 'select' || event.button !== 0) return;
    event.stopPropagation();
    svgRef.current?.setPointerCapture(event.pointerId);
    (svgRef.current?.parentElement as HTMLElement | null)?.focus({ preventScroll: true });
    const point = pointer(event);
    setSelectedKey(opening.key);
    setError('');
    setDrag({ kind: 'move', key: opening.key, start: point, current: point, origin: geometryOf(opening) });
  }

  function startResize(event: React.PointerEvent, opening: SketchOpening, handle: Handle) {
    if (!canDraw || opening.shape === 'polygon' || event.button !== 0) return;
    event.stopPropagation();
    svgRef.current?.setPointerCapture(event.pointerId);
    setDrag({ kind: 'resize', key: opening.key, handle, shape: opening.shape, box: opening.bounds, current: pointer(event) });
  }

  function startVertex(event: React.PointerEvent, opening: SketchOpening, index: number) {
    if (!canDraw || event.button !== 0) return;
    event.stopPropagation();
    svgRef.current?.setPointerCapture(event.pointerId);
    setDrag({ kind: 'vertex', key: opening.key, index, points: opening.points, current: pointer(event) });
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (drag) setDrag(undefined);
      else if (vertices.length) { setVertices([]); setHover(undefined); }
      else if (selectedKey) setSelectedKey(undefined);
      else if (tool !== 'select') chooseTool('select');
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && canDraw && selectedKey && !drag) {
      event.preventDefault();
      remove(selectedKey);
    } else if (event.key === 'Enter' && tool === 'polygon' && vertices.length >= 3) {
      event.preventDefault();
      finishPolygon(vertices);
    }
  }

  const handleSize = viewBox.width * 0.012;
  const origin = solid ? { x: limit.x, y: limit.y } : { x: 0, y: 0 };
  const hintText = tool === 'polygon'
    ? vertices.length >= 3 ? 'Weitere Punkte setzen; Doppelklick, Enter oder „Fertig“ schließt das Polygon.' : 'Eckpunkte nacheinander anklicken (mindestens drei).'
    : tool === 'select' ? TOOLS[0]!.hint : TOOLS.find(item => item.tool === tool)?.hint ?? '';
  const readout = selected
    ? `${selected.shape === 'polygon' ? 'Polygon' : selected.shape === 'arch' ? 'Bogen' : 'Rechteck'} „${selected.key}“ · ${describeBox(selected.bounds, origin)}`
    : openings.length ? 'Keine Öffnung ausgewählt.' : 'Noch keine Öffnung auf dieser Platte.';

  return <section className="designer-face-sketcher" data-testid="designer-face-sketcher" data-body={bodyKey}
    data-openings={openings.length} aria-label="Öffnungen auf der Fläche">
    <header className="face-sketcher-bar">
      <div className="face-sketcher-title">
        <strong>Öffnungen auf der Fläche</strong>
        <span className="muted-inline">{body?.label ?? bodyKey}{solid ? ` · ${Math.round(solid.blank.width)} × ${Math.round(solid.blank.height)} mm` : ''}</span>
      </div>
      <div className="face-sketcher-tools" role="toolbar" aria-label="Zeichenwerkzeuge" data-testid="face-sketcher-toolbar">
        {TOOLS.map(item => <button key={item.tool} type="button" className={tool === item.tool ? 'quiet active' : 'quiet'} aria-pressed={tool === item.tool}
          title={item.hint} disabled={!canDraw} data-testid={`face-sketcher-tool-${item.tool}`} onClick={() => chooseTool(item.tool)}>{item.label}</button>)}
        <span className="face-sketcher-more">
          <button type="button" className={tool === 'polygon' ? 'quiet active' : 'quiet'} aria-expanded={moreOpen} aria-haspopup="true"
            disabled={!canDraw} data-testid="face-sketcher-more" onClick={() => setMoreOpen(open => !open)}>Weitere Form ▾</button>
          {moreOpen && <span className="face-sketcher-menu" role="menu">
            <button type="button" role="menuitem" className="quiet" data-testid="face-sketcher-tool-polygon" onClick={() => chooseTool('polygon')}>Polygon</button>
          </span>}
        </span>
        {tool === 'polygon' && vertices.length >= 3 && <button type="button" className="primary" data-testid="face-sketcher-polygon-done"
          onClick={() => finishPolygon(vertices)}>Fertig</button>}
        <button type="button" className="quiet" disabled={!canDraw || !selectedKey} data-testid="face-sketcher-delete"
          onClick={() => selectedKey && remove(selectedKey)}>Löschen</button>
      </div>
    </header>
    <p className="muted face-sketcher-help">
      Fenster- und Türöffnungen direkt auf der Fläche der Platte zeichnen – ohne Formeln.
      {disabled ? ' Nur Ansicht: Ihre Rolle darf Bauteile nicht ändern.' : ` ${hintText}`}
    </p>
    {solid ? <div className={`face-sketcher-canvas tool-${tool}${canDraw ? '' : ' readonly'}`} tabIndex={0} onKeyDown={onKeyDown}
      aria-label="Flächenansicht der Platte; Pfeil- und Zeichenwerkzeuge siehe Werkzeugleiste. Escape hebt die Auswahl auf, Entf löscht."
      data-testid="face-sketcher-surface">
      <svg ref={svgRef} viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`} preserveAspectRatio="xMidYMid meet"
        role="img" aria-label={`Fläche von ${body?.label ?? bodyKey}`} data-testid="face-sketcher-canvas"
        onPointerDown={onCanvasDown} onPointerMove={onCanvasMove} onPointerUp={onCanvasUp} onPointerCancel={() => setDrag(undefined)}
        onDoubleClick={() => { if (tool === 'polygon' && vertices.length >= 3) finishPolygon(vertices); }}>
        <rect x={viewBox.x} y={viewBox.y} width={viewBox.width} height={viewBox.height} fill="transparent" />
        <g transform="scale(1,-1)">
          <path className="face-sheet" d={[solid.outline, ...solid.holes].map(loopPath).join('')} fillRule="evenodd" fill={color} />
          {shown.map(opening => {
            const isSelected = opening.key === selectedKey;
            return <path key={opening.key} d={loopPath(opening.points)} data-testid={`face-sketcher-opening-${opening.key}`}
              data-shape={opening.shape} data-selected={isSelected ? 'true' : undefined}
              className={isSelected ? 'face-opening selected' : 'face-opening'}
              style={{ pointerEvents: canDraw && tool === 'select' ? 'all' : 'none' }}
              onPointerDown={event => startMove(event, opening)}>
              <title>{opening.key}</title>
            </path>;
          })}
          {preview && !preview.key && <path className={preview.valid ? 'face-draft' : 'face-draft invalid'}
            d={loopPath(preview.geometry.shape === 'polygon' ? preview.geometry.points : boxLoop(preview.geometry.shape, preview.geometry.box))} />}
          {vertices.length > 0 && <>
            <path className="face-draft open" d={`M${[...vertices, ...(hover ? [hover] : [])].map(point => `${point.x} ${point.y}`).join('L')}`} />
            {vertices.map((point, index) => <circle key={index} className={index === 0 ? 'face-vertex first' : 'face-vertex'}
              cx={point.x} cy={point.y} r={handleSize * 0.8} />)}
          </>}
          {canDraw && tool === 'select' && selected && selected.shape !== 'polygon' && HANDLES.map(handle => {
            const point = handlePoint(selected.bounds, handle);
            return <rect key={handle} className="face-handle" data-testid={`face-sketcher-handle-${handle}`}
              x={point.x - handleSize} y={point.y - handleSize} width={handleSize * 2} height={handleSize * 2}
              style={{ cursor: CURSORS[handle] }} onPointerDown={event => startResize(event, selected, handle)} />;
          })}
          {canDraw && tool === 'select' && selected?.shape === 'polygon' && selected.points.map((point, index) =>
            <rect key={index} className="face-handle" data-testid={`face-sketcher-vertex-${index}`}
              x={point.x - handleSize} y={point.y - handleSize} width={handleSize * 2} height={handleSize * 2}
              style={{ cursor: 'move' }} onPointerDown={event => startVertex(event, selected, index)} />)}
        </g>
      </svg>
    </div> : <p className="muted face-sketcher-empty" data-testid="face-sketcher-empty">
      Für diese Platte gibt es gerade keine Vorschau (Bedingung nicht erfüllt oder Fehler in den Formeln).
    </p>}
    <footer className="face-sketcher-foot">
      <span className="muted-inline" data-testid="face-sketcher-readout" aria-live="polite">{readout}</span>
      <span className="muted-inline" data-testid="face-sketcher-count">{openings.length} {openings.length === 1 ? 'Öffnung' : 'Öffnungen'}</span>
    </footer>
    {error && <p className="face-sketcher-error" role="alert" data-testid="face-sketcher-error">{error}</p>}
  </section>;
}
