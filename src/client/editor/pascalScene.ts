import { overheadBoxSchema } from '../../shared/overhead.js';
import { keepClearZoneSchema } from '../../shared/keepClear.js';
import { connectionPointSchema, cableRoutingCorridorSchema, cableRunFieldsSchema } from '../../shared/infrastructure.js';
import { trussSchema } from '../../shared/truss.js';
import { curtainSchema } from '../../shared/curtains.js';
import { z } from 'zod';
import { braceSchema, wallSchema, type Layout, type VenueGeometry } from '../../shared/layout.js';
import { placeholderSchema } from '../../shared/placeholders.js';
import { platformSchema, stairSchema } from '../../shared/levels.js';
import { effectiveCurtains, effectiveVenueDoorOpen } from '../../shared/venueFixtures.js';

export const stageNodeSchema = z.object({
  object: z.literal('node'), id: z.string(), type: z.literal('stage-object'),
  scope: z.enum(['venue', 'scene']).default('scene'),
  parentId: z.null(), visible: z.boolean(), name: z.string(),
  element: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('wall'), value: wallSchema }),
    z.object({ kind: z.literal('brace'), value: braceSchema }),
    z.object({ kind: z.literal('placeholder'), value: placeholderSchema }),
    z.object({ kind: z.literal('platform'), value: platformSchema }),
    z.object({ kind: z.literal('stair'), value: stairSchema }),
    z.object({ kind: z.literal('overhead'), value: overheadBoxSchema }),
    z.object({ kind: z.literal('truss'), value: trussSchema }),
    z.object({ kind: z.literal('curtain'), value: curtainSchema }),
    z.object({ kind: z.literal('zone'), value: keepClearZoneSchema }),
    z.object({ kind: z.literal('pin'), value: connectionPointSchema }),
    z.object({ kind: z.literal('corridor'), value: cableRoutingCorridorSchema }),
    z.object({ kind: z.literal('cableRun'), value: cableRunFieldsSchema }),
  ]),
});
export type StageNode = z.infer<typeof stageNodeSchema>;
export const stageNodeId = (id: string) => `stage-object_${id}`;

// Pascal nodes are a projection of the saved theatre layout. Its architectural
// wall/junction rules must never change the size of a physical scenery panel.
export function pascalScene(layout: Layout, venue?: VenueGeometry) {
  const elements: StageNode['element'][] = [
    ...layout.walls.map(value => ({ kind: 'wall' as const, value })),
    ...layout.braces.map(value => ({ kind: 'brace' as const, value })),
    ...(layout.placeholders ?? []).map(value => ({ kind: 'placeholder' as const, value })),
    ...(layout.platforms ?? []).map(value => ({ kind: 'platform' as const, value })),
    ...(layout.stairs ?? []).map(value => ({ kind: 'stair' as const, value })),
    ...(layout.cableRuns ?? []).map(value => ({ kind: 'cableRun' as const, value })),
  ];
  const permanent: StageNode['element'][] = venue ? [
    ...(venue.walls ?? []).map(value => ({
      kind: 'wall' as const,
      value: { ...value, doorOpenPercent: effectiveVenueDoorOpen(value, layout) },
    })),
    ...(venue.platforms ?? []).map(value => ({ kind: 'platform' as const, value })),
    ...(venue.stairs ?? []).map(value => ({ kind: 'stair' as const, value })),
    ...(venue.placeholders ?? []).map(value => ({ kind: 'placeholder' as const, value })),
    ...(venue.overheadBoxes ?? []).map(value => ({ kind: 'overhead' as const, value })),
    ...(venue.trusses ?? []).map(value => ({ kind: 'truss' as const, value })),
    ...effectiveCurtains(venue, layout).map(value => ({ kind: 'curtain' as const, value })),
    ...(venue.keepClearZones ?? []).map(value => ({ kind: 'zone' as const, value })),
    ...(venue.connectionPoints ?? []).map(value => ({ kind: 'pin' as const, value })),
    ...(venue.cableRoutingCorridors ?? []).map(value => ({ kind: 'corridor' as const, value })),
  ] : [];
  const permanentIds = new Set(permanent.map(item => item.value.id));
  const nodes = [...permanent, ...elements].map(element => stageNodeSchema.parse({
    scope: permanentIds.has(element.value.id) ? 'venue' : 'scene',
    object: 'node', type: 'stage-object', id: stageNodeId(element.value.id),
    name: element.value.label, parentId: null, visible: true, element,
  }));
  return { nodes: Object.fromEntries(nodes.map(node => [node.id, node])), rootNodeIds: nodes.map(node => node.id) };
}
