import { useState } from 'react';
import type { Layout, VenueGeometry } from '../../shared/layout.js';
import {
  REPORT_A4_DRAWING_MM, REPORT_VIEW_LABELS, newReportFrame, newReportTemplate, rotateReportFrame,
  type ReportFrame, type ReportTemplate, type ReportView,
} from '../../shared/reportTemplate.js';
import { PlanPreview, planPreviewFromScene } from './PlanPreview.js';
import { StageView } from './StageView.js';
import { ToolIcon } from './ToolIcon.js';

const CONSTRUCTION_VIEWS: ReportView[] = ['orbit', 'top', 'front', 'side'];

/**
 * TechDraw-style sheet editor: pick readonly plan / 3D views from the live scene
 * and place them on an A4 construction sheet. Separate from venue drafting.
 */
export function ReportSheetEditor({
  templates, layout, venue, readOnly, onChange, onClose,
}: {
  templates: ReportTemplate[];
  layout: Layout;
  venue: VenueGeometry;
  readOnly: boolean;
  onChange: (templates: ReportTemplate[]) => void;
  onClose: () => void;
}) {
  const active = (templates[0] ?? newReportTemplate(crypto.randomUUID(), 'Standardblatt'));
  const page = active.pages[0];
  const [selectedFrameId, setSelectedFrameId] = useState<string>();
  const selected = page?.frames.find(frame => frame.id === selectedFrameId);
  const planPreview = planPreviewFromScene(venue, layout, 'scenery');

  function updateActive(mutator: (template: ReportTemplate) => ReportTemplate) {
    if (readOnly || !templates[0]) return;
    onChange(templates.map(item => item.id === active.id ? mutator(item) : item));
  }

  function updateFrames(frames: ReportFrame[]) {
    updateActive(template => ({
      ...template,
      pages: template.pages.map((entry, index) => index === 0 ? { ...entry, frames } : entry),
    }));
  }

  function patchSelected(patch: Partial<ReportFrame>) {
    if (!selected || !page || readOnly) return;
    updateFrames(page.frames.map(frame => frame.id === selected.id ? { ...frame, ...patch } : frame));
  }

  function insertPlan() {
    if (readOnly || !page) return;
    const count = page.frames.length;
    updateFrames([
      ...page.frames,
      newReportFrame(crypto.randomUUID(), 'plan', {
        x: 8 + (count % 3) * 6, y: 8 + (count % 3) * 6,
        width: 100, height: 130, planScope: 'scenery', label: 'Grundriss Bühnenbild',
      }),
    ]);
  }

  function insertView(kind: 'view3d' | 'elevation', view: ReportView) {
    if (readOnly || !page) return;
    const count = page.frames.length;
    updateFrames([
      ...page.frames,
      newReportFrame(crypto.randomUUID(), kind, {
        x: 110, y: 8 + (count % 4) * 12,
        width: kind === 'elevation' ? 160 : 60, height: kind === 'elevation' ? 50 : 90,
        view, label: REPORT_VIEW_LABELS[view],
      }),
    ]);
  }

  if (!templates.length) {
    return <section className="report-sheet-editor" data-testid="report-sheet-editor">
      <header className="report-sheet-editor-bar">
        <button type="button" className="quiet" onClick={onClose}><ToolIcon name="back" /> Spielstätte</button>
        <h2>Blatt-Layout</h2>
      </header>
      <p className="muted">Entwurf — legt noch keine herausgegebenen Konstruktionspläne fest. Erst „Standardblatt anlegen“ speichert eine Vorlage an der Spielstätte.</p>
      <div className="form-actions">
        <button type="button" disabled={readOnly} onClick={() => onChange([newReportTemplate(crypto.randomUUID(), 'Standardblatt')])}>
          Standardblatt anlegen
        </button>
      </div>
    </section>;
  }

  return <section className="report-sheet-editor" data-testid="report-sheet-editor" aria-label="Blatt-Layout">
    <header className="report-sheet-editor-bar">
      <button type="button" className="quiet" onClick={onClose} title="Zur Spielstätte" aria-label="Zur Spielstätte">
        <ToolIcon name="back" /> Spielstätte
      </button>
      <div className="report-sheet-editor-title">
        <p className="eyebrow">Konstruktionsblatt · Entwurf</p>
        <h2>Blatt-Layout</h2>
      </div>
      <label className="report-sheet-name">
        <span>Vorlage</span>
        <input value={active.name} disabled={readOnly}
          onChange={event => updateActive(template => ({ ...template, name: event.target.value }))} />
      </label>
      <p className="muted report-sheet-hint">Entwurf — Rahmenplatzierung steuert herausgegebene PDFs noch nicht. Ansichten kommen live aus Bühnenbild und Spielstätte.</p>
    </header>

    <div className="report-sheet-workspace">
      <aside className="report-source-rail" aria-label="Ansichten einfügen">
        <h3>Quellen</h3>
        <p className="muted">Live aus Bühnenbild und Spielstätte — nur Anzeige, Einfügen setzt einen Rahmen aufs Blatt.</p>

        <div className="report-source-card">
          <div className="report-source-card-head">
            <h4>Grundriss · Bühnenbild</h4>
            <button type="button" disabled={readOnly} onClick={insertPlan}>Einfügen</button>
          </div>
          <div className="report-source-plan">
            <PlanPreview preview={planPreview} label="Grundriss Bühnenbild" />
          </div>
        </div>

        <div className="report-source-card">
          <div className="report-source-card-head">
            <h4>Raumsicht · 3D</h4>
          </div>
          <div className="report-source-stage" data-testid="report-source-stage">
            <StageView layout={layout} venue={venue} selectedIds={[]} />
          </div>
          <div className="form-actions report-source-inserts" role="group" aria-label="3D-Ansicht einfügen">
            {CONSTRUCTION_VIEWS.map(view =>
              <button key={view} type="button" className="quiet" disabled={readOnly}
                onClick={() => insertView('view3d', view)}>
                + {REPORT_VIEW_LABELS[view]}
              </button>)}
          </div>
          <div className="form-actions report-source-inserts" role="group" aria-label="Orthogonalansicht einfügen">
            <button type="button" className="quiet" disabled={readOnly}
              onClick={() => insertView('elevation', 'front')}>+ Ansicht vorne</button>
            <button type="button" className="quiet" disabled={readOnly}
              onClick={() => insertView('elevation', 'side')}>+ Ansicht Seite</button>
          </div>
        </div>
      </aside>

      <main className="report-sheet-main">
        <div className="report-sheet report-sheet-large"
          style={{ aspectRatio: `${REPORT_A4_DRAWING_MM.width} / ${REPORT_A4_DRAWING_MM.height}` }}
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
                ? <PlanPreview preview={preview} label={frame.label ?? 'Grundriss'} />
                : <span className="report-frame-caption">{frame.label ?? viewLabel ?? frame.kind}</span>}
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
            <span className="muted">Kamerablick</span>
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
      </main>
    </div>
  </section>;
}
