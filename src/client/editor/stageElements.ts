import type { OverheadBox } from '../../shared/overhead.js';
import type { KeepClearZone } from '../../shared/keepClear.js';
import type { CableRoutingCorridor, CableRun, ConnectionPoint } from '../../shared/infrastructure.js';
import type { Truss } from '../../shared/truss.js';
import type { Curtain } from '../../shared/curtains.js';
import type { Brace, Layout, VenueGeometry, Wall } from '../../shared/layout.js';
import type { Placeholder } from '../../shared/placeholders.js';
import type { Platform, StairUnit } from '../../shared/levels.js';
import { effectiveCurtains, effectiveVenueDoorOpen } from '../../shared/venueFixtures.js';

export type StageElementContent =
  | { kind: 'wall'; value: Wall }
  | { kind: 'brace'; value: Brace }
  | { kind: 'placeholder'; value: Placeholder }
  | { kind: 'platform'; value: Platform }
  | { kind: 'stair'; value: StairUnit }
  | { kind: 'overhead'; value: OverheadBox }
  | { kind: 'truss'; value: Truss }
  | { kind: 'curtain'; value: Curtain }
  | { kind: 'zone'; value: KeepClearZone }
  | { kind: 'pin'; value: ConnectionPoint }
  | { kind: 'corridor'; value: CableRoutingCorridor }
  | { kind: 'cableRun'; value: CableRun };

/** One thing the Raumsicht draws: a permanent part of the Spielstätte or an element of the Bühnenbild. */
export type StageElement = {
  id: string;
  /** `venue` elements are only editable in the Spielstätte editor. */
  scope: 'venue' | 'scene';
  element: StageElementContent;
};

/**
 * Everything the Raumsicht draws, permanent venue elements first. A projection of the saved
 * documents: physical sizes and ids are passed through untouched. Venue doors and curtains show
 * the state the Bühnenbild sets for them.
 */
export function stageElements(layout: Layout, venue?: VenueGeometry): StageElement[] {
  const permanent: StageElementContent[] = venue ? [
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
  const scene: StageElementContent[] = [
    ...layout.walls.map(value => ({ kind: 'wall' as const, value })),
    ...layout.braces.map(value => ({ kind: 'brace' as const, value })),
    ...(layout.placeholders ?? []).map(value => ({ kind: 'placeholder' as const, value })),
    ...(layout.platforms ?? []).map(value => ({ kind: 'platform' as const, value })),
    ...(layout.stairs ?? []).map(value => ({ kind: 'stair' as const, value })),
    ...(layout.cableRuns ?? []).map(value => ({ kind: 'cableRun' as const, value })),
  ];
  const permanentIds = new Set(permanent.map(item => item.value.id));
  // An id present in both documents is drawn once, as the Bühnenbild's element with venue scope.
  const byId = new Map<string, StageElement>();
  for (const element of [...permanent, ...scene]) {
    byId.set(element.value.id, { id: element.value.id, scope: permanentIds.has(element.value.id) ? 'venue' : 'scene', element });
  }
  return [...byId.values()];
}
