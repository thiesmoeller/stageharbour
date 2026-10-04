/** Session UI toggles for 2D/3D readability. Not persisted on the venue document. */
export type PlanDisplayOptions = {
  showUnderlay: boolean;
  showObjectNames: boolean;
  showDimensions: boolean;
  showTexts: boolean;
  /** Traversen and hang-point markers (plan + Raumsicht). */
  showTrusses: boolean;
  /** Scheinwerfer markers and fixture-driven look preview beams. */
  showLightingFixtures: boolean;
};

export const defaultPlanDisplay: PlanDisplayOptions = {
  showUnderlay: true,
  showObjectNames: true,
  showDimensions: true,
  showTexts: true,
  showTrusses: true,
  showLightingFixtures: true,
};
