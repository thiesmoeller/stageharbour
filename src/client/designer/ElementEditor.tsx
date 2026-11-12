import type { ReactNode } from 'react';
import {
  BODY_MATERIAL_KIND, BUILT_IN_CONNECTOR_KINDS, CONNECTOR_KINDS, PART_FACE_SIDES, SHEET_ANCHORS, faceSidesOf,
  type BeamBody, type BoxBody, type FormulaVec2, type PartBody, type PartChild, type PartConnector, type PartDefinition,
  type PartHardware, type PartMaterial, type PartRepeat, type PartRepeatLevel, type PartTraits, type SheetBody, type SheetHole,
} from '../../shared/parts/definition.js';
import type { Formula } from '../../shared/parts/formula.js';
import type { PartIssueSubject } from '../../shared/parts/issues.js';
import type { PartSummary } from '../../shared/parts/catalog.js';
import type { ResolvedPart } from '../../shared/parts/resolve.js';
import { repeatLevels } from '../../shared/parts/sites.js';
import {
  FormulaField, IssueLines, OptionalFormulaField, OptionalVec3Field, Vec3Field, fieldIssues, type FieldIssue,
} from './FormulaField.js';
import { BODY_KIND_LABELS, issuesForSelection, removeAt, renameBodyReferences, replaceAt, uniqueKey, type DesignerSelection } from './draft.js';
import { previewScope } from './formulaPreview.js';

export type EditorIssue = FieldIssue & PartIssueSubject & { code?: string };

type Shared = {
  definition: PartDefinition;
  onChange: (definition: PartDefinition, select?: DesignerSelection) => void;
  resolved: ResolvedPart | undefined;
  issues: readonly EditorIssue[];
  materials: readonly PartMaterial[];
  disabled: boolean;
};

const ZERO3: [Formula, Formula, Formula] = [0, 0, 0];
const SHEET_PLANE_LABELS: Record<SheetBody['plane'], string> = {
  xy: 'Aufrecht, Breite × Höhe (X-Y)', xz: 'Liegend, Breite × Tiefe (X-Z)', yz: 'Aufrecht quer, Tiefe × Höhe (Z-Y)',
};
const SHEET_ANCHOR_LABELS: Record<(typeof SHEET_ANCHORS)[number], string> = {
  face: 'Vorderfläche', centre: 'Mitte der Stärke', back: 'Rückfläche',
};
const FACE_SIDE_LABELS: Record<(typeof PART_FACE_SIDES)[number], string> = {
  front: 'Vorderseite', back: 'Rückseite', left: 'Links', right: 'Rechts', top: 'Oben', bottom: 'Unten', edge: 'Kanten', all: 'Alle Seiten',
};

function TextField({ label, value, onChange, disabled, testId, hint }: {
  label: string; value: string; onChange: (value: string) => void; disabled: boolean; testId?: string; hint?: string;
}) {
  return <label className="designer-field">{label}
    <input value={value} disabled={disabled} data-testid={testId} onChange={event => onChange(event.target.value)} />
    {hint && <span className="muted-inline">{hint}</span>}
  </label>;
}

function MaterialSelect({ kind, value, onChange, materials, disabled }: {
  kind: PartMaterial['kind']; value: string; onChange: (key: string) => void; materials: readonly PartMaterial[]; disabled: boolean;
}) {
  const options = materials.filter(material => material.kind === kind);
  return <label className="designer-field">Material
    <select value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>
      {!options.some(material => material.key === value) && <option value={value}>{value} (nicht vorhanden)</option>}
      {options.map(material => <option key={material.key} value={material.key}>{material.name}</option>)}
    </select>
  </label>;
}

function levelsOf(repeat: PartRepeat | undefined): PartRepeatLevel[] {
  if (!repeat) return [];
  return Array.isArray(repeat) ? [...repeat] : [repeat];
}
function repeatOf(levels: PartRepeatLevel[]): PartRepeat | undefined {
  if (!levels.length) return undefined;
  return levels.length === 1 ? levels[0] : levels;
}

