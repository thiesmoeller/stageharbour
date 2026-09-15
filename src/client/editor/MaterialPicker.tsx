import { MATERIAL_CATALOG, toLibraryMaterialRef } from '@pascal-app/core';

export default function MaterialPicker({ value, id = 'surface-finish', onChange }: {
  value?: string; id?: string; onChange?: (value: string) => void;
}) {
  return <><label htmlFor={id}>Oberfläche · Pascal-Materialbibliothek</label>
    <select id={id} name="finish" {...(onChange
      ? { value: value ?? '', onChange: event => onChange(event.target.value) }
      : { defaultValue: value ?? '' })}>
      <option value="">Sperrholz (Standard)</option>
      {MATERIAL_CATALOG.map(item => <option key={item.id} value={toLibraryMaterialRef(item.id)}>{item.label} · {item.category}</option>)}
    </select></>;
}
