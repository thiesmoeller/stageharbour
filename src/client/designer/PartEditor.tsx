import type { ReactNode } from 'react';
import { PLAN_SYMBOLS, STOCK_MODES, type PartChild, type PartDefinition, type PartMaterial } from '../../shared/parts/definition.js';
import type { PartIssue } from '../../shared/parts/issues.js';
import type { PartSummary } from '../../shared/parts/catalog.js';
import type { ResolvedPart } from '../../shared/parts/resolve.js';
import { CutListPanel, IssueList } from './CutListPanel.js';
import { CoreMeasures } from './CoreMeasures.js';
import { ElementEditor, TraitsEditor, type EditorIssue } from './ElementEditor.js';
import { FormulaField, IssueLines } from './FormulaField.js';
import { OpeningInspector } from './OpeningInspector.js';
import { ParameterTable } from './ParameterTable.js';
import { VariantTable } from './VariantTable.js';
import { moveItem, newDerived, removeAt, replaceAt, selectionOfIssue, type DesignerSelection } from './draft.js';
import { previewScope } from './formulaPreview.js';

const STOCK_LABELS: Record<(typeof STOCK_MODES)[number], string> = {
  item: 'Einzelstücke mit Kennzeichnung', count: 'Gezählter Bestand', none: 'Nicht im Bestand',
};
const PLAN_SYMBOL_LABELS: Record<(typeof PLAN_SYMBOLS)[number], string> = {
  footprint: 'Grundfläche', solids: 'Körper von oben', stair: 'Treppe',
};

function Section({ title, children, open = true, testId }: { title: string; children: ReactNode; open?: boolean; testId?: string }) {
  return <details className="inspector-section" open={open} data-testid={testId}>
    <summary>{title}</summary>
    <div className="inspector-section-body">{children}</div>
  </details>;
}

export type PartEditorProps = {
  definition: PartDefinition;
  onChange: (definition: PartDefinition, select?: DesignerSelection) => void;
  resolved: ResolvedPart | undefined;
  issues: readonly PartIssue[];
  materials: readonly PartMaterial[];
  disabled: boolean;
  selection: DesignerSelection | undefined;
  onSelect: (selection: DesignerSelection | undefined) => void;
  library: readonly PartSummary[];
  childDefinition: (child: PartChild) => PartDefinition | undefined;
  onUpgradeChild: (key: string, partId: string) => void;
  previewVariant: string | undefined;
  onPreviewVariant: (variant: string) => void;
  previewValues: Readonly<Record<string, number>>;
  onPreviewValue: (key: string, value: number | undefined) => void;
  favourite: boolean | undefined;
  onFavourite: ((favourite: boolean) => void) | undefined;
  /** Sheet body key when the face sketcher is active. */
  sketchBodyKey?: string;
  /** Hole selected on the face sketcher. */
  openingKey?: string;
};

/** Right-hand inspector: essentials first; formulas and full parameter chrome under Erweitert. */
export function PartEditor(props: PartEditorProps) {
  const { definition, onChange, resolved, issues, materials, disabled, selection, onSelect } = props;
  const editorIssues = issues as readonly EditorIssue[];
  const derived = definition.derived ?? [];
  const metaIssues = (field: string) => issues.filter(item => item.field === field && !item.parameter && !item.body && !item.child);
  const sketching = !!props.sketchBodyKey;
  const showOpening = sketching && !!props.openingKey;

  return <div className="designer-inspector" data-testid="designer-inspector">
    <Section title="Bauteil">
      <label className="designer-field">Name
        <input value={definition.name} disabled={disabled} data-testid="part-name" onChange={event => onChange({ ...definition, name: event.target.value })} />
      </label>
      <IssueLines issues={metaIssues('name')} />
      <label className="designer-field">Kategorie
        <input value={definition.category} disabled={disabled} data-testid="part-category" onChange={event => onChange({ ...definition, category: event.target.value })} />
      </label>
      <IssueLines issues={metaIssues('category')} />
      {props.favourite !== undefined && <label className="checkbox-line">
        <input type="checkbox" checked={props.favourite} disabled={!props.onFavourite} onChange={event => props.onFavourite?.(event.target.checked)} />Favorit
      </label>}
    </Section>

    <Section title="Maße" testId="designer-section-measures">
      <p className="muted">Die üblichen Größen dieses Bauteils. Öffnungen zeichnest du auf der Fläche.</p>
      <CoreMeasures definition={definition} onChange={onChange} disabled={disabled} />
    </Section>

    {!!definition.variants?.length && <Section title="Varianten" testId="designer-section-variants">
      <VariantTable definition={definition} onChange={onChange} issues={issues} disabled={disabled}
        previewVariant={props.previewVariant} onPreviewVariant={props.onPreviewVariant} />
    </Section>}

    {sketching && <Section title="Öffnung" testId="designer-section-opening">
      {showOpening && props.sketchBodyKey && props.openingKey
        ? <OpeningInspector definition={definition} bodyKey={props.sketchBodyKey} holeKey={props.openingKey}
          activeVariant={props.previewVariant} disabled={disabled} onChange={onChange} />
        : <p className="muted">Öffnung auf der Fläche anklicken oder neu aufziehen.</p>}
    </Section>}

    <Section title="Auswahl" open={!sketching} testId="designer-section-selection">
      <ElementEditor definition={definition} onChange={onChange} resolved={resolved} issues={editorIssues} materials={materials} disabled={disabled}
        selection={selection} library={props.library} childDefinition={props.childDefinition} onUpgradeChild={props.onUpgradeChild} />
    </Section>

    <Section title="Erweitert · Parameter und Formeln" open={false} testId="designer-section-advanced">
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
            {STOCK_MODES.map(mode => <option key={mode} value={mode}>{STOCK_LABELS[mode]}</option>)}
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
              scope={previewScope(resolved)} issues={own} onChange={formula => set({ ...item, formula })} />
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

    <Section title="Zuschnittliste und Gewicht" open={false} testId="designer-section-cutlist">
      <CutListPanel resolved={resolved} materials={materials} />
    </Section>
    <Section title="Prüfung" testId="designer-section-issues">
      <IssueList issues={issues} onSelect={index => {
        const target = issues[index] && selectionOfIssue(issues[index], definition);
        if (target) onSelect(target);
      }} />
    </Section>
  </div>;
}
