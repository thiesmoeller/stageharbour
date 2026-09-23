import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import type { Calibration, PlanPoint } from '../../shared/venue.js';
import { millimetresPerUnit } from '../../shared/venue.js';
import { useModalFocus } from './useModalFocus.js';

type Overlay = { href: string; pixelWidth: number; pixelHeight: number };

/**
 * SweetHome3D-style underlay setup entirely inside the dialog:
 * rotate, zoom/pan the preview, draw a known-length measure line on the image,
 * then apply calibration to the main plan on confirm.
 */
export function VenueUnderlayDialog({
  open, overlay, page, pageCount, rotationDeg, calibration,
  busy, onClose, onRotation, onPage, onCalibration, onConfirm,
}: {
  open: boolean;
  overlay?: Overlay;
  page: number;
  pageCount: number | null;
  rotationDeg: number;
  calibration: Calibration;
  busy: boolean;
  onClose: () => void;
  onRotation: (deg: number) => void;
  onPage: (page: number) => void;
  onCalibration: (next: Calibration) => void;
  onConfirm: () => void;
}) {
  const [distance, setDistance] = useState(String(calibration.distanceMm || 1000));
  const [measureMode, setMeasureMode] = useState(false);
  const [pendingA, setPendingA] = useState<PlanPoint>();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const svg = useRef<SVGSVGElement>(null);
  const imageGroup = useRef<SVGGElement>(null);
  const panDrag = useRef<{ clientX: number; clientY: number; panX: number; panY: number } | undefined>(undefined);
  const close = useCallback(() => { if (!busy) onClose(); }, [busy, onClose]);
  const dialogRef = useModalFocus<HTMLFormElement>(open, close);
  useEffect(() => {
    setDistance(String(calibration.distanceMm || 1000));
    setMeasureMode(false);
    setPendingA(undefined);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [open, overlay?.href]);
  useEffect(() => { setDistance(String(calibration.distanceMm || 1000)); }, [calibration.distanceMm]);
  if (!open) return null;
  const width = overlay?.pixelWidth ?? 1;
  const height = overlay?.pixelHeight ?? 1;
  const cx = width / 2, cy = height / 2;
  const viewW = width / zoom, viewH = height / zoom;
  const viewX = (width - viewW) / 2 + pan.x;
  const viewY = (height - viewH) / 2 + pan.y;
  const parsedDistance = Number(distance);
  const distanceMm = Number.isFinite(parsedDistance) && parsedDistance >= 1 ? parsedDistance : (calibration.distanceMm || 1000);
  const hasSegment = Math.hypot(calibration.pointB.x - calibration.pointA.x, calibration.pointB.y - calibration.pointA.y) > 0;
  const unit = (() => {
    try { return hasSegment ? millimetresPerUnit({ ...calibration, distanceMm }) : undefined; }
    catch { return undefined; }
  })();
  const measureStatus = measureMode
    ? (!pendingA ? 'Ersten Punkt auf dem Bild anklicken.' : 'Zweiten Punkt anklicken (bekannte Kante).')
    : hasSegment ? 'Messlinie gesetzt — Länge prüfen und übernehmen.' : undefined;

  function sourcePoint(event: { clientX: number; clientY: number }): PlanPoint {
    const matrix = imageGroup.current?.getScreenCTM() ?? svg.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const value = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return {
      x: Math.max(0, Math.min(width, Math.round(value.x))),
      y: Math.max(0, Math.min(height, Math.round(value.y))),
    };
  }

  function onPreviewPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button === 1 || (event.button === 0 && event.altKey) || (event.button === 0 && !measureMode)) {
      event.preventDefault();
      panDrag.current = { clientX: event.clientX, clientY: event.clientY, panX: pan.x, panY: pan.y };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0 || !measureMode || !overlay) return;
    event.preventDefault();
    const point = sourcePoint(event);
    if (!pendingA) { setPendingA(point); return; }
    onCalibration({ pointA: pendingA, pointB: point, distanceMm });
    setPendingA(undefined);
    setMeasureMode(false);
  }

  function onPreviewPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = panDrag.current;
    if (!drag || !svg.current) return;
    const scale = viewW / svg.current.clientWidth;
    setPan({
      x: drag.panX - (event.clientX - drag.clientX) * scale,
      y: drag.panY - (event.clientY - drag.clientY) * scale,
    });
  }

  function endPan(event: ReactPointerEvent<SVGSVGElement>) {
    if (!panDrag.current) return;
    panDrag.current = undefined;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
  }

  function onPreviewWheel(event: ReactWheelEvent<SVGSVGElement>) {
    event.preventDefault();
    if (!svg.current) return;
    const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
    const nextZoom = Math.min(12, Math.max(0.4, zoom * factor));
    const rect = svg.current.getBoundingClientRect();
    const fracX = (event.clientX - rect.left) / rect.width;
    const fracY = (event.clientY - rect.top) / rect.height;
    const anchorX = viewX + fracX * viewW;
    const anchorY = viewY + fracY * viewH;
    const nextViewW = width / nextZoom, nextViewH = height / nextZoom;
    setZoom(nextZoom);
    setPan({
      x: anchorX - fracX * nextViewW - (width - nextViewW) / 2,
      y: anchorY - fracY * nextViewH - (height - nextViewH) / 2,
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onCalibration({ ...calibration, distanceMm });
    onConfirm();
  }

  const lineA = pendingA ?? (hasSegment ? calibration.pointA : undefined);
  const lineB = pendingA ? undefined : (hasSegment ? calibration.pointB : undefined);
  const stroke = Math.max(2, Math.min(width, height) / 200);
  const radius = Math.max(4, Math.min(width, height) / 80);

  return <div className="modal-backdrop" role="presentation" onClick={close}>
    <form ref={dialogRef} className="modal underlay-dialog underlay-dialog--workspace" role="dialog"
      aria-labelledby="underlay-dialog-title" aria-modal="true" tabIndex={-1}
      onClick={event => event.stopPropagation()} onSubmit={submit}>
      <h2 id="underlay-dialog-title">Planunterlage einrichten</h2>
      <p className="muted">Bild drehen und zoomen, dann eine bekannte Strecke auf dem Bild abgreifen. Erst danach erscheint die Vorlage maßstäblich im Grundriss.</p>

      {pageCount != null && pageCount > 1 && <div>
        <label htmlFor="underlay-page">PDF-Seite</label>
        <input id="underlay-page" type="number" min={1} max={pageCount} value={page}
          onChange={event => onPage(Number(event.target.value))} disabled={busy} />
      </div>}

      <div>
        <label htmlFor="underlay-rotation">Drehung ({Math.round(rotationDeg)}°)</label>
        <input id="underlay-rotation" type="range" min={-180} max={180} step={1} value={rotationDeg}
          onChange={event => onRotation(Number(event.target.value))} disabled={busy || !overlay} />
      </div>

      {overlay ? <div className="underlay-workspace">
        <div className="underlay-workspace-toolbar">
          <button type="button" className="quiet" disabled={busy} onClick={() => setZoom(z => Math.min(12, z * 1.25))}
            title="Vergrößern" aria-label="Vergrößern">+</button>
          <button type="button" className="quiet" disabled={busy} onClick={() => setZoom(z => Math.max(0.4, z / 1.25))}
            title="Verkleinern" aria-label="Verkleinern">−</button>
          <button type="button" className="quiet" disabled={busy} onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Einpassen</button>
          <span className="muted">{Math.round(zoom * 100)} %</span>
          <span className="muted underlay-workspace-hint">Ziehen verschiebt · Rad zoomt · bei Messlinie: Alt+Ziehen verschiebt</span>
        </div>
        <svg ref={svg} className={`underlay-workspace-svg${measureMode ? ' underlay-workspace-svg--measure' : ''}`}
          role="img" aria-label="Vorlagenvorschau" data-testid="underlay-preview-svg"
          viewBox={`${viewX} ${viewY} ${viewW} ${viewH}`}
          onPointerDown={onPreviewPointerDown}
          onPointerMove={onPreviewPointerMove}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          onWheel={onPreviewWheel}
          onAuxClick={event => event.preventDefault()}>
          <g ref={imageGroup} transform={`rotate(${rotationDeg} ${cx} ${cy})`}>
            <image href={overlay.href} x={0} y={0} width={width} height={height} />
            {lineA && lineB && <line data-testid="underlay-dialog-measure"
              x1={lineA.x} y1={lineA.y} x2={lineB.x} y2={lineB.y}
              stroke="#b67c35" strokeWidth={stroke} strokeDasharray={`${stroke * 4} ${stroke * 3}`} />}
            {lineA && <circle cx={lineA.x} cy={lineA.y} r={radius} fill="#b67c35" />}
            {lineB && <circle cx={lineB.x} cy={lineB.y} r={radius} fill="#b67c35" />}
          </g>
        </svg>
      </div> : <p className="muted">Keine Vorlage geladen.</p>}

      <fieldset className="underlay-measure">
        <legend>Maßstab</legend>
        {measureStatus && <p className="underlay-measure-status" role="status">{measureStatus}</p>}
        <p className="muted">Zwei Punkte auf einer bekannten Kante setzen (z.&nbsp;B. 9900&nbsp;mm Wand).</p>
        <div className="form-actions">
          <button type="button" className={measureMode ? '' : 'quiet'} disabled={busy || !overlay}
            onClick={() => { setPendingA(undefined); setMeasureMode(true); }}>
            {measureMode ? 'Messpunkte setzen …' : 'Messlinie im Bild setzen'}
          </button>
          <button type="button" className="quiet" disabled={busy || (!hasSegment && !pendingA)} onClick={() => {
            setPendingA(undefined); setMeasureMode(false);
            onCalibration({ pointA: { x: 0, y: 0 }, pointB: { x: 0, y: 0 }, distanceMm });
          }}>Messlinie löschen</button>
        </div>
        <div>
          <label htmlFor="underlay-distance">Bekannte Länge (mm)</label>
          <input id="underlay-distance" type="number" min={1} step="any" value={distance}
            onChange={event => setDistance(event.target.value)} disabled={busy} required />
        </div>
        {hasSegment && unit != null && (
          <p className="muted">Maßstab: {unit.toFixed(3)} mm je Vorlagen-Einheit</p>
        )}
      </fieldset>

      <div className="form-actions">
        <button type="button" className="quiet" onClick={close} disabled={busy}>Abbrechen</button>
        <button type="submit" disabled={busy || !overlay}>Im Grundriss übernehmen</button>
      </div>
    </form>
  </div>;
}
