import { MATERIAL_CATALOG, toLibraryMaterialRef } from '@pascal-app/core';

export default function MaterialPicker({ value }: { value?: string }) {
  return <><label htmlFor="wall-finish">Oberfläche · Pascal-Materialbibliothek</label>
    <select id="wall-finish" name="finish" defaultValue={value ?? ''}>
      <option value="">Sperrholz (Standard)</option>
      {MATERIAL_CATALOG.map(item => <option key={item.id} value={toLibraryMaterialRef(item.id)}>{item.label} · {item.category}</option>)}
    </select></>;
}