function RepeatEditor({ repeat, onChange, resolved, issues, disabled }: {
  repeat: PartRepeat | undefined; onChange: (repeat: PartRepeat | undefined) => void;
  resolved: ResolvedPart | undefined; issues: readonly EditorIssue[]; disabled: boolean;
}) {
  const levels = levelsOf(repeat);
  const names = repeatLevels(repeat).map(level => level.index);
  return <fieldset className="designer-subsection">
    <legend>Wiederholen</legend>
    {levels.map((level, index) => {
      const scope = previewScope(resolved, names.slice(0, index));
      const set = (next: PartRepeatLevel) => onChange(repeatOf(replaceAt(levels, index, next)));
      return <div key={index} className="repeat-level">
        <p className="repeat-title">Ebene {index + 1} · Zähler <code>{names[index]}</code></p>
        <FormulaField label="Anzahl" value={level.count} scope={scope} disabled={disabled}
          issues={fieldIssues(issues, `repeat[${index}].count`)} onChange={count => set({ ...level, count })} />
        <Vec3Field label="Abstand" field={`repeat[${index}].step`} value={level.step} scope={scope} disabled={disabled}
          issues={fieldIssues(issues, `repeat[${index}].step`)} onChange={step => set({ ...level, step })} />
        <label className="designer-field">Name des Zählers
          <input value={level.index ?? ''} placeholder={['i', 'j', 'k'][index]} disabled={disabled}
            onChange={event => {
              const { index: _old, ...rest } = level;
              set(event.target.value.trim() ? { ...rest, index: event.target.value.trim() } : rest);
            }} />
        </label>
        <button type="button" className="quiet" disabled={disabled} onClick={() => onChange(repeatOf(removeAt(levels, index)))}>Ebene entfernen</button>
      </div>;
    })}
    {levels.length < 3 && <button type="button" className="quiet" disabled={disabled}
      onClick={() => onChange(repeatOf([...levels, { count: 2, step: [500, 0, 0] }]))}>Wiederholung hinzufügen</button>}
    <IssueLines issues={issues.filter(item => item.field === 'repeat')} />
  </fieldset>;
}

function PointsEditor({ label, points, onChange, scope, issues, field, disabled }: {
  label: string; points: FormulaVec2[]; onChange: (points: FormulaVec2[]) => void;
  scope: Map<string, number> | undefined; issues: readonly EditorIssue[]; field: string; disabled: boolean;
}) {
  return <fieldset className="designer-subsection">
    <legend>{label}</legend>
    {points.map((point, index) => <div key={index} className="point-row">
      <span className="muted-inline">{index + 1}</span>
      <FormulaField compact label="u" value={point[0]} scope={scope} disabled={disabled} issues={fieldIssues(issues, `${field}[${index}][0]`)}
        onChange={value => onChange(replaceAt(points, index, [value, point[1]]))} />
      <FormulaField compact label="v" value={point[1]} scope={scope} disabled={disabled} issues={fieldIssues(issues, `${field}[${index}][1]`)}
        onChange={value => onChange(replaceAt(points, index, [point[0], value]))} />
      <button type="button" className="quiet icon-button" disabled={disabled || points.length <= 3} aria-label={`Punkt ${index + 1} entfernen`}
        onClick={() => onChange(removeAt(points, index))}>×</button>
    </div>)}
    <button type="button" className="quiet" disabled={disabled} onClick={() => onChange([...points, points.at(-1) ?? [0, 0]])}>Punkt hinzufügen</button>
    <IssueLines issues={issues.filter(item => item.field === field)} />
  </fieldset>;
}

type Rect = { x: Formula; y: Formula; width: Formula; height: Formula };
function RectFields({ value, onChange, scope, issues, prefix, disabled }: {
  value: Rect; onChange: (value: Rect) => void; scope: Map<string, number> | undefined;
  issues: readonly EditorIssue[]; prefix: string; disabled: boolean;
}) {
  const field = (name: keyof Rect, label: string) => <FormulaField label={label} value={value[name]} scope={scope} disabled={disabled}
    testId={`field-${prefix}${name}`} issues={fieldIssues(issues, `${prefix}${name}`)} onChange={next => onChange({ ...value, [name]: next })} />;
  return <div className="designer-grid-2">
    {field('x', 'Links (u)')}{field('y', 'Unten (v)')}{field('width', 'Breite')}{field('height', 'Höhe')}
  </div>;
}

