/** Session UI toggles for 2D plan readability. Not persisted on the venue document. */
export type PlanDisplayOptions = {
  showUnderlay: boolean;
  showObjectNames: boolean;
  showDimensions: boolean;
  showTexts: boolean;
};

export const defaultPlanDisplay: PlanDisplayOptions = {
  showUnderlay: true,
  showObjectNames: true,
  showDimensions: true,
  showTexts: true,
};
