import { RAL_PAINT_SWATCHES, ralLabel, type RalSwatch } from '../../shared/ral.js';

/** Theatre RAL paint chips — scenic paint catalogue / CAD material chips. */
export function RalPicker({
  id, name, label, value, mixed = false, onChange,
}: {
  id: string; name: string; label: string; value?: string; mixed?: boolean;
  onChange?: (code: string | undefined) => void;
}) {
  return <div className="ral-picker" data-testid={id}>
    <span className="ral-picker-label" id={`${id}-label`}>{label}</span>
    {mixed && <span className="ral-mixed" title="Unterschiedliche Werte in der Auswahl">— gemischt —</span>}
    <div className="ral-swatches" role="listbox" aria-labelledby={`${id}-label`}>
      <button
        type="button"
        role="option"
        className={`ral-swatch ral-swatch-none${!value && !mixed ? ' is-selected' : ''}`}
        aria-selected={!value && !mixed}
        title="Kein RAL"
        onClick={() => onChange?.(undefined)}
      >—</button>
      {RAL_PAINT_SWATCHES.map((swatch: RalSwatch) =>
        <button
          key={swatch.code}
          type="button"
          role="option"
          className={`ral-swatch${value === swatch.code && !mixed ? ' is-selected' : ''}`}
          aria-selected={value === swatch.code && !mixed}
          title={ralLabel(swatch.code)}
          style={{ background: swatch.hex }}
          onClick={() => onChange?.(swatch.code)}
        >
          <span className="sr-only">{ralLabel(swatch.code)}</span>
        </button>)}
    </div>
    <input type="hidden" id={id} name={name} value={value ?? ''} readOnly />
  </div>;
}