function HoleEditor({ hole, onChange, onRemove, scope, issues, disabled }: {
  hole: SheetHole; onChange: (hole: SheetHole) => void; onRemove: () => void;
  scope: Map<string, number> | undefined; issues: readonly EditorIssue[]; disabled: boolean;
}) {
  const setShape = (shape: SheetHole['shape']) => {
    if (shape === hole.shape) return;
    const base = { key: hole.key, ...(hole.when !== undefined ? { when: hole.when } : {}) };
    if (shape === 'polygon') onChange({ ...base, shape, points: [[0, 0], [200, 0], [200, 200], [0, 200]] });
    else onChange({ ...base, shape, ...(hole.shape === 'polygon' ? { x: 0, y: 0, width: 200, height: 200 } : { x: hole.x, y: hole.y, width: hole.width, height: hole.height }) });
  };
  return <fieldset className="designer-subsection hole">
    <legend>Ausschnitt „{hole.key}“</legend>
    <div className="designer-grid-2">
      <TextField label="Schlüssel" value={hole.key} disabled={disabled} onChange={key => onChange({ ...hole, key })} />
      <label className="designer-field">Form
        <select value={hole.shape} disabled={disabled} onChange={event => setShape(event.target.value as SheetHole['shape'])}>
          <option value="rect">Rechteck</option><option value="arch">Bogen</option><option value="polygon">Vieleck</option>
        </select>
      </label>
    </div>
    <OptionalFormulaField label="Nur wenn" hint="ungleich 0" value={hole.when} fallback="1" scope={scope} disabled={disabled}
      issues={fieldIssues(issues, 'when')} onChange={when => {
        const { when: _old, ...rest } = hole;
        onChange((when === undefined ? rest : { ...rest, when }) as SheetHole);
      }} />
    {hole.shape === 'polygon'
      ? <PointsEditor label="Eckpunkte" points={hole.points} field="points" scope={scope} issues={issues} disabled={disabled}
        onChange={points => onChange({ ...hole, points })} />
      : <RectFields value={hole} prefix="" scope={scope} issues={issues} disabled={disabled} onChange={rect => onChange({ ...hole, ...rect })} />}
    <button type="button" className="quiet" disabled={disabled} onClick={onRemove}>Ausschnitt entfernen</button>
  </fieldset>;
}

