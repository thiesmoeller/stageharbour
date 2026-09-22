import { MIXED_PROPERTY } from '../../shared/editing.js';
import { MATERIAL_CATALOG, toLibraryMaterialRef } from '@pascal-app/core';

/** CAD multi-edit picker: shared value, empty, or “—” when selection disagrees (Figma/Blender). */
export default function MaterialPicker({ value, id = 'surface-finish', onChange, mixed = false }: {
  value?: string; id?: string; onChange?: (value: string) => void; mixed?: boolean;
}) {
  const selectValue = mixed ? MIXED_PROPERTY : (value ?? '');
  return <>
    <label htmlFor={id}>Oberfläche · Pascal-Materialbibliothek</label>
    <select
      id={id}
      name="finish"
      aria-label={mixed ? 'Oberfläche (gemischt)' : 'Oberfläche'}
      {...(onChange
        ? {
          value: selectValue,
          onChange: event => {
            const next = event.target.value;
            if (next === MIXED_PROPERTY) return;
            onChange(next);
          },
        }
        : { defaultValue: value ?? '' })}
    >
      {mixed && <option value={MIXED_PROPERTY}>— gemischt —</option>}
      <option value="">Sperrholz (Standard)</option>
      {MATERIAL_CATALOG.map(item =>
        <option key={item.id} value={toLibraryMaterialRef(item.id)}>{item.label} · {item.category}</option>)}
    </select>
  </>;
}
