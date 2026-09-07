import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from 'react';
import { z } from 'zod';
import { venueGeometrySchema, type VenueGeometry } from '../../shared/layout.js';
import { venueReferenceSchema, type VenueReference } from '../../shared/contracts.js';
import { VenueLevels } from './VenueLevels.js';
import { calibrationSchema, measuredOutline, millimetresPerUnit, type Calibration, type PlanPoint } from '../../shared/venue.js';
import { type Platform, type StairUnit } from '../../shared/levels.js';
import { ApiError, request, upload } from '../api.js';

export function VenuePanel({ workspaceId, sceneId, venue, readOnly, onSaved }: {
  workspaceId: string; sceneId: string; venue: VenueGeometry; readOnly: boolean;
  onSaved: (venue: VenueGeometry) => void;
}) {
  const [vertices, setVertices] = useState(() => measuredOutline(venue));
  const [platforms, setPlatforms] = useState<Platform[]>(() => venue.platforms ?? []);
  const [stairs, setStairs] = useState<StairUnit[]>(() => venue.stairs ?? []);
  const [fileId, setFileId] = useState(venue.trace?.fileId);
  const [page, setPage] = useState(venue.trace?.page ?? 1);
  const [calibration, setCalibration] = useState<Calibration>(venue.trace?.calibration ?? {
    pointA: { x: 0, y: 0 }, pointB: { x: 0, y: 0 }, distanceMm: 1000,
  });
  const [click, setClick] = useState<'vertex' | 'a' | 'b'>('vertex');
  const [meta, setMeta] = useState<VenueReference>();
  const [overlay, setOverlay] = useState<{ href: string; pixelWidth: number; pixelHeight: number }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const svg = useRef<SVGSVGElement>(null);
  const parsed = calibrationSchema.safeParse(calibration);
  const unit = parsed.success ? millimetresPerUnit(parsed.data) : 1;
  useEffect(() => {
    if (!fileId) { setMeta(undefined); setOverlay(undefined); return; }
    let cancelled = false;
    const base = `/api/workspaces/${workspaceId}/venue-references/${fileId}`;
    request(base).then(async data => {
      const record = venueReferenceSchema.parse(data);
      const response = await fetch(`${base}/file`, { credentials: 'same-origin' });
      if (!response.ok) throw new ApiError(response.status, 'Vorlage fehlgeschlagen.');
      const bytes = await response.arrayBuffer();
      const image = record.kind === 'pdf'
        ? await pdfPageImage(bytes, page)
        : { href: URL.createObjectURL(new Blob([bytes], { type: record.mediaType })), pixelWidth: record.pixelWidth ?? 1, pixelHeight: record.pixelHeight ?? 1 };
      if (!cancelled) { setMeta(record); setOverlay(image); }
    }).catch(() => { if (!cancelled) setError('Die Vorlage konnte nicht geladen werden.'); });
    return () => { cancelled = true; };
  }, [fileId, page, workspaceId]);
  function planPoint(event: PointerEvent) {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const value = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: Math.round(value.x), y: Math.round(-value.y) };
  }
  function toSource(point: PlanPoint): PlanPoint {
    const height = overlay?.pixelHeight ?? 0;
    return { x: Math.round(point.x / unit), y: Math.round(height - point.y / unit) };
  }
  function onPlan(event: PointerEvent) {
    if (readOnly || event.button !== 0) return;
    const point = planPoint(event);
    if (click === 'vertex') setVertices(current => [...current, point]);
    else setCalibration(current => ({ ...current, [click === 'a' ? 'pointA' : 'pointB']: overlay ? toSource(point) : point }));
  }
  async function chooseFile(file?: File) {
    if (!file) return;
    setBusy(true); setError('');
    try {
      const stored = venueReferenceSchema.parse(await upload(`/api/workspaces/${workspaceId}/venue-references`, file));
      setFileId(stored.id); setMeta(stored); setPage(1);
    } catch { setError('Die Datei konnte nicht hochgeladen werden.'); }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    const trace = fileId ? {
      fileId, ...(meta?.kind === 'pdf' ? { page } : {}),
      ...(parsed.success ? { calibration: parsed.data } : {}),
    } : undefined;
    const result = venueGeometrySchema.safeParse({
      schemaVersion: 1, width: venue.width, depth: venue.depth, outline: vertices, trace,
      platforms, stairs,
    });
    if (!result.success) { setError('Bitte prüfen Sie den Umriss und die Kalibrierung.'); return; }
    setBusy(true); setError('');
    try {
      const body = await request(`/api/workspaces/${workspaceId}/scenes/${sceneId}/venue`, { venue: result.data }, 'PUT');
      onSaved(z.object({ venue: venueGeometrySchema }).parse(body).venue);
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 400 ? 'Ungültiger Umriss oder ungültige Vorlage.' : 'Die Spielstätte konnte nicht gespeichert werden.');
    } finally { setBusy(false); }
  }
  const width = overlay ? overlay.pixelWidth * unit : Math.max(venue.width, ...vertices.map(point => point.x));
  const height = overlay ? overlay.pixelHeight * unit : Math.max(venue.depth, ...vertices.map(point => point.y));
  return <section className="export-panel" aria-label="Spielstätte">
    <h3>Spielstätte</h3>
    <p className="muted">Umriss in Millimetern. Optional eine Bild- oder PDF-Vorlage nach Kalibrierung nachzeichnen.</p>
    <div className="venue-plan">
      <svg ref={svg} role="img" aria-label="Umriss der Spielstätte" viewBox={`${Math.min(0, ...vertices.map(p => p.x)) - 400} ${-Math.max(height, ...vertices.map(p => p.y)) - 400} ${Math.max(width, ...vertices.map(p => p.x)) + 800} ${Math.max(height, ...vertices.map(p => p.y)) + 1200}`}
        onPointerDown={onPlan}>
        {overlay && <image href={overlay.href} x="0" y={-overlay.pixelHeight * unit} width={overlay.pixelWidth * unit} height={overlay.pixelHeight * unit} opacity="0.55" />}
        <path data-testid="venue-outline" d={`${vertices.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${-point.y}`).join(' ')} Z`}
          fill="none" stroke="#718469" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        {vertices.map((point, index) => <circle key={index} cx={point.x} cy={-point.y} r="40" fill="#b67c35" />)}
      </svg>
    </div>
    <form onSubmit={event => void save(event)}><fieldset disabled={readOnly || busy}>
      {vertices.map((point, index) => <div className="numeric-fields" key={index}>
        <div><label htmlFor={`vertex-x-${index}`}>Eckpunkt {index + 1} X (mm)</label>
          <input id={`vertex-x-${index}`} type="number" step="any" value={point.x} onChange={event => setVertices(current => current.map((item, i) => i === index ? { ...item, x: Number(event.target.value) } : item))} /></div>
        <div><label htmlFor={`vertex-y-${index}`}>Eckpunkt {index + 1} Y (mm)</label>
          <input id={`vertex-y-${index}`} type="number" step="any" value={point.y} onChange={event => setVertices(current => current.map((item, i) => i === index ? { ...item, y: Number(event.target.value) } : item))} /></div>
      </div>)}
      <div className="form-actions">
        <button type="button" className="quiet" onClick={() => { setClick('vertex'); setVertices(current => [...current, { x: venue.width / 2, y: venue.depth / 2 }]); }}>Eckpunkt hinzufügen</button>
        <button type="button" className="quiet" disabled={vertices.length <= 3} onClick={() => setVertices(current => current.slice(0, -1))}>Letzten Eckpunkt entfernen</button>
      </div>
      <label htmlFor="venue-file">Vorlage hochladen</label>
      <input id="venue-file" type="file" accept="image/png,image/jpeg,application/pdf" onChange={event => void chooseFile(event.currentTarget.files?.[0])} />
      {meta?.kind === 'pdf' && <div><label htmlFor="venue-page">PDF-Seite</label>
        <input id="venue-page" type="number" min={1} max={meta.pageCount ?? 1} value={page} onChange={event => setPage(Number(event.target.value))} /></div>}
      <p className="muted">Zwei Referenzpunkte in der Vorlage und eine bekannte Strecke setzen den Maßstab.</p>
      <div className="form-actions">
        <button type="button" className={click === 'a' ? '' : 'quiet'} onClick={() => setClick('a')}>Punkt A in der Vorlage</button>
        <button type="button" className={click === 'b' ? '' : 'quiet'} onClick={() => setClick('b')}>Punkt B in der Vorlage</button>
      </div>
      <div className="numeric-fields">
        {([['pointA', 'a', 'Punkt A'], ['pointB', 'b', 'Punkt B']] as const).flatMap(([key, , label]) => (
          [['x', `${label} X`], ['y', `${label} Y`]] as const).map(([axis, name]) => <div key={name}>
            <label htmlFor={`cal-${key}-${axis}`}>{name}</label>
            <input id={`cal-${key}-${axis}`} type="number" step="any" value={calibration[key][axis]}
              onChange={event => setCalibration(current => ({ ...current, [key]: { ...current[key], [axis]: Number(event.target.value) } }))} />
          </div>))}
        <div><label htmlFor="cal-distance">Bekannte Strecke (mm)</label>
          <input id="cal-distance" type="number" min={1} step="any" value={calibration.distanceMm}
            onChange={event => setCalibration(current => ({ ...current, distanceMm: Number(event.target.value) }))} /></div>
      </div>
      {parsed.success && <p className="muted">Maßstab: {millimetresPerUnit(parsed.data)} mm je Vorlagen-Einheit</p>}
      <VenueLevels venue={venue} platforms={platforms} stairs={stairs} readOnly={readOnly} onPlatforms={setPlatforms} onStairs={setStairs} />
      {error && <p className="error" role="alert">{error}</p>}
      <div className="form-actions"><button type="submit">Spielstätte speichern</button></div>
    </fieldset></form>
  </section>;
}

async function pdfPageImage(bytes: ArrayBuffer, pageNumber: number) {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  try {
    const pdfPage = await pdf.getPage(pageNumber);
    const viewport = pdfPage.getViewport({ scale: 1 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const canvasContext = canvas.getContext('2d');
    if (!canvasContext) throw new Error('canvas');
    await pdfPage.render({ canvas, canvasContext, viewport }).promise;
    return { href: canvas.toDataURL('image/png'), pixelWidth: canvas.width, pixelHeight: canvas.height };
  } finally { await pdf.cleanup(); }
}