function BodyEditor({ body, index, definition, onChange, resolved, issues, materials, disabled }: Shared & { body: PartBody; index: number }) {
  const indices = repeatLevels(body.repeat).map(level => level.index);
  const scope = previewScope(resolved, indices);
  const own = issuesForSelection(issues, { kind: 'body', key: body.key });
  const set = (next: PartBody) => {
    const renamed = next.key !== body.key ? renameBodyReferences(definition, body.key, next.key) : definition;
    onChange({ ...renamed, bodies: replaceAt(renamed.bodies, index, next) }, next.key !== body.key ? { kind: 'body', key: next.key } : undefined);
  };
  const vec = (label: string, name: 'at' | 'size' | 'from' | 'to', value: [Formula, Formula, Formula], apply: (value: [Formula, Formula, Formula]) => void) =>
    <Vec3Field label={label} field={name} value={value} scope={scope} disabled={disabled} issues={fieldIssues(own, name)}
      testId={`field-${name}`} onChange={apply} />;
  const optionalVec = (label: string, name: 'rotation' | 'pivot', value: [Formula, Formula, Formula] | undefined, apply: (value: [Formula, Formula, Formula] | undefined) => void) =>
    <OptionalVec3Field label={label} field={name} value={value} fallback={ZERO3} scope={scope} disabled={disabled} issues={fieldIssues(own, name)} onChange={apply} />;
  const without = <T extends object, K extends keyof T>(item: T, key: K, value: T[K] | undefined): T => {
    const copy = { ...item };
    if (value === undefined) delete copy[key];
    else copy[key] = value;
    return copy;
  };

  let specific: ReactNode;
  if (body.kind === 'box') {
    const box = body as BoxBody;
    specific = <>
      {vec('Größe (Breite, Höhe, Tiefe)', 'size', box.size, size => set({ ...box, size }))}
      {vec('Mittelpunkt', 'at', box.at, at => set({ ...box, at }))}
      {optionalVec('Drehung (°)', 'rotation', box.rotation, rotation => set(without(box, 'rotation', rotation)))}
      {box.rotation && optionalVec('Drehpunkt', 'pivot', box.pivot, pivot => set(without(box, 'pivot', pivot)))}
    </>;
  } else if (body.kind === 'beam') {
    const beam = body as BeamBody;
    specific = <>
      {vec('Von (Mittellinie)', 'from', beam.from, from => set({ ...beam, from }))}
      {vec('Bis (Mittellinie)', 'to', beam.to, to => set({ ...beam, to }))}
      <div className="optional-field">
        <label className="checkbox-line"><input type="checkbox" checked={!!beam.section} disabled={disabled}
          onChange={event => set(without(beam, 'section', event.target.checked ? [40, 40] as FormulaVec2 : undefined))} />Eigener Querschnitt</label>
        {beam.section && <div className="designer-grid-2">
          <FormulaField label="Querschnittsbreite" value={beam.section[0]} scope={scope} disabled={disabled} issues={fieldIssues(own, 'section[0]')}
            onChange={width => set({ ...beam, section: [width, beam.section![1]] })} />
          <FormulaField label="Querschnittshöhe" value={beam.section[1]} scope={scope} disabled={disabled} issues={fieldIssues(own, 'section[1]')}
            onChange={height => set({ ...beam, section: [beam.section![0], height] })} />
        </div>}
      </div>
      <OptionalFormulaField label="Drehung um die Achse (°)" value={beam.roll} fallback={0} scope={scope} disabled={disabled}
        issues={fieldIssues(own, 'roll')} onChange={roll => set(without(beam, 'roll', roll))} />
    </>;
  } else {
    const sheet = body as SheetBody;
    const holes = sheet.holes ?? [];
    const holeIssues = (key: string) => issues.filter(item => !item.path && item.body === body.key && item.hole === key);
    specific = <>
      <div className="designer-grid-2">
        <label className="designer-field">Lage
          <select value={sheet.plane} disabled={disabled} onChange={event => set({ ...sheet, plane: event.target.value as SheetBody['plane'] })}>
            {(Object.keys(SHEET_PLANE_LABELS) as SheetBody['plane'][]).map(plane => <option key={plane} value={plane}>{SHEET_PLANE_LABELS[plane]}</option>)}
          </select>
        </label>
        <label className="designer-field">Bezugsfläche
          <select value={sheet.anchor ?? 'face'} disabled={disabled}
            onChange={event => set(without(sheet, 'anchor', event.target.value === 'face' ? undefined : event.target.value as SheetBody['anchor']))}>
            {SHEET_ANCHORS.map(anchor => <option key={anchor} value={anchor}>{SHEET_ANCHOR_LABELS[anchor]}</option>)}
          </select>
        </label>
      </div>
      {vec('Ursprung der Kontur', 'at', sheet.at, at => set({ ...sheet, at }))}
      {optionalVec('Drehung (°)', 'rotation', sheet.rotation, rotation => set(without(sheet, 'rotation', rotation)))}
      <OptionalFormulaField label="Eigene Stärke" hint="sonst die des Materials" value={sheet.thickness} fallback={12} scope={scope} disabled={disabled}
        issues={fieldIssues(own, 'thickness')} onChange={thickness => set(without(sheet, 'thickness', thickness))} />
      <fieldset className="designer-subsection">
        <legend>Kontur</legend>
        <label className="designer-field">Form
          <select value={sheet.outline.shape} disabled={disabled} onChange={event => set({
            ...sheet,
            outline: event.target.value === 'polygon'
              ? { shape: 'polygon', points: [[0, 0], [500, 0], [500, 500], [0, 500]] }
              : { shape: 'rect', x: 0, y: 0, width: 500, height: 500 },
          })}>
            <option value="rect">Rechteck</option><option value="polygon">Vieleck</option>
          </select>
        </label>
        {sheet.outline.shape === 'rect'
          ? <RectFields value={sheet.outline} prefix="outline." scope={scope} issues={own} disabled={disabled}
            onChange={rect => set({ ...sheet, outline: { shape: 'rect', ...rect } })} />
          : <PointsEditor label="Eckpunkte" points={sheet.outline.points} field="outline.points" scope={scope} issues={own} disabled={disabled}
            onChange={points => set({ ...sheet, outline: { shape: 'polygon', points } })} />}
        <IssueLines issues={own.filter(item => item.field === 'outline')} />
      </fieldset>
      {holes.map((hole, holeIndex) => <HoleEditor key={holeIndex} hole={hole} scope={scope} issues={holeIssues(hole.key)} disabled={disabled}
        onChange={next => set({ ...sheet, holes: replaceAt(holes, holeIndex, next) })}
        onRemove={() => set(without(sheet, 'holes', holes.length > 1 ? removeAt(holes, holeIndex) : undefined))} />)}
      <button type="button" className="quiet" disabled={disabled} onClick={() => set({
        ...sheet, holes: [...holes, { shape: 'rect', key: uniqueKey('ausschnitt', holes.map(hole => hole.key)), x: 100, y: 100, width: 200, height: 200 }],
      })}>Ausschnitt hinzufügen</button>
    </>;
  }

  return <div className="designer-element" data-testid="designer-body-editor">
    <h3>{BODY_KIND_LABELS[body.kind]} „{body.label || body.key}“</h3>
    <div className="designer-grid-2">
      <TextField label="Schlüssel" value={body.key} disabled={disabled} testId="body-key" onChange={key => set({ ...body, key })}
        hint="Teil gespeicherter Bezüge" />
      <TextField label="Bezeichnung" value={body.label ?? ''} disabled={disabled} testId="body-label"
        onChange={label => set(without(body, 'label', label.trim() ? label : undefined))} />
    </div>
    <MaterialSelect kind={BODY_MATERIAL_KIND[body.kind]} value={body.material} materials={materials} disabled={disabled}
      onChange={material => set({ ...body, material })} />
    <OptionalFormulaField label="Nur wenn" hint="Körper entsteht, wenn ungleich 0" value={body.when} fallback="1" scope={scope} disabled={disabled}
      issues={fieldIssues(own, 'when')} onChange={when => set(without(body, 'when', when))} />
    {specific}
    <RepeatEditor repeat={body.repeat} resolved={resolved} issues={own} disabled={disabled} onChange={repeat => set(without(body, 'repeat', repeat))} />
    <IssueLines issues={own.filter(item => item.field === undefined)} />
  </div>;
}

