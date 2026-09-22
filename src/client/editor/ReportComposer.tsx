import { useState } from 'react';
import type { Layout, VenueGeometry } from '../../shared/layout.js';
import {
  REPORT_A4_DRAWING_MM, REPORT_VIEW_LABELS, newReportFrame, newReportTemplate, rotateReportFrame,
  type ReportFrame, type ReportTemplate, type ReportView,
} from '../../shared/reportTemplate.js';
import { PlanPreview, planPreviewFromScene } from './PlanPreview.js';

const KIND_LABEL: Record<ReportFrame['kind'], string> = {
  plan: 'Grundriss',
  elevation: 'Ansicht',
  view3d: '3D-Ansicht',
  notes: 'Hinweise',
};

const CONSTRUCTION_VIEWS: ReportView[] = ['orbit', 'top', 'front', 'side'];

/**
 * Visual sheet composer: place real editor views on A4.
 * Plan frames crop to Bühnenbild by default (not the audience hall).
 * 3D / elevation frames use the same Kamerablick presets as Raumsicht.
 */
export function ReportComposer({
  templates, layout, venue, readOnly, onChange,
}: {
  templates: ReportTemplate[];
  layout: Layout;
  venue: VenueGeometry;
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

  function patchSelected(patch: Partial<ReportFrame>) {
    if (!selected || !page) return;
    updateFrames(page.frames.map(frame => frame.id === selected.id ? { ...frame, ...patch } : frame));
  }

  return <section className="report-composer" data-testid="report-composer">
    <header className="report-composer-header">
      <h3>Blatt-Layout</h3>
      <p className="muted">Rahmen aus den Editor-Ansichten — Grundriss standardmäßig ohne Publikum, 3D wie Kamerablick.</p>
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
        {(page?.frames ?? []).map(frame => {
          const scope = frame.planScope ?? 'scenery';
          const preview = frame.kind === 'plan' ? planPreviewFromScene(venue, layout, scope) : undefined;
          const viewLabel = frame.view ? REPORT_VIEW_LABELS[frame.view] : undefined;
          return <button
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
            {preview
              ? <PlanPreview preview={preview} label={frame.label ?? KIND_LABEL.plan} />
              : <span className="report-frame-caption">{frame.label ?? viewLabel ?? KIND_LABEL[frame.kind]}</span>}
            {frame.kind === 'plan' && <span className="report-frame-badge">{scope === 'scenery' ? 'Bühnenbild' : 'Spielstätte'}</span>}
            {frame.kind !== 'plan' && viewLabel && <span className="report-frame-badge">{viewLabel}</span>}
            {frame.rotation === 90 && <span className="report-frame-rot">90°</span>}
          </button>;
        })}
      </div>
      {selected && !readOnly && <div className="report-frame-inspector" data-testid="report-frame-inspector">
        {selected.kind === 'plan' && <>
          <span className="muted">Ausschnitt</span>
          <div className="form-actions" role="group" aria-label="Grundriss-Ausschnitt">
            <button type="button" className="quiet" aria-pressed={(selected.planScope ?? 'scenery') === 'scenery'}
              onClick={() => patchSelected({ planScope: 'scenery', label: 'Grundriss Bühnenbild' })}>Bühnenbild</button>
            <button type="button" className="quiet" aria-pressed={selected.planScope === 'venue'}
              onClick={() => patchSelected({ planScope: 'venue', label: 'Grundriss Spielstätte' })}>Ganze Spielstätte</button>
          </div>
        </>}
        {(selected.kind === 'view3d' || selected.kind === 'elevation') && <>
          <span className="muted">Ansicht (wie Raumsicht)</span>
          <div className="form-actions" role="group" aria-label="Kamerablick">
            {CONSTRUCTION_VIEWS.map(view =>
              <button key={view} type="button" className="quiet" aria-pressed={selected.view === view}
                onClick={() => patchSelected({ view, label: REPORT_VIEW_LABELS[view] })}>
                {REPORT_VIEW_LABELS[view]}
              </button>)}
          </div>
        </>}
      </div>}
      <div className="form-actions report-composer-tools">
        <button type="button" disabled={readOnly} onClick={() => updateFrames([
          ...(page?.frames ?? []),
          newReportFrame(crypto.randomUUID(), 'plan', {
            x: 10, y: 10, width: 80, height: 90, planScope: 'scenery', label: 'Grundriss Bühnenbild',
          }),
        ])}>+ Grundriss</button>
        <button type="button" disabled={readOnly} onClick={() => updateFrames([
          ...(page?.frames ?? []),
          newReportFrame(crypto.randomUUID(), 'view3d', {
            x: 100, y: 10, width: 70, height: 90, view: 'orbit', label: REPORT_VIEW_LABELS.orbit,
          }),
        ])}>+ 3D</button>
        <button type="button" disabled={readOnly} onClick={() => updateFrames([
          ...(page?.frames ?? []),
          newReportFrame(crypto.randomUUID(), 'elevation', {
            x: 10, y: 110, width: 160, height: 60, view: 'front', label: REPORT_VIEW_LABELS.front,
          }),
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
