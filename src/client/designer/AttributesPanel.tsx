import { useState, type ReactNode } from 'react';
import { BODY_MATERIAL_KINDS, type PartBody, type PartChild, type PartDefinition, type PartMaterial } from '../../shared/parts/definition.js';
import { calculateFormula, type Formula } from '../../shared/parts/formula.js';
import type { Handle } from '../../shared/parts/handles.js';
import { formatNumber, type PartIssue } from '../../shared/parts/issues.js';
import type { PartSummary } from '../../shared/parts/catalog.js';
import type { ResolvedPart } from '../../shared/parts/resolve.js';
import { definitionFormulaSites, type FormulaSite } from '../../shared/parts/sites.js';
import { ElementEditor, MaterialSelect, TraitsEditor, type EditorIssue } from './ElementEditor.js';
import { FormulaField } from './FormulaField.js';
import { ParameterTable } from './ParameterTable.js';
import { moveItem, newDerived, removeAt, replaceAt, type DesignerSelection } from './draft.js';
import { previewScope } from './formulaPreview.js';
import { PLAN_SYMBOLS, STOCK_MODES } from '../../shared/parts/definition.js';

const STOCK_LABELS: Record<(typeof STOCK_MODES)[number], string> = {
  item: 'Einzelstücke mit Kennzeichnung', count: 'Gezählter Bestand', none: 'Nicht im Bestand',
};
const PLAN_SYMBOL_LABELS: Record<(typeof PLAN_SYMBOLS)[number], string> = {
  footprint: 'Grundfläche', solids: 'Körper von oben', stair: 'Treppe',
};

export type AttributeKind = 'position' | 'size' | 'rotation' | 'material' | 'hidden' | 'repeat';
const ATTRIBUTE_LABELS: Record<AttributeKind, string> = {
  position: 'Position', size: 'Größe', rotation: 'Drehung', material: 'Material', hidden: 'Verborgen', repeat: 'Kopien',
};

const AXES = ['X', 'Y', 'Z'];
const SIZE_NAMES = ['Breite', 'Höhe', 'Tiefe'];

/** German name of an element field such as `size[1]` or `outline.width`. */
export function fieldLabel(field: string): string {
  const match = /^(\w+)(?:\[(\d+)\])?(?:\.(\w+))?(?:\[(\d+)\])?/.exec(field);
  if (!match) return field;
  const [, name, first, sub, second] = match;
  const slot = first === undefined ? undefined : Number(first);
  const axis = slot === undefined ? '' : ` ${AXES[slot] ?? slot}`;
  switch (name) {
    case 'size': return slot === undefined ? 'Größe' : SIZE_NAMES[slot] ?? field;
    case 'at': return `Position${axis}`;
    case 'pivot': return `Drehpunkt${axis}`;
    case 'rotation': return `Drehung${axis}`;
    case 'from': return `Anfang${axis}`;
    case 'to': return `Ende${axis}`;
    case 'section': return slot === 0 ? 'Querschnitt Breite' : 'Querschnitt Höhe';
    case 'roll': return 'Drehung um die Achse';
    case 'thickness': return 'Stärke';
    case 'offset': return 'Versatz';
    case 'when': return 'Sichtbar wenn';
    case 'outline':
      if (sub === 'width') return 'Breite';
      if (sub === 'height') return 'Höhe';
      if (sub === 'x') return 'Lage X';
      if (sub === 'y') return 'Lage Y';
      if (sub === 'points') return `Punkt ${(Number(second ?? 0)) + 1}`;
      return 'Umriss';
    case 'repeat': return sub === 'count' ? 'Kopien' : sub === 'step' ? `Abstand${second === undefined ? '' : ` ${AXES[Number(second)]}`}` : 'Kopien';
    case 'values': return `Wert ${sub ?? ''}`.trim();
    default: return field;
  }
}

const selectionKey = (selection: DesignerSelection | undefined) => selection ? `${selection.kind}:${'key' in selection ? selection.key : selection.index}` : '';

function elementOf(definition: PartDefinition, selection: DesignerSelection | undefined): { element: PartBody | PartChild; base: (string | number)[]; isBody: boolean } | undefined {
  if (selection?.kind === 'body') {
    const index = definition.bodies.findIndex(body => body.key === selection.key);
    return index < 0 ? undefined : { element: definition.bodies[index]!, base: ['bodies', index], isBody: true };
  }
  if (selection?.kind === 'child') {
    const index = (definition.children ?? []).findIndex(child => child.key === selection.key);
    return index < 0 ? undefined : { element: definition.children![index]!, base: ['children', index], isBody: false };
  }
  return undefined;
}

