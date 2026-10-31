import { useId, useRef, useState, type PointerEvent } from 'react';
import { FRAME_LABELS, moveStudioFrame, resizeStudioFrame, type SnapGuide } from '../../shared/documentStudio.js';
import type { DocumentFrame, DocumentPage, DrawnSheet, Paint } from '../../shared/exportDocument.js';

function PaintItem({ item, images }: { item: Paint; images: Record<string, string> }) {
  const dash = 'dash' in item ? item.dash?.join(' ') : undefined;
  switch (item.op) {
    case 'poly': return <polygon points={item.points.map(p => `${p.x},${p.y}`).join(' ')} fill={item.fill ?? 'none'} stroke={item.stroke} strokeWidth={item.line ?? 0.6} strokeDasharray={dash} />;
    case 'line': return <line x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} stroke={item.stroke} strokeWidth={item.line ?? 0.6} strokeDasharray={dash} />;
    case 'circle': return <circle cx={item.cx} cy={item.cy} r={item.r} fill={item.fill ?? 'none'} stroke={item.stroke} strokeWidth={item.line ?? 0.6} strokeDasharray={dash} />;
    case 'arc': {
      const point = (angle: number) => ({ x: item.cx + Math.cos(angle * Math.PI / 180) * item.r, y: item.cy + Math.sin(angle * Math.PI / 180) * item.r });
      const points = Array.from({ length: 33 }, (_, index) => point(item.startAngleDeg + (item.endAngleDeg - item.startAngleDeg) * index / 32));
      return <polyline points={points.map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke={item.stroke} strokeWidth={item.line ?? 0.6} strokeDasharray={dash} />;
    }
    case 'text': return <text x={item.x} y={item.y} fontSize={item.size * 25.4 / 72} fontWeight={item.bold ? 700 : 400} fill={item.color} dominantBaseline="hanging">{item.text}</text>;
    case 'image': return images[item.frameId]
      ? <image href={images[item.frameId]} x={item.x} y={item.y} width={item.width} height={item.height} preserveAspectRatio="xMidYMid meet" />
      : <g><rect x={item.x} y={item.y} width={item.width} height={item.height} fill="#f1f3ef" /><path d={`M ${item.x + item.width / 2 - 9} ${item.y + item.height / 2} l 9 -6 l 9 6 l -9 6 Z`} fill="none" stroke="#98a89d" strokeWidth="0.5" /><text x={item.x + item.width / 2} y={item.y + item.height / 2 + 12} textAnchor="middle" fontSize="3" fill="#718479">Raumsicht aufnehmen</text></g>;
    case 'link': return null;
  }
}

export function DocumentSheetArtwork({ sheet, images = {} }: { sheet: DrawnSheet; images?: Record<string, string> }) {
  const id = useId().replace(/:/g, '');
  return <svg className="studio-sheet-art" viewBox={`0 0 ${sheet.widthMm} ${sheet.heightMm}`} aria-hidden="true">
    <rect width={sheet.widthMm} height={sheet.heightMm} fill="white" />
    {sheet.paint.map((item, i) => <PaintItem key={i} item={item} images={images} />)}
    {sheet.frames.map((frame, index) => <g key={frame.id}>
      <defs><clipPath id={`${id}-${index}`}><rect {...frame.clip} /></clipPath></defs>
      <g clipPath={`url(#${id}-${index})`}>{frame.paint.map((item, i) => <PaintItem key={i} item={item} images={images} />)}</g>
      {frame.scaleLabel !== '—' && <text x={frame.clip.x + 1} y={frame.clip.y + frame.clip.height - 2} fontSize="2.4" fill="#68776d">{frame.scaleLabel}</text>}
    </g>)}
  </svg>;
}

