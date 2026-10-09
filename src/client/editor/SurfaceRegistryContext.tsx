import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { surfaceListSchema, type SurfaceRecord } from '../../shared/surfaceRegistry.js';
import { request } from '../api.js';

export type SurfaceRegistryValue = {
  workspaceId: string;
  productionId?: string;
  surfaces: SurfaceRecord[];
  loading: boolean;
  reload: () => void;
};

const SurfaceRegistryContext = createContext<SurfaceRegistryValue>({
  workspaceId: '',
  surfaces: [],
  loading: false,
  reload: () => {},
});

export function SurfaceRegistryProvider({ workspaceId, productionId, children }: {
  workspaceId: string; productionId?: string; children: ReactNode;
}) {
  const [surfaces, setSurfaces] = useState<SurfaceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const query = productionId ? `?productionId=${encodeURIComponent(productionId)}` : '';
    request(`/api/workspaces/${workspaceId}/surfaces${query}`)
      .then(data => { if (active) setSurfaces(surfaceListSchema.parse(data)); })
      .catch(() => { if (active) setSurfaces([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId, productionId, revision]);
  const value = useMemo<SurfaceRegistryValue>(() => ({
    workspaceId, productionId, surfaces, loading, reload: () => setRevision(value => value + 1),
  }), [workspaceId, productionId, surfaces, loading]);
  return <SurfaceRegistryContext value={value}>{children}</SurfaceRegistryContext>;
}

export function useSurfaceRegistry() {
  return useContext(SurfaceRegistryContext);
}

export function surfaceTextureUrl(workspaceId: string, fileId: string) {
  return `/api/workspaces/${workspaceId}/surfaces/files/${fileId}`;
}
