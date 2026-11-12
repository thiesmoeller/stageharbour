import { useState } from 'react';
import { assetDefinitionSchema, type AssetDefinition } from '../../shared/assets.js';
import { catalogModelUrl, catalogThumbnailUrl, searchCatalogModels } from '../stage/modelCatalog.js';

export default function ModelCatalog({ disabled, onAdd }: { disabled: boolean; onAdd: (name: string, definition: AssetDefinition) => Promise<void> }) {
  const [search, setSearch] = useState('');
  const items = searchCatalogModels(search);
  return <>
    <p className="muted">Fertige 3D-Modelle für Möbel und Ausstattung. Vorschaubilder und Modelle stammen aus dem öffentlichen Katalog von Pascal, werden von dessen Servern geladen und benötigen eine Internetverbindung.</p>
    <label htmlFor="catalog-search">Modellkatalog durchsuchen</label><input id="catalog-search" value={search} onChange={event => setSearch(event.target.value)} />
    <div className="asset-grid">{items.map(item => {
      const [width, height, depth] = item.dimensions;
      const parsed = assetDefinitionSchema.safeParse({ kind: 'model', width: width * 1000, height: height * 1000, depth: depth * 1000,
        source: { kind: 'catalog', catalogId: item.id, url: catalogModelUrl(item), offset: item.offset, rotation: item.rotation, scale: item.scale } });
      if (!parsed.success) return null;
      const thumbnail = catalogThumbnailUrl(item);
      return <article className="asset-card" key={item.id}>
        {thumbnail && <img src={thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />}
        <strong>{item.name}</strong><button type="button" disabled={disabled} onClick={() => void onAdd(item.name, parsed.data)}>In Objektvorlagen übernehmen</button>
      </article>;
    })}</div>
    {!items.length && <p>Keine passenden Modelle.</p>}
  </>;
}
