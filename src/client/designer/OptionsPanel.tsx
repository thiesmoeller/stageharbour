import { useEffect, useState } from 'react';
import {
  PARAMETER_DISPLAYS, PARAMETER_DISPLAY_LABELS, PARAMETER_SCOPES, PARAMETER_SCOPE_LABELS, parameterDisplay,
  type PartDefinition, type PartParameter,
} from '../../shared/parts/definition.js';
import { formatNumber } from '../../shared/parts/issues.js';
import { openingOwnedParameterKeys } from '../../shared/parts/openingParams.js';
import { IssueLines, NumberInput, type FieldIssue } from './FormulaField.js';
import { VariantTable } from './VariantTable.js';
import { newParameter, newVariant, removeParameter, updateParameter } from './draft.js';

type Issue = FieldIssue & { parameter?: string; variant?: string };

/** The value a placer would see first: the active variant's value for a variant-scope parameter, else the default. */
function shownValue(definition: PartDefinition, parameter: PartParameter, variant: string | undefined): number {
  if (parameter.scope !== 'variant') return parameter.default;
  const chosen = definition.variants?.find(item => item.key === variant) ?? definition.variants?.[0];
  return chosen && Object.hasOwn(chosen.values, parameter.key) ? chosen.values[parameter.key]! : parameter.default;
}

function withValue(definition: PartDefinition, parameter: PartParameter, variant: string | undefined, value: number): PartDefinition {
  const variants = definition.variants ?? [];
  const chosen = variants.find(item => item.key === variant) ?? variants[0];
  if (parameter.scope === 'variant' && chosen) {
    return { ...definition, variants: variants.map(item => item === chosen ? { ...item, values: { ...item.values, [parameter.key]: value } } : item) };
  }
  return { ...definition, parameters: definition.parameters.map(entry => entry.key === parameter.key ? { ...entry, default: value } : entry) };
}

function LabelList({ parameter, onChange, disabled }: { parameter: PartParameter; onChange: (labels: string[] | undefined) => void; disabled: boolean }) {
  const count = parameter.type === 'toggle' ? 2 : parameter.values?.length ?? 0;
  const [text, setText] = useState((parameter.valueLabels ?? []).join('; '));
  useEffect(() => { setText((parameter.valueLabels ?? []).join('; ')); }, [parameter.valueLabels]);
  if (!count) return null;
  return <label className="designer-field option-labels">Beschriftungen ({count})
    <input value={text} disabled={disabled} data-testid={`option-labels-${parameter.key}`}
      placeholder={parameter.type === 'toggle' ? 'Zu; Offen' : (parameter.values ?? []).map(value => `${formatNumber(value)} mm`).join('; ')}
      onChange={event => {
        setText(event.target.value);
        const labels = event.target.value.split(';').map(item => item.trim()).filter(Boolean);
        if (!labels.length) onChange(undefined);
        else if (labels.length === count) onChange(labels);
      }} />
  </label>;
}

/** One option as a placer meets it: an input, a list, a read-only value or nothing. */
function OptionControl({ parameter, value, onChange, disabled }: {
  parameter: PartParameter; value: number; onChange: (value: number) => void; disabled: boolean;
}) {
  const display = parameterDisplay(parameter);
  const testId = `parameter-default-${parameter.key}`;
  const name = parameter.label || parameter.key;
  if (parameter.type === 'toggle') {
    const labels = parameter.valueLabels ?? ['Nein', 'Ja'];
    return <select aria-label={name} value={value} disabled={disabled || display === 'readonly'} data-testid={testId}
      onChange={event => onChange(Number(event.target.value))}>
      <option value={0}>{labels[0]}</option><option value={1}>{labels[1]}</option>
    </select>;
  }
  if (display === 'list' && parameter.values?.length) {
    return <select aria-label={name} value={value} disabled={disabled} data-testid={testId} onChange={event => onChange(Number(event.target.value))}>
      {!parameter.values.includes(value) && <option value={value}>{formatNumber(value)}</option>}
      {parameter.values.map((item, index) => <option key={item} value={item}>{parameter.valueLabels?.[index] ?? `${formatNumber(item)}${parameter.type === 'length' ? ' mm' : ''}`}</option>)}
    </select>;
  }
  if (display === 'readonly') {
    return <output className="option-readonly" data-testid={`option-readonly-${parameter.key}`}>{formatNumber(value)}{parameter.type === 'length' ? ' mm' : ''}
      <NumberInput label={name} value={value} disabled={disabled} testId={testId} onChange={onChange} />
    </output>;
  }
  return <NumberInput label={name} value={value} disabled={disabled} testId={testId} onChange={onChange} />;
}

/**
 * Optionen: the parameters exactly as someone placing the part sees them, the variant strip on
 * top. The author picks how each option is offered and whether the variant sets it.
 */
