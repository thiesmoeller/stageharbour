import { inlineGroup, partRefKey, type PartContext, type PartDefinition } from './definition.js';

/** Includes inline groups and exact library revisions. Historical revisions keep their assets alive. */
export function meshAssetDependencies(definition: PartDefinition, context?: Pick<PartContext, 'part'>): string[] {
  const seen = new Set<string>(), assets = new Set<string>();
  function visit(part: PartDefinition) {
    const key = partRefKey(part);
    if (seen.has(key)) return;
    seen.add(key);
    for (const body of part.bodies) if (body.kind === 'mesh') assets.add(body.assetId);
    for (const child of part.children ?? []) {
      const nested = inlineGroup(child) ?? (child.part ? context?.part(child.part) : undefined);
      if (nested) visit(nested);
    }
  }
  visit(definition);
  return [...assets];
}
