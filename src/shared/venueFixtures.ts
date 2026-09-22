import type { Curtain } from './curtains.js';
import type { Layout, VenueFixtureState, VenueGeometry, Wall } from './layout.js';
import { isDoorOpening, resolveWall } from './wall-types.js';

export function venueDooredWalls(venue: Pick<VenueGeometry, 'walls' | 'wallTypes'>): Wall[] {
  return (venue.walls ?? []).filter(wall => resolveWall(wall, venue.wallTypes ?? []).openings.some(isDoorOpening));
}

export function effectiveCurtains(
  venue: Pick<VenueGeometry, 'curtains'>,
  layout: Pick<Layout, 'venueFixtureState'>,
): Curtain[] {
  const overrides = new Map((layout.venueFixtureState?.curtains ?? []).map(item => [item.id, item.openPercent]));
  return (venue.curtains ?? []).map(curtain => {
    const open = overrides.get(curtain.id);
    return open === undefined ? curtain : { ...curtain, openPercent: open };
  });
}

export function effectiveVenueDoorOpen(
  wall: Pick<Wall, 'id' | 'doorOpenPercent'>,
  layout: Pick<Layout, 'venueFixtureState'>,
): number {
  const override = layout.venueFixtureState?.doors?.find(item => item.wallId === wall.id);
  return override?.doorOpenPercent ?? wall.doorOpenPercent ?? 0;
}

export function withVenueFixtureOpenings(venue: VenueGeometry, layout: Pick<Layout, 'venueFixtureState'>): VenueGeometry {
  return {
    ...venue,
    curtains: effectiveCurtains(venue, layout),
    walls: venue.walls?.map(wall => ({ ...wall, doorOpenPercent: effectiveVenueDoorOpen(wall, layout) })),
  };
}

/** Drop opening overlays whose venue fixtures no longer exist (or no longer have a door). */
export function pruneVenueFixtureState(
  layout: Layout,
  venue: Pick<VenueGeometry, 'curtains' | 'walls' | 'wallTypes'>,
): Layout {
  const state = layout.venueFixtureState;
  if (!state) return layout;
  const curtainIds = new Set((venue.curtains ?? []).map(item => item.id));
  const doorWallIds = new Set(venueDooredWalls(venue).map(wall => wall.id));
  const curtains = state.curtains?.filter(item => curtainIds.has(item.id));
  const doors = state.doors?.filter(item => doorWallIds.has(item.wallId));
  const next: VenueFixtureState = {
    ...(curtains?.length ? { curtains } : {}),
    ...(doors?.length ? { doors } : {}),
  };
  if (!next.curtains && !next.doors) {
    const { venueFixtureState: _removed, ...rest } = layout;
    return rest;
  }
  return { ...layout, venueFixtureState: next };
}

export function setCurtainOpenPercent(layout: Layout, curtainId: string, openPercent: number): Layout {
  const others = (layout.venueFixtureState?.curtains ?? []).filter(item => item.id !== curtainId);
  return {
    ...layout,
    venueFixtureState: {
      ...layout.venueFixtureState,
      curtains: [...others, { id: curtainId, openPercent }],
      doors: layout.venueFixtureState?.doors,
    },
  };
}

export function setVenueDoorOpenPercent(layout: Layout, wallId: string, doorOpenPercent: number): Layout {
  const others = (layout.venueFixtureState?.doors ?? []).filter(item => item.wallId !== wallId);
  return {
    ...layout,
    venueFixtureState: {
      ...layout.venueFixtureState,
      doors: [...others, { wallId, doorOpenPercent }],
      curtains: layout.venueFixtureState?.curtains,
    },
  };
}