export function OptionsPanel({ definition, onChange, issues, disabled, previewVariant, onPreviewVariant, favourite, onFavourite }: {
  definition: PartDefinition;
  onChange: (definition: PartDefinition) => void;
  issues: readonly Issue[];
  disabled: boolean;
  previewVariant: string | undefined;
  onPreviewVariant: (key: string) => void;
  favourite: boolean | undefined;
  onFavourite: ((favourite: boolean) => void) | undefined;
}) {
  const owned = openingOwnedParameterKeys(definition);
  const options = definition.parameters.map((parameter, index) => ({ parameter, index })).filter(({ parameter }) => !owned.has(parameter.key));
  const variants = definition.variants ?? [];
  const active = variants.some(variant => variant.key === previewVariant) ? previewVariant : variants[0]?.key;
  const metaIssues = (field: string) => issues.filter(item => item.field === field && !item.parameter);
  return <div className="designer-options" data-testid="designer-options">
    <section className="options-block">
      <label className="designer-field">Name
        <input value={definition.name} disabled={disabled} data-testid="part-name" onChange={event => onChange({ ...definition, name: event.target.value })} />
      </label>
      <IssueLines issues={metaIssues('name')} />
      <label className="designer-field">Kategorie
        <input value={definition.category} disabled={disabled} data-testid="part-category" onChange={event => onChange({ ...definition, category: event.target.value })} />
      </label>
      <IssueLines issues={metaIssues('category')} />
      {favourite !== undefined && <label className="checkbox-line">
        <input type="checkbox" checked={favourite} disabled={!onFavourite} onChange={event => onFavourite?.(event.target.checked)} />Favorit
      </label>}
    </section>

    <section className="options-block" aria-label="Varianten">
      <div className="variant-strip" role="group" aria-label="Variante der Vorschau" data-testid="designer-variant-strip">
        {variants.map(variant => <button key={variant.key} type="button" className={variant.key === active ? 'variant-chip active' : 'variant-chip'}
          aria-pressed={variant.key === active} data-testid={`designer-variant-${variant.key}`} onClick={() => onPreviewVariant(variant.key)}>
          {variant.label}
        </button>)}
        {!variants.length && <span className="muted-inline">Keine Varianten: jede Option ist frei wählbar.</span>}
        <button type="button" className="quiet variant-add" disabled={disabled} data-testid="designer-variant-add"
          onClick={() => {
            const variant = newVariant(definition);
            onChange({ ...definition, variants: [...variants, variant] });
            onPreviewVariant(variant.key);
          }}>+ Variante</button>
      </div>
      {variants.length > 0 && <details className="inspector-section nested" data-testid="designer-section-variants">
        <summary>Varianten bearbeiten</summary>
        <div className="inspector-section-body">
          <VariantTable definition={definition} onChange={onChange} issues={issues} disabled={disabled}
            previewVariant={active} onPreviewVariant={onPreviewVariant} />
        </div>
      </details>}
    </section>

    <section className="options-block">
      {!options.length && <p className="muted">Noch keine Optionen. Ein Maß im 3D-Fenster anklicken und „Als Option freigeben“ – oder Öffnungen auf der Fläche zeichnen.</p>}
      <ul className="option-list" data-testid="designer-core-measures">
        {options.map(({ parameter, index }) => {
          const display = parameterDisplay(parameter);
          const own = issues.filter(item => item.parameter === parameter.key && !item.variant);
          const set = (next: PartParameter) => onChange(updateParameter(definition, index, next));
          return <li key={index} className={`option-row display-${display}`} data-testid={`option-${parameter.key}`}>
            <div className="option-head">
              <input className="option-label" aria-label={`Bezeichnung von ${parameter.key}`} value={parameter.label} disabled={disabled}
                data-testid={`option-label-${parameter.key}`} onChange={event => set({ ...parameter, label: event.target.value })} />
              <code className="option-key">{parameter.key}</code>
            </div>
            <div className="option-value">
              <OptionControl parameter={parameter} value={shownValue(definition, parameter, active)} disabled={disabled}
                onChange={value => onChange(withValue(definition, parameter, active, value))} />
              {parameter.scope === 'variant' && variants.length > 0 && <span className="muted-inline">in „{variants.find(item => item.key === active)?.label}“</span>}
            </div>
            <div className="option-settings">
              <label>Anzeige
                <select value={display} disabled={disabled} data-testid={`option-display-${parameter.key}`}
                  onChange={event => {
                    const next = event.target.value as PartParameter['display'] & string;
                    const { display: _old, ...rest } = parameter;
                    set(next === parameterDisplay({ ...rest }) ? rest : { ...rest, display: next });
                  }}>
                  {PARAMETER_DISPLAYS.filter(item => item !== 'list' || parameter.type === 'toggle' || !!parameter.values?.length)
                    .map(item => <option key={item} value={item}>{PARAMETER_DISPLAY_LABELS[item]}</option>)}
                </select>
              </label>
              <label>Bestimmt durch
                <select value={parameter.scope} disabled={disabled} data-testid={`option-scope-${parameter.key}`}
                  onChange={event => set({ ...parameter, scope: event.target.value as PartParameter['scope'] })}>
                  {PARAMETER_SCOPES.map(scope => <option key={scope} value={scope}>{PARAMETER_SCOPE_LABELS[scope]}</option>)}
                </select>
              </label>
              <button type="button" className="quiet icon-button" disabled={disabled} aria-label={`Option ${parameter.label || parameter.key} entfernen`}
                onClick={() => onChange(removeParameter(definition, index))}>×</button>
            </div>
            <LabelList parameter={parameter} disabled={disabled} onChange={labels => {
              const { valueLabels: _old, ...rest } = parameter;
              set(labels ? { ...rest, valueLabels: labels } : rest);
            }} />
            <IssueLines issues={own} />
          </li>;
        })}
      </ul>
      <button type="button" className="quiet" disabled={disabled} data-testid="designer-option-add"
        onClick={() => onChange({ ...definition, parameters: [...definition.parameters, newParameter(definition)] })}>Option hinzufügen</button>
    </section>
  </div>;
}