type Gesture = { pointerId: number; x: number; y: number; frame: DocumentFrame; resize: boolean; pixelsPerMm: number };
export function DocumentSheet({ sheet, page, images, selectedId, onSelect, onBegin, onPreview, onFinish, onEditAutomatic }: {
  sheet: DrawnSheet; page: DocumentPage; images: Record<string, string>; selectedId?: string;
  onSelect: (id?: string) => void; onBegin: () => void; onPreview: (frame: DocumentFrame) => void;
  onFinish: (cancel: boolean) => void; onEditAutomatic: () => void;
}) {
  const paper = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | undefined>(undefined);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  function start(event: PointerEvent<HTMLButtonElement>, frame: DocumentFrame, resize: boolean) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); onSelect(frame.id);
    const width = paper.current?.getBoundingClientRect().width;
    if (!width) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, frame, resize, pixelsPerMm: width / sheet.widthMm };
    onBegin();
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current) return;
    const dx = (event.clientX - current.x) / current.pixelsPerMm;
    const dy = (event.clientY - current.y) / current.pixelsPerMm;
    if (current.resize) { onPreview(resizeStudioFrame(current.frame, dx, dy, page)); setGuides([]); }
    else { const result = moveStudioFrame(current.frame, dx, dy, page, current.pixelsPerMm, !event.altKey); onPreview(result.frame); setGuides(result.guides); }
  }
  function finish(cancel: boolean) {
    if (!gesture.current) return;
    gesture.current = undefined; setGuides([]); onFinish(cancel);
  }
  return <div ref={paper} className="studio-paper" style={{ aspectRatio: `${sheet.widthMm} / ${sheet.heightMm}` }}
    data-testid="document-sheet" onPointerDown={event => { if (event.target === event.currentTarget) onSelect(); }}
    onKeyDown={event => { if (event.key === 'Escape') { finish(true); onSelect(); } }}>
    <DocumentSheetArtwork sheet={sheet} images={images} />
    {page.automaticKey ? sheet.frames.filter(frame => frame.kind === 'plan' || frame.kind === 'elevation' || frame.kind === 'view3d').map(frame =>
      <button key={frame.id} type="button" className="studio-frame-hit studio-frame-automatic" aria-label={`${FRAME_LABELS[frame.kind]} bearbeiten`}
        style={{ left: `${frame.clip.x / sheet.widthMm * 100}%`, top: `${frame.clip.y / sheet.heightMm * 100}%`, width: `${frame.clip.width / sheet.widthMm * 100}%`, height: `${frame.clip.height / sheet.heightMm * 100}%` }}
        onClick={onEditAutomatic}><span>Zeichnung bearbeiten</span></button>)
      : page.frames.map(frame => <div key={frame.id} className={`studio-frame-box${selectedId === frame.id ? ' is-selected' : ''}`}
        style={{ left: `${frame.x / sheet.widthMm * 100}%`, top: `${frame.y / sheet.heightMm * 100}%`, width: `${frame.width / sheet.widthMm * 100}%`, height: `${frame.height / sheet.heightMm * 100}%` }}>
        <button type="button" className="studio-frame-hit" aria-label={`${frame.label || FRAME_LABELS[frame.kind]} auswählen`} aria-pressed={selectedId === frame.id}
          onPointerDown={event => start(event, frame, false)} onPointerMove={move} onPointerUp={() => finish(false)} onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish(false)}
          onClick={() => onSelect(frame.id)}><span className="studio-frame-tag">{frame.label || FRAME_LABELS[frame.kind]}</span></button>
        {selectedId === frame.id && <button type="button" className="studio-resize-handle" aria-label="Rahmengröße ziehen"
          onPointerDown={event => start(event, frame, true)} onPointerMove={move} onPointerUp={() => finish(false)} onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish(false)} />}
      </div>)}
    {guides.map((guide, index) => <div key={index} className={`studio-snap-guide is-${guide.axis}`} style={guide.axis === 'x' ? { left: `${guide.value / sheet.widthMm * 100}%` } : { top: `${guide.value / sheet.heightMm * 100}%` }} />)}
  </div>;
}
