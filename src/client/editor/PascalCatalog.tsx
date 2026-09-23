import { useState } from 'react';
import { CATALOG_ITEMS } from '@pascal-app/editor/catalog';
import { assetDefinitionSchema, type AssetDefinition } from '../../shared/assets.js';

export default function PascalCatalog({ disabled, onAdd }: { disabled: boolean; onAdd: (name: string, definition: AssetDefinition) => Promise<void> }) {
  const [search, setSearch] = useState('');
  const items = CATALOG_ITEMS.filter(item => !item.tool && item.src && `${item.name} ${item.tags?.join(' ')}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <p className="muted">Modelle aus Pascals öffentlichem Katalog. Vorschaubilder und Modelle werden vom Kataloganbieter geladen und benötigen eine Internetverbindung.</p>
    <label htmlFor="catalog-search">Pascal-Katalog durchsuchen</label><input id="catalog-search" value={search} onChange={event => setSearch(event.target.value)} />
    <div className="asset-grid">{items.map(item => {
      const dimensions = item.dimensions;
      const parsed = assetDefinitionSchema.safeParse({ kind: 'model', width: (dimensions?.[0] ?? 1) * 1000, height: (dimensions?.[1] ?? 1) * 1000, depth: (dimensions?.[2] ?? 1) * 1000,
        source: { kind: 'catalog', catalogId: item.id, url: item.src, offset: item.offset ?? [0, 0, 0], rotation: item.rotation ?? [0, 0, 0], scale: item.scale ?? [1, 1, 1] } });
      if (!parsed.success) return null;
      return <article className="asset-card" key={item.id}>
        {item.thumbnail && <img src={item.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />}
        <strong>{item.name}</strong><button type="button" disabled={disabled} onClick={() => void onAdd(item.name, parsed.data)}>In Objektvorlagen übernehmen</button>
      </article>;
    })}</div>
    {!items.length && <p>Keine passenden Modelle.</p>}
  </>;
}
