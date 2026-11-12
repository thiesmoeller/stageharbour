import { useEffect, useMemo, useState } from 'react';
import type { Layout } from '../../shared/layout.js';
import { createLayoutPartIndex, type LayoutPartIndex } from '../../shared/layoutObjects.js';
import type { PartDefinition, PartMaterial, PartRef } from '../../shared/parts/definition.js';
import type { PartSummary } from '../../shared/parts/catalog.js';
import { listMaterials, listParts, resolveParts } from '../partsApi.js';

type State = {
  summaries: PartSummary[];
  definitions: PartDefinition[];
  materials: PartMaterial[];
  loading: boolean;
  error?: string;
};

const refKey = (ref: PartRef) => `${ref.id}@${ref.revision}`;

/** Loads exact revisions used by a layout together with every latest insertable catalog part. */
export function useLayoutParts(workspaceId: string, layout: Layout): State & { index: LayoutPartIndex } {
  const refsKey = [...new Set(layout.objects.map(object => refKey(object.part)))].sort().join('|');
  const [state, setState] = useState<State>({ summaries: [], definitions: [], materials: [], loading: true });
  useEffect(() => {
    let active = true;
    setState(current => ({ ...current, loading: true, error: undefined }));
    void (async () => {
      try {
        const [summaries, materials] = await Promise.all([
          listParts(workspaceId, { includeArchived: true }),
          listMaterials(workspaceId),
        ]);
        const refs = new Map<string, PartRef>();
        for (const object of layout.objects) refs.set(refKey(object.part), object.part);
        for (const part of summaries) {
          const ref = { id: part.id, revision: part.latestRevision };
          refs.set(refKey(ref), ref);
        }
        const resolved = refs.size
          ? await resolveParts(workspaceId, [...refs.values()])
          : { definitions: [], missing: [] };
        if (active) setState({
          summaries,
          materials,
          definitions: resolved.definitions,
          loading: false,
          ...(resolved.missing.length ? { error: `${resolved.missing.length} Bauteilrevisionen fehlen.` } : {}),
        });
      } catch (error) {
        if (active) setState(current => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : 'Bauteilkatalog konnte nicht geladen werden.',
        }));
      }
    })();
    return () => { active = false; };
  }, [workspaceId, refsKey]);
  const index = useMemo(
    () => createLayoutPartIndex({ parts: state.definitions, materials: state.materials }),
    [state.definitions, state.materials],
  );
  return { ...state, index };
}