function ChildEditor({ child, index, definition, onChange, resolved, issues, disabled, library, childDefinition, onUpgrade }: Shared & {
  child: PartChild; index: number; library: readonly PartSummary[]; childDefinition: PartDefinition | undefined; onUpgrade: (partId: string) => void;
}) {
  const children = definition.children ?? [];
  const indices = repeatLevels(child.repeat).map(level => level.index);
  const scope = previewScope(resolved, indices);
  const own = issuesForSelection(issues, { kind: 'child', key: child.key });
  const summary = library.find(part => part.id === child.part.id);
  const set = (next: PartChild) => onChange({ ...definition, children: replaceAt(children, index, next) },
    next.key !== child.key ? { kind: 'child', key: next.key } : undefined);
  const without = <K extends keyof PartChild>(key: K, value: PartChild[K] | undefined): PartChild => {
    const copy = { ...child };
    if (value === undefined) delete copy[key];
    else copy[key] = value;
    return copy;
  };
  return <div className="designer-element" data-testid="designer-child-editor">
    <h3>Unterbauteil „{child.label || child.key}“</h3>
    <div className="designer-grid-2">
      <TextField label="Schlüssel" value={child.key} disabled={disabled} onChange={key => set({ ...child, key })} />
      <TextField label="Bezeichnung" value={child.label ?? ''} disabled={disabled} onChange={label => set(without('label', label.trim() ? label : undefined))} />
    </div>
    <p className="designer-child-ref">
      {summary?.name ?? childDefinition?.name ?? 'Unbekanntes Bauteil'} · Revision {child.part.revision}
      {summary && summary.latestRevision > child.part.revision && <button type="button" className="quiet" disabled={disabled}
        onClick={() => onUpgrade(child.part.id)}>Auf Revision {summary.latestRevision} umstellen</button>}
    </p>
    {childDefinition?.variants?.length ? <label className="designer-field">Variante
      <select value={child.variant ?? ''} disabled={disabled} onChange={event => set(without('variant', event.target.value || undefined))}>
        <option value="">Erste Variante ({childDefinition.variants[0]!.label})</option>
        {childDefinition.variants.map(variant => <option key={variant.key} value={variant.key}>{variant.label}</option>)}
      </select>
    </label> : null}
    {childDefinition && childDefinition.parameters.length > 0 && <fieldset className="designer-subsection">
      <legend>Werte für das Unterbauteil</legend>
      {childDefinition.parameters.map(parameter => <OptionalFormulaField key={parameter.key}
        label={`${parameter.label} (${parameter.key})`} hint={`Standard ${parameter.default}`}
        value={child.values?.[parameter.key]} fallback={parameter.default} scope={scope} disabled={disabled}
        issues={fieldIssues(own, `values.${parameter.key}`)}
        onChange={value => {
          const values = { ...(child.values ?? {}) };
          if (value === undefined) delete values[parameter.key];
          else values[parameter.key] = value;
          set(without('values', Object.keys(values).length ? values : undefined));
        }} />)}
    </fieldset>}
    <Vec3Field label="Ursprung des Unterbauteils" field="at" value={child.at} scope={scope} disabled={disabled} issues={fieldIssues(own, 'at')}
      onChange={at => set({ ...child, at })} />
    <OptionalVec3Field label="Drehung (°)" field="rotation" value={child.rotation} fallback={ZERO3} scope={scope} disabled={disabled}
      issues={fieldIssues(own, 'rotation')} onChange={rotation => set(without('rotation', rotation))} />
    <OptionalFormulaField label="Nur wenn" hint="ungleich 0" value={child.when} fallback="1" scope={scope} disabled={disabled}
      issues={fieldIssues(own, 'when')} onChange={when => set(without('when', when))} />
    <RepeatEditor repeat={child.repeat} resolved={resolved} issues={own} disabled={disabled} onChange={repeat => set(without('repeat', repeat))} />
    <IssueLines issues={own.filter(item => item.field === undefined)} />
  </div>;
}