function setAt(definition: PartDefinition, location: readonly (string | number)[], value: unknown): PartDefinition {
  const next = structuredClone(definition) as unknown as Record<string | number, unknown>;
  let current = next;
  for (const part of location.slice(0, -1)) current = current[part] as Record<string | number, unknown>;
  current[location[location.length - 1]!] = value;
  return next as unknown as PartDefinition;
}

function evaluateSite(site: FormulaSite, scope: Map<string, number> | undefined): number | undefined {
  if (!scope) return undefined;
  try {
    const local = new Map(scope);
    for (const index of site.indices) if (!local.has(index)) local.set(index, 0);
    const value = calculateFormula(site.formula, local);
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Fields an added attribute shows, adding the missing optional fields with their neutral value. */
function addAttribute(definition: PartDefinition, selection: DesignerSelection, resolved: ResolvedPart | undefined, kind: AttributeKind): { definition: PartDefinition; fields: string[] } {
  const found = elementOf(definition, selection);
  if (!found) return { definition, fields: [] };
  const { element, base } = found;
  const solid = resolved?.solids.find(item => item.path.length === 1 && item.path[0] === element.key);
  let next = definition;
  const ensure = (field: string, value: unknown) => {
    if ((element as Record<string, unknown>)[field] === undefined) next = setAt(next, [...base, field], value);
  };
  const isBody = 'kind' in element;
  const kindOf = isBody ? (element as PartBody).kind : 'child';
  switch (kind) {
    case 'position':
      return { definition, fields: kindOf === 'beam' ? ['from[0]', 'from[1]', 'from[2]', 'to[0]', 'to[1]', 'to[2]'] : ['at[0]', 'at[1]', 'at[2]'] };
    case 'size':
      if (kindOf === 'box') return { definition, fields: ['size[0]', 'size[1]', 'size[2]'] };
      if (kindOf === 'beam') {
        ensure('section', solid?.kind === 'beam' ? [solid.size.x, solid.size.z] : [40, 40]);
        return { definition: next, fields: ['section[0]', 'section[1]'] };
      }
      if (kindOf === 'sheet') {
        ensure('thickness', solid?.kind === 'sheet' ? solid.thickness : 10);
        const outline = (element as Extract<PartBody, { kind: 'sheet' }>).outline;
        return {
          definition: next,
          fields: outline.shape === 'rect'
            ? ['outline.width', 'outline.height', 'thickness']
            : outline.shape === 'circle'
              ? ['outline.r', 'thickness']
              : ['thickness'],
        };
      }
      return { definition, fields: [] };
    case 'rotation':
      if (kindOf === 'beam') { ensure('roll', 0); return { definition: next, fields: ['roll'] }; }
      ensure('rotation', [0, 0, 0]);
      return { definition: next, fields: ['rotation[0]', 'rotation[1]', 'rotation[2]'] };
    case 'material':
      return { definition, fields: ['material'] };
    case 'hidden':
      ensure('when', 1);
      return { definition: next, fields: ['when'] };
    case 'repeat':
      ensure('repeat', { count: 1, step: [0, 0, 0] });
      return { definition: next, fields: Array.isArray(element.repeat) ? ['repeat[0].count'] : ['repeat.count', 'repeat.step[0]', 'repeat.step[1]', 'repeat.step[2]'] };
  }
}

function Section({ title, children, open = true, testId }: { title: string; children: ReactNode; open?: boolean; testId?: string }) {
  return <details className="inspector-section" open={open} data-testid={testId}>
    <summary>{title}</summary>
    <div className="inspector-section-body">{children}</div>
  </details>;
}

export type AttributesPanelProps = {
  definition: PartDefinition;
  onChange: (definition: PartDefinition, select?: DesignerSelection) => void;
  resolved: ResolvedPart | undefined;
  issues: readonly PartIssue[];
  materials: readonly PartMaterial[];
  disabled: boolean;
  selection: DesignerSelection | undefined;
  library: readonly PartSummary[];
  childDefinition: (child: PartChild) => PartDefinition | undefined;
  onUpgradeChild: (key: string, partId: string) => void;
  previewValues: Readonly<Record<string, number>>;
  onPreviewValue: (key: string, value: number | undefined) => void;
  /** A dimension picked on the canvas, offered as an option. */
  promote: Handle | undefined;
  onPromote: (handle: Handle) => void;
  onPromoteField: (selection: DesignerSelection, path: (string | number)[], label: string) => void;
  onDismissPromote: () => void;
};

/**
 * Attribute: the formula-driven fields of the selection as a short list, values or formulas.
 * Plain numbers stay on the canvas; „Attribut hinzufügen“ brings one in. All fields remain under
 * „Alle Felder“.
 */
export function AttributesPanel(props: AttributesPanelProps) {
  const { definition, onChange, resolved, issues, disabled, selection, promote } = props;
  const [mode, setMode] = useState<'values' | 'formulas'>('values');
  const [pinned, setPinned] = useState<Record<string, string[]>>({});
  const editorIssues = issues as readonly EditorIssue[];
  const found = elementOf(definition, selection);
  const ownKey = selectionKey(selection);
  const promoteField = promote?.measure?.path ? promote.measure.path.reduce<string>((text, part) =>
    typeof part === 'number' ? `${text}[${part}]` : text ? `${text}.${part}` : part, '') : undefined;
  const promoteHere = promote && found?.isBody && found.element.key === promote.body;
  const pins = new Set([...(pinned[ownKey] ?? []), ...(promoteHere && promoteField ? [promoteField] : [])]);
  const scope = previewScope(resolved);
  const sites = found
    ? definitionFormulaSites(definition).filter(site => site.owner.kind === (found.isBody ? 'body' : 'child') && site.owner.key === found.element.key && site.hole === undefined)
    : definitionFormulaSites(definition).filter(site => site.owner.kind === 'derived');
  const rows = sites.filter(site => typeof site.formula === 'string' || pins.has(site.field));
  const writeSite = (site: FormulaSite, formula: Formula) => onChange(setAt(definition, site.location, formula));
  const derived = definition.derived ?? [];

  return <div className="designer-attributes" data-testid="designer-attributes">
    <div className="attribute-head">
      <strong data-testid="attribute-target">{found ? found.element.label || found.element.key : 'Bauteil · abgeleitete Werte'}</strong>
      <div className="segmented" role="group" aria-label="Anzeige der Attribute">
        <button type="button" aria-pressed={mode === 'values'} data-testid="attribute-mode-values" onClick={() => setMode('values')}>Werte</button>
        <button type="button" aria-pressed={mode === 'formulas'} data-testid="attribute-mode-formulas" onClick={() => setMode('formulas')}>Formeln</button>
      </div>
    </div>

    {promoteHere && promote.measure && <div className="attribute-promote" role="status" data-testid="attribute-promote-callout">
      <span>{promote.measure.label}: {formatNumber(Math.round(promote.measure.value * 10) / 10)} mm</span>
      <button type="button" disabled={disabled || !promote.measure.path} data-testid="attribute-promote" onClick={() => props.onPromote(promote)}>Als Option freigeben</button>
      <button type="button" className="quiet icon-button" aria-label="Schließen" onClick={props.onDismissPromote}>×</button>
    </div>}

    {!rows.length && !pins.has('material') && <p className="muted" data-testid="attribute-empty">{found
      ? 'Alle Felder sind feste Zahlen – ziehe im 3D-Fenster oder füge ein Attribut hinzu.'
      : 'Wähle einen Körper im 3D-Fenster, um seine Formeln zu sehen.'}</p>}
    <ul className="attribute-list">
      {rows.map(site => {
        const value = evaluateSite(site, scope);
        const own = issues.filter(item => item.field === site.field && (found ? (found.isBody ? item.body : item.child) === found.element.key : item.derived === site.owner.key));
        const label = site.owner.kind === 'derived' ? site.owner.key : fieldLabel(site.field);
        const testId = `attribute-${site.owner.kind === 'derived' ? site.owner.key : site.field}`;
        return <li key={site.field + site.owner.key} className="attribute-row" data-formula={typeof site.formula === 'string' ? 'yes' : 'no'}>
          {mode === 'formulas'
            ? <FormulaField compact label={label} value={site.formula} disabled={disabled} scope={scope} issues={own} testId={testId}
              onChange={formula => writeSite(site, formula)} />
            : <div className="attribute-value"><span>{label}</span>
              {typeof site.formula === 'number'
                ? <FormulaField compact label="" value={site.formula} disabled={disabled} scope={scope} issues={own} testId={testId} onChange={formula => writeSite(site, formula)} />
                : <output data-testid={testId} title={site.formula}>{value === undefined ? '—' : formatNumber(Math.round(value * 10) / 10)}</output>}
            </div>}
          {found && typeof site.formula === 'number' && <button type="button" className="quiet" disabled={disabled}
            data-testid={`attribute-promote-${site.field}`}
            onClick={() => props.onPromoteField(selection!, site.location.slice(2), fieldLabel(site.field))}>Als Option</button>}
        </li>;
      })}
      {found?.isBody && pins.has('material') && <li className="attribute-row">
        <MaterialSelect kind={BODY_MATERIAL_KINDS[(found.element as PartBody).kind]} value={(found.element as PartBody).material} materials={props.materials}
          disabled={disabled} onChange={key => onChange(setAt(definition, [...found.base, 'material'], key))} />
      </li>}
    </ul>

    {found && <label className="designer-field attribute-add">Attribut hinzufügen
      <select value="" disabled={disabled} data-testid="attribute-add" onChange={event => {
        const kind = event.target.value as AttributeKind;
        if (!kind || !selection) return;
        const added = addAttribute(definition, selection, resolved, kind);
        setPinned(current => ({ ...current, [ownKey]: [...new Set([...(current[ownKey] ?? []), ...added.fields])] }));
        if (added.definition !== definition) onChange(added.definition);
      }}>
        <option value="">Wählen …</option>
        {(Object.keys(ATTRIBUTE_LABELS) as AttributeKind[])
          .filter(kind => kind !== 'material' || (found.isBody && (found.element as PartBody).kind !== 'mesh'))
          .map(kind => <option key={kind} value={kind}>{ATTRIBUTE_LABELS[kind]}</option>)}
      </select>
    </label>}

    <Section title="Alle Felder der Auswahl" open={false} testId="designer-section-selection">
      <ElementEditor definition={definition} onChange={onChange} resolved={resolved} issues={editorIssues} materials={props.materials} disabled={disabled}
        selection={selection} library={props.library} childDefinition={props.childDefinition} onUpgradeChild={props.onUpgradeChild} />
    </Section>

    <Section title="Alle Felder · Parameter und Formeln" open={false} testId="designer-section-advanced">
      <p className="muted">Schlüssel, Bereiche, abgeleitete Werte und Formeln — für den Feinschliff.</p>
      <label className="designer-field">Beschreibung
        <textarea rows={2} value={definition.description ?? ''} disabled={disabled} onChange={event => {
          const { description: _old, ...rest } = definition;
          onChange(event.target.value ? { ...rest, description: event.target.value } : rest);
        }} />
      </label>
      <div className="designer-grid-2">
        <label className="designer-field">Bestand
          <select value={definition.traits.stock} disabled={disabled}
            onChange={event => onChange({ ...definition, traits: { ...definition.traits, stock: event.target.value as PartDefinition['traits']['stock'] } })}>
            {STOCK_MODES.map(stock => <option key={stock} value={stock}>{STOCK_LABELS[stock]}</option>)}
          </select>
        </label>
        <label className="designer-field">Darstellung im Plan
          <select value={definition.traits.planSymbol ?? 'footprint'} disabled={disabled} onChange={event => {
            const { planSymbol: _old, ...traits } = definition.traits;
            const value = event.target.value as NonNullable<PartDefinition['traits']['planSymbol']>;
            onChange({ ...definition, traits: value === 'footprint' ? traits : { ...traits, planSymbol: value } });
          }}>
            {PLAN_SYMBOLS.map(symbol => <option key={symbol} value={symbol}>{PLAN_SYMBOL_LABELS[symbol]}</option>)}
          </select>
        </label>
      </div>
      <h3 className="designer-subsection-title">Alle Parameter</h3>
      <ParameterTable definition={definition} onChange={onChange} issues={issues} disabled={disabled}
        preview={props.previewValues} onPreview={props.onPreviewValue} resolvedValues={resolved?.values}
        defaultTestIdPrefix="parameter-advanced" />
      <h3 className="designer-subsection-title">Abgeleitete Werte</h3>
      <div data-testid="designer-derived">
        {derived.map((item, index) => {
          const own = issues.filter(entry => entry.derived === item.key && !entry.path);
          const set = (next: typeof item) => onChange({ ...definition, derived: replaceAt(derived, index, next) });
          return <div key={index} className="derived-row">
            <input aria-label={`Name des abgeleiteten Werts ${index + 1}`} className="key-input" value={item.key} disabled={disabled}
              onChange={event => set({ ...item, key: event.target.value })} />
            <FormulaField compact label="=" value={item.formula} disabled={disabled} testId={`derived-${item.key}`}
              scope={scope} issues={own} onChange={formula => set({ ...item, formula })} />
            <span className="element-actions">
              <button type="button" className="quiet icon-button" disabled={disabled || index === 0} aria-label={`${item.key} nach oben`}
                onClick={() => onChange({ ...definition, derived: moveItem(derived, index, -1) })}>↑</button>
              <button type="button" className="quiet icon-button" disabled={disabled} aria-label={`${item.key} entfernen`}
                onClick={() => {
                  const next = removeAt(derived, index);
                  const { derived: _old, ...rest } = definition;
                  onChange(next.length ? { ...rest, derived: next } : rest);
                }}>×</button>
            </span>
          </div>;
        })}
        <button type="button" className="quiet" disabled={disabled}
          onClick={() => onChange({ ...definition, derived: [...derived, newDerived(definition)] })}>Wert hinzufügen</button>
      </div>
      <h3 className="designer-subsection-title">Eigenschaften</h3>
      <TraitsEditor definition={definition} onChange={onChange} issues={editorIssues} disabled={disabled} />
    </Section>
  </div>;
}

