import { openingOwnedParameterKeys } from '../../shared/parts/openingParams.js';
import type { PartDefinition } from '../../shared/parts/definition.js';
import { NumberInput } from './FormulaField.js';

/**
 * Placement / size knobs without Schlüssel, Scope or range chrome. Opening-owned parameters are
 * omitted — they belong to the face sketcher / OpeningInspector.
 */
export function CoreMeasures({ definition, onChange, disabled }: {
  definition: PartDefinition;
  onChange: (definition: PartDefinition) => void;
  disabled: boolean;
}) {
  const owned = openingOwnedParameterKeys(definition);
  const rows = definition.parameters.filter(parameter => !owned.has(parameter.key));
  if (!rows.length) {
    return <p className="muted" data-testid="designer-core-measures">Keine allgemeinen Maße — Öffnungen auf der Fläche zeichnen.</p>;
  }
  return <div className="core-measures" data-testid="designer-core-measures">
    {rows.map(parameter => (
      <label key={parameter.key} className="designer-field">
        {parameter.label || parameter.key}
        {parameter.type === 'toggle'
          ? <select aria-label={parameter.label || parameter.key} value={parameter.default} disabled={disabled}
            data-testid={`parameter-default-${parameter.key}`}
            onChange={event => onChange({
              ...definition,
              parameters: definition.parameters.map(entry =>
                entry.key === parameter.key ? { ...entry, default: Number(event.target.value) } : entry),
            })}>
            <option value={0}>Nein</option><option value={1}>Ja</option>
          </select>
          : <NumberInput
            label={parameter.label || parameter.key}
            value={parameter.default}
            disabled={disabled}
            testId={`parameter-default-${parameter.key}`}
            onChange={value => onChange({
              ...definition,
              parameters: definition.parameters.map(entry =>
                entry.key === parameter.key ? { ...entry, default: value } : entry),
            })}
          />}
      </label>
    ))}
  </div>;
}