function ConnectorEditor({ connector, index, definition, onChange, resolved, issues, disabled }: Shared & { connector: PartConnector; index: number }) {
  const connectors = definition.connectors ?? [];
  const scope = previewScope(resolved);
  const own = issuesForSelection(issues, { kind: 'connector', key: connector.key });
  const builtIn = (BUILT_IN_CONNECTOR_KINDS as readonly string[]).includes(connector.kind);
  const set = (next: PartConnector) => onChange({ ...definition, connectors: replaceAt(connectors, index, next) },
    next.key !== connector.key ? { kind: 'connector', key: next.key } : undefined);
  const without = <K extends keyof PartConnector>(key: K, value: PartConnector[K] | undefined): PartConnector => {
    const copy = { ...connector };
    if (value === undefined) delete copy[key];
    else copy[key] = value;
    return copy;
  };
  return <div className="designer-element" data-testid="designer-connector-editor">
    <h3>Verbinder „{connector.label || connector.key}“</h3>
    <div className="designer-grid-2">
      <TextField label="Schlüssel" value={connector.key} disabled={disabled} onChange={key => set({ ...connector, key })} />
      <TextField label="Bezeichnung" value={connector.label ?? ''} disabled={disabled} onChange={label => set(without('label', label.trim() ? label : undefined))} />
      <label className="designer-field">Art
        <select value={builtIn ? connector.kind : '__own'} disabled={disabled}
          onChange={event => set({ ...connector, kind: event.target.value === '__own' ? 'eigene-art' : event.target.value })}>
          {BUILT_IN_CONNECTOR_KINDS.map(kind => <option key={kind} value={kind}>{CONNECTOR_KINDS[kind].label}</option>)}
          <option value="__own">Eigene Art …</option>
        </select>
      </label>
      {!builtIn && <TextField label="Eigene Art (Schlüssel)" value={connector.kind} disabled={disabled} onChange={kind => set({ ...connector, kind })} />}
      <TextField label="Passt außerdem zu (Art)" value={connector.partner ?? ''} disabled={disabled}
        onChange={partner => set(without('partner', partner.trim() ? partner.trim() : undefined))} />
    </div>
    <Vec3Field label="Lage" field="at" value={connector.at} scope={scope} disabled={disabled} issues={fieldIssues(own, 'at')} onChange={at => set({ ...connector, at })} />
    <Vec3Field label="Richtung" field="axis" value={connector.axis} scope={scope} disabled={disabled} issues={fieldIssues(own, 'axis')} onChange={axis => set({ ...connector, axis })} />
    <OptionalFormulaField label="Länge (Kante)" hint="ohne Länge ein Punkt" value={connector.length} fallback={1000} scope={scope} disabled={disabled}
      issues={fieldIssues(own, 'length')} onChange={length => set(without('length', length))} />
    <OptionalFormulaField label="Nur wenn" hint="ungleich 0" value={connector.when} fallback="1" scope={scope} disabled={disabled}
      issues={fieldIssues(own, 'when')} onChange={when => set(without('when', when))} />
    <IssueLines issues={own.filter(item => item.field === undefined)} />
  </div>;
}

