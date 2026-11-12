import { Fragment, useEffect, useState } from 'react';
import {
  PARAMETER_SCOPES, PARAMETER_SCOPE_LABELS, PARAMETER_TYPES, PARAMETER_TYPE_LABELS,
  type PartDefinition, type PartParameter,
} from '../../shared/parts/definition.js';
import { IssueLines, NumberInput, type FieldIssue } from './FormulaField.js';
import { newParameter, parseValueList, removeParameter, updateParameter, withParameterDomain, withParameterType } from './draft.js';

type Issue = FieldIssue & { parameter?: string; variant?: string; code?: string };

function ValueListInput({ values, onChange, label, disabled }: { values: number[]; onChange: (values: number[]) => void; label: string; disabled?: boolean }) {
  const [text, setText] = useState(values.join('; '));
  useEffect(() => {
    setText(current => parseValueList(current).join(';') === values.join(';') ? current : values.join('; '));
  }, [values]);
  return <input aria-label={label} value={text} disabled={disabled} placeholder="200; 400; 600"
    onChange={event => {
      setText(event.target.value);
      const parsed = parseValueList(event.target.value);
      if (parsed.length) onChange(parsed);
    }} />;
}

/**
 * Parameters of the open definition. The preview column sets values for parameters the
 * variant does not set; they are not saved.
 */
export function ParameterTable({ definition, onChange, issues, disabled, preview, onPreview, resolvedValues }: {
  definition: PartDefinition;
  onChange: (definition: PartDefinition) => void;
  issues: readonly Issue[];
  disabled: boolean;
  preview: Readonly<Record<string, number>>;
  onPreview: (key: string, value: number | undefined) => void;
  resolvedValues: Readonly<Record<string, number>> | undefined;
}) {
  const hasVariants = !!definition.variants?.length;
  const set = (index: number, next: PartParameter) => onChange(updateParameter(definition, index, next));
  return <div className="designer-table-wrap" data-testid="designer-parameters">
    <table className="designer-table">
      <thead><tr>
        <th scope="col">Schlüssel</th><th scope="col">Bezeichnung</th><th scope="col">Art</th><th scope="col">Bestimmt durch</th>
        <th scope="col">Standard</th><th scope="col">Bereich oder Werte</th><th scope="col">Vorschau</th><th scope="col"><span className="sr-only">Aktionen</span></th>
      </tr></thead>
      <tbody>
        {definition.parameters.map((parameter, index) => {
          const own = issues.filter(item => item.parameter === parameter.key && item.code !== undefined
            && ['parameter-domain', 'duplicate-key', 'reserved-name', 'schema'].includes(item.code));
          const domain = parameter.values ? 'values' : 'range';
          const setByVariant = hasVariants && parameter.scope === 'variant';
          return <Fragment key={index}><tr>
            <td><input aria-label={`Schlüssel von Parameter ${index + 1}`} className="key-input" value={parameter.key} disabled={disabled}
              onChange={event => set(index, { ...parameter, key: event.target.value })} /></td>
            <td><input aria-label={`Bezeichnung von ${parameter.key}`} value={parameter.label} disabled={disabled}
              onChange={event => set(index, { ...parameter, label: event.target.value })} /></td>
            <td><select aria-label={`Art von ${parameter.key}`} value={parameter.type} disabled={disabled}
              onChange={event => set(index, withParameterType(parameter, event.target.value as PartParameter['type']))}>
              {PARAMETER_TYPES.map(type => <option key={type} value={type}>{PARAMETER_TYPE_LABELS[type]}</option>)}
            </select></td>
            <td><select aria-label={`Bestimmt durch: ${parameter.key}`} value={parameter.scope} disabled={disabled}
              onChange={event => set(index, { ...parameter, scope: event.target.value as PartParameter['scope'] })}>
              {PARAMETER_SCOPES.map(scope => <option key={scope} value={scope}>{PARAMETER_SCOPE_LABELS[scope]}</option>)}
            </select></td>
            <td>{parameter.type === 'toggle'
              ? <select aria-label={`Standardwert von ${parameter.key}`} value={parameter.default} disabled={disabled}
                onChange={event => set(index, { ...parameter, default: Number(event.target.value) })}>
                <option value={0}>Nein</option><option value={1}>Ja</option>
              </select>
              : <NumberInput label={`Standardwert von ${parameter.key}`} value={parameter.default} disabled={disabled}
                testId={`parameter-default-${parameter.key}`} onChange={value => set(index, { ...parameter, default: value })} />}</td>
            <td className="domain-cell">{parameter.type === 'toggle' ? <span className="muted-inline">0 oder 1</span> : <>
              <select aria-label={`Wertebereich von ${parameter.key}`} value={domain} disabled={disabled}
                onChange={event => set(index, withParameterDomain(parameter, event.target.value as 'range' | 'values'))}>
                <option value="range">Bereich</option><option value="values">Werteliste</option>
              </select>
              {parameter.range && <span className="range-inputs">
                <NumberInput label={`Kleinster Wert von ${parameter.key}`} value={parameter.range.min} disabled={disabled}
                  onChange={value => set(index, { ...parameter, range: { ...parameter.range!, min: value } })} />
                <span aria-hidden="true">bis</span>
                <NumberInput label={`Größter Wert von ${parameter.key}`} value={parameter.range.max} disabled={disabled}
                  onChange={value => set(index, { ...parameter, range: { ...parameter.range!, max: value } })} />
                <input type="number" aria-label={`Schrittweite von ${parameter.key}`} placeholder="Schritt" disabled={disabled}
                  value={parameter.range.step ?? ''} min={0}
                  onChange={event => {
                    const step = Number(event.target.value);
                    const { step: _old, ...range } = parameter.range!;
                    set(index, { ...parameter, range: event.target.value && step > 0 ? { ...range, step } : range });
                  }} />
              </span>}
              {parameter.values && <ValueListInput label={`Werte von ${parameter.key}`} values={parameter.values} disabled={disabled}
                onChange={values => set(index, { ...parameter, values })} />}
            </>}</td>
            <td>{setByVariant
              ? <span className="muted-inline" title="Wird von der gewählten Variante bestimmt">{resolvedValues?.[parameter.key] ?? parameter.default} (Variante)</span>
              : <span className="preview-cell">
                <input type="number" aria-label={`Vorschauwert von ${parameter.key}`} placeholder={String(parameter.default)}
                  data-testid={`parameter-preview-${parameter.key}`}
                  value={preview[parameter.key] ?? ''}
                  onChange={event => onPreview(parameter.key, event.target.value === '' ? undefined : Number(event.target.value))} />
              </span>}</td>
            <td><button type="button" className="quiet icon-button" disabled={disabled} aria-label={`Parameter ${parameter.key} entfernen`}
              onClick={() => onChange(removeParameter(definition, index))}>Entfernen</button></td>
          </tr>
          {own.length > 0 && <tr className="row-issues"><td colSpan={8}><IssueLines issues={own} /></td></tr>}
          </Fragment>;
        })}
      </tbody>
    </table>
    {!definition.parameters.length && <p className="muted">Noch keine Parameter. Maße werden dann als feste Zahlen eingetragen.</p>}
    <div className="designer-actions">
      <button type="button" className="quiet" disabled={disabled}
        onClick={() => onChange({ ...definition, parameters: [...definition.parameters, newParameter(definition)] })}>Parameter hinzufügen</button>
    </div>
  </div>;
}
