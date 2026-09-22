import { useState } from 'react';
import {
  REPORT_A4_DRAWING_MM, newReportFrame, newReportTemplate, rotateReportFrame,
  type ReportFrame, type ReportTemplate,
} from '../../shared/reportTemplate.js';

const KIND_LABEL: Record<ReportFrame['kind'], string> = {
  plan: 'Grundriss',
  elevation: 'Ansicht',
  view3d: '3D-Ansicht',
  notes: 'Hinweise',
};

/**
 * First-slice visual sheet composer (InDesign / Affinity Publisher–style frames on A4).
 * Place plan / 3D / elevation frames, rotate 90°, delete, save as report template.
 */
export function ReportComposer({
  templates, readOnly, onChange,
}: {
  templates: ReportTemplate[];
  readOnly: boolean;
  onChange: (templates: ReportTemplate[]) => void;
}) {
  const active = templates[0];
  const page = active?.pages[0];
  const [selectedFrameId, setSelectedFrameId] = useState<string>();
  const selected = page?.frames.find(frame => frame.id === selectedFrameId);

  function updateActive(mutator: (template: ReportTemplate) => ReportTemplate) {
    if (!active || readOnly) return;
    onChange(templates.map(item => item.id === active.id ? mutator(item) : item));
  }

  function updateFrames(frames: ReportFrame[]) {
    updateActive(template => ({
      ...template,
      pages: template.pages.map((entry, index) => index === 0 ? { ...entry, frames } : entry),
    }));
  }

  return <section className="report-composer" data-testid="report-composer">
    <header className="report-composer-header">
      <h3>Blatt-Layout</h3>
      <p className="muted">Rahmen auf A4 platzieren — wie in einem Layoutprogramm. 90°-Drehung für dichtere Packung.</p>
    </header>
    {!active ? <div className="form-actions">
      <button type="button" disabled={readOnly} onClick={() => onChange([newReportTemplate(crypto.randomUUID(), 'Standardblatt')])}>
        Standardblatt anlegen
      </button>
    </div> : <>
      <label htmlFor="report-template-name">Vorlagenname</label>
      <input id="report-template-name" value={active.name} disabled={readOnly}
        onChange={event => updateActive(template => ({ ...template, name: event.target.value }))} />
      <div className="report-sheet" style={{ aspectRatio: `${REPORT_A4_DRAWING_MM.width} / ${REPORT_A4_DRAWING_MM.height}` }}
        role="application" aria-label="A4-Zeichenfläche">
        {(page?.frames ?? []).map(frame =>
          <button
            key={frame.id}
            type="button"
            className={`report-frame report-frame-${frame.kind}${selectedFrameId === frame.id ? ' is-selected' : ''}`}
            style={{
              left: `${(frame.x / REPORT_A4_DRAWING_MM.width) * 100}%`,
              top: `${(frame.y / REPORT_A4_DRAWING_MM.height) * 100}%`,
              width: `${(frame.width / REPORT_A4_DRAWING_MM.width) * 100}%`,
              height: `${(frame.height / REPORT_A4_DRAWING_MM.height) * 100}%`,
            }}
            onClick={() => setSelectedFrameId(frame.id)}
          >
            <span>{frame.label ?? KIND_LABEL[frame.kind]}</span>
            {frame.rotation === 90 && <span className="report-frame-rot">90°</span>}
          </button>)}
      </div>
      <div className="form-actions report-composer-tools">
        <button type="button" disabled={readOnly} onClick={() => updateFrames([
          ...(page?.frames ?? []),
          newReportFrame(crypto.randomUUID(), 'plan', { x: 10, y: 10, width: 80, height: 90, label: 'Grundriss' }),
        ])}>+ Grundriss</button>
        <button type="button" disabled={readOnly} onClick={() => updateFrames([
          ...(page?.frames ?? []),
          newReportFrame(crypto.randomUUID(), 'view3d', { x: 100, y: 10, width: 70, height: 90, view: 'orbit', label: '3D' }),
        ])}>+ 3D</button>
        <button type="button" disabled={readOnly} onClick={() => updateFrames([
          ...(page?.frames ?? []),
          newReportFrame(crypto.randomUUID(), 'elevation', { x: 10, y: 110, width: 160, height: 60, view: 'front', label: 'Ansicht' }),
        ])}>+ Ansicht</button>
        <button type="button" disabled={readOnly || !selected} onClick={() => {
          if (!selected || !page) return;
          updateFrames(page.frames.map(frame => frame.id === selected.id ? rotateReportFrame(frame) : frame));
        }}>90° drehen</button>
        <button type="button" className="quiet" disabled={readOnly || !selected} onClick={() => {
          if (!selected || !page) return;
          updateFrames(page.frames.filter(frame => frame.id !== selected.id));
          setSelectedFrameId(undefined);
        }}>Rahmen löschen</button>
        <button type="button" className="quiet" disabled={readOnly} onClick={() => {
          onChange([newReportTemplate(crypto.randomUUID(), 'Standardblatt')]);
          setSelectedFrameId(undefined);
        }}>Vorlage zurücksetzen</button>
      </div>
    </>}
  </section>;
}