function HardwareEditor({ item, index, definition, onChange, resolved, issues, materials, disabled }: Shared & { item: PartHardware; index: number }) {
  const hardware = definition.hardware ?? [];
  const scope = previewScope(resolved);
  const own = issues.filter(entry => !entry.path && entry.hardware === item.material);
  const set = (next: PartHardware) => onChange({ ...definition, hardware: replaceAt(hardware, index, next) });
  return <div className="designer-element" data-testid="designer-hardware-editor">
    <h3>Zubehör</h3>
    <p className="muted">Nur was die Körper nicht zeigen: Beschwerung, Gurte, Scharniere.</p>
    <MaterialSelect kind="hardware" value={item.material} materials={materials} disabled={disabled} onChange={material => set({ ...item, material })} />
    <FormulaField label="Menge (Stück)" value={item.quantity} scope={scope} disabled={disabled} issues={fieldIssues(own, 'quantity')}
      onChange={quantity => set({ ...item, quantity })} />
    <OptionalFormulaField label="Nur wenn" hint="ungleich 0" value={item.when} fallback="1" scope={scope} disabled={disabled}
      issues={fieldIssues(own, 'when')} onChange={when => {
        const { when: _old, ...rest } = item;
        set(when === undefined ? rest : { ...rest, when });
      }} />
    <IssueLines issues={own.filter(entry => entry.field === undefined)} />
  </div>;
}

