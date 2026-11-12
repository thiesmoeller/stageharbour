import { Fragment } from 'react';
import type { PartDefinition, PartVariant } from '../../shared/parts/definition.js';
import { IssueLines, NumberInput, type FieldIssue } from './FormulaField.js';
import { moveItem, newVariant, removeAt, replaceAt } from './draft.js';

type Issue = FieldIssue & { variant?: string };

/** Named variants with their values for the variant-scope parameters; the chosen one drives the preview. */
export function VariantTable({ definition, onChange, issues, disabled, previewVariant, onPreviewVariant }: {
  definition: PartDefinition;
  onChange: (definition: PartDefinition) => void;
  issues: readonly Issue[];
  disabled: boolean;
  previewVariant: string | undefined;
  onPreviewVariant: (key: string) => void;
}) {
  const variants = definition.variants ?? [];
  const columns = definition.parameters.filter(parameter => parameter.scope === 'variant');
  const setVariants = (next: PartVariant[]) => onChange({ ...definition, variants: next });
  const set = (index: number, next: PartVariant) => setVariants(replaceAt(variants, index, next));
  const active = previewVariant !== undefined && variants.some(variant => variant.key === previewVariant) ? previewVariant : variants[0]?.key;
  return <div className="designer-table-wrap" data-testid="designer-variants">
    {variants.length > 0 && <table className="designer-table">
      <thead><tr>
        <th scope="col">Vorschau</th><th scope="col">Schlüssel</th><th scope="col">Bezeichnung</th>
        {columns.map(parameter => <th key={parameter.key} scope="col">{parameter.label} ({parameter.key})</th>)}
        <th scope="col"><span className="sr-only">Aktionen</span></th>
      </tr></thead>
      <tbody>
        {variants.map((variant, index) => {
          const own = issues.filter(item => item.variant === variant.key && !item.message.includes('Tritt auf bei'));
          return <Fragment key={index}><tr aria-selected={variant.key === active}>
            <td><input type="radio" name="designer-preview-variant" aria-label={`Variante ${variant.label} in der Vorschau zeigen`}
              checked={variant.key === active} onChange={() => onPreviewVariant(variant.key)} /></td>
            <td><input className="key-input" aria-label={`Schlüssel von Variante ${index + 1}`} value={variant.key} disabled={disabled}
              onChange={event => {
                set(index, { ...variant, key: event.target.value });
                if (variant.key === active) onPreviewVariant(event.target.value);
              }} /></td>
            <td><input aria-label={`Bezeichnung von Variante ${variant.key}`} value={variant.label} disabled={disabled}
              onChange={event => set(index, { ...variant, label: event.target.value })} /></td>
            {columns.map(parameter => <td key={parameter.key}>
              {parameter.type === 'toggle'
                ? <select aria-label={`${parameter.label} in Variante ${variant.key}`} disabled={disabled}
                  value={variant.values[parameter.key] ?? parameter.default}
                  onChange={event => set(index, { ...variant, values: { ...variant.values, [parameter.key]: Number(event.target.value) } })}>
                  <option value={0}>Nein</option><option value={1}>Ja</option>
                </select>
                : <NumberInput label={`${parameter.label} in Variante ${variant.key}`} disabled={disabled}
                  value={variant.values[parameter.key] ?? parameter.default}
                  onChange={value => set(index, { ...variant, values: { ...variant.values, [parameter.key]: value } })} />}
            </td>)}
            <td className="row-actions">
              <button type="button" className="quiet icon-button" disabled={disabled || index === 0} aria-label={`Variante ${variant.key} nach oben`}
                onClick={() => setVariants(moveItem(variants, index, -1))}>↑</button>
              <button type="button" className="quiet icon-button" disabled={disabled} aria-label={`Variante ${variant.key} entfernen`}
                onClick={() => setVariants(removeAt(variants, index))}>Entfernen</button>
            </td>
          </tr>
          {own.length > 0 && <tr className="row-issues"><td colSpan={columns.length + 4}><IssueLines issues={own} /></td></tr>}
          </Fragment>;
        })}
      </tbody>
    </table>}
    {!variants.length && <p className="muted">Ohne Varianten sind alle Parameter frei wählbar. Varianten halten die Maße fest, die eure Gruppe tatsächlich besitzt.</p>}
    {variants.length > 0 && !columns.length && <p className="muted">Kein Parameter wird von der Variante bestimmt. Unter „Bestimmt durch“ einen Parameter auf „Variante“ stellen.</p>}
    <div className="designer-actions">
      <button type="button" className="quiet" disabled={disabled} onClick={() => setVariants([...variants, newVariant(definition)])}>Variante hinzufügen</button>
    </div>
  </div>;
}