/** Editor of the selected body, child part, connector or hardware entry. */
export function ElementEditor(props: Shared & {
  selection: DesignerSelection | undefined; library: readonly PartSummary[];
  childDefinition: (child: PartChild) => PartDefinition | undefined; onUpgradeChild: (key: string, partId: string) => void;
}) {
  const { selection, definition } = props;
  if (!selection) return <p className="muted">Links oder in einer Ansicht einen Körper, ein Unterbauteil oder einen Verbinder wählen.</p>;
  if (selection.kind === 'body') {
    const index = definition.bodies.findIndex(body => body.key === selection.key);
    return index < 0 ? null : <BodyEditor {...props} body={definition.bodies[index]!} index={index} />;
  }
  if (selection.kind === 'child') {
    const index = (definition.children ?? []).findIndex(child => child.key === selection.key);
    if (index < 0) return null;
    const child = definition.children![index]!;
    return <ChildEditor {...props} child={child} index={index} childDefinition={props.childDefinition(child)}
      onUpgrade={partId => props.onUpgradeChild(child.key, partId)} />;
  }
  if (selection.kind === 'connector') {
    const index = (definition.connectors ?? []).findIndex(connector => connector.key === selection.key);
    return index < 0 ? null : <ConnectorEditor {...props} connector={definition.connectors![index]!} index={index} />;
  }
  const item = definition.hardware?.[selection.index];
  return item ? <HardwareEditor {...props} item={item} index={selection.index} /> : null;
}

/** Walkable surface and finishable faces. */
export function TraitsEditor({ definition, onChange, issues, disabled }: Pick<Shared, 'definition' | 'onChange' | 'issues' | 'disabled'>) {
  const traits = definition.traits;
  const faces = traits.faces ?? [];
  const setTraits = (next: PartTraits) => onChange({ ...definition, traits: next });
  const surfaceBodies = definition.bodies.filter(body => body.kind !== 'beam');
  const own = issues.filter(item => item.face !== undefined || item.code === 'trait-reference' || item.code === 'surface-not-horizontal');
  return <div className="designer-traits" data-testid="designer-traits">
    <label className="designer-field">Begehbare Fläche
      <select value={traits.surface?.body ?? ''} disabled={disabled} onChange={event => {
        const { surface: _old, ...rest } = traits;
        setTraits(event.target.value ? { ...rest, surface: { body: event.target.value } } : rest);
      }}>
        <option value="">Keine</option>
        {surfaceBodies.map(body => <option key={body.key} value={body.key}>Oberseite von „{body.label || body.key}“</option>)}
      </select>
    </label>
    <fieldset className="designer-subsection">
      <legend>Gestaltbare Flächen</legend>
      {faces.map((face, index) => {
        const body = definition.bodies.find(item => item.key === face.body);
        const sides = body ? faceSidesOf(body.kind) : PART_FACE_SIDES;
        const set = (next: typeof face) => setTraits({ ...traits, faces: replaceAt(faces, index, next) });
        return <div key={index} className="face-row">
          <input aria-label={`Schlüssel der Fläche ${index + 1}`} className="key-input" value={face.key} disabled={disabled} onChange={event => set({ ...face, key: event.target.value })} />
          <input aria-label={`Bezeichnung der Fläche ${face.key}`} value={face.label} disabled={disabled} onChange={event => set({ ...face, label: event.target.value })} />
          <select aria-label={`Körper der Fläche ${face.key}`} value={face.body} disabled={disabled} onChange={event => set({ ...face, body: event.target.value })}>
            {!body && <option value={face.body}>{face.body} (fehlt)</option>}
            {definition.bodies.map(item => <option key={item.key} value={item.key}>{item.label || item.key}</option>)}
          </select>
          <select aria-label={`Seite der Fläche ${face.key}`} value={face.side} disabled={disabled} onChange={event => set({ ...face, side: event.target.value as typeof face.side })}>
            {sides.map(side => <option key={side} value={side}>{FACE_SIDE_LABELS[side]}</option>)}
          </select>
          <button type="button" className="quiet icon-button" disabled={disabled} aria-label={`Fläche ${face.key} entfernen`}
            onClick={() => setTraits({ ...traits, faces: removeAt(faces, index) })}>×</button>
        </div>;
      })}
      {definition.bodies.length > 0 && <button type="button" className="quiet" disabled={disabled} onClick={() => {
        const body = definition.bodies[0]!;
        setTraits({ ...traits, faces: [...faces, {
          key: uniqueKey('flaeche', faces.map(face => face.key)), label: 'Fläche', body: body.key, side: body.kind === 'sheet' ? 'front' : 'top',
        }] });
      }}>Fläche hinzufügen</button>}
    </fieldset>
    <IssueLines issues={own} />
  </div>;
}
