import type { PlanDisplayOptions } from '../../shared/planDisplay.js';
import { defaultPlanDisplay } from '../../shared/planDisplay.js';

export function PlanDisplayToggles({ value, onChange, includeUnderlay = false }: {
  value: PlanDisplayOptions;
  onChange: (next: PlanDisplayOptions) => void;
  includeUnderlay?: boolean;
}) {
  function toggle(key: keyof PlanDisplayOptions) {
    onChange({ ...value, [key]: !value[key] });
  }
  return <div className="plan-display-toggles" role="group" aria-label="Grundriss-Anzeige">
    {includeUnderlay && <label className="plan-display-toggle">
      <input type="checkbox" checked={value.showUnderlay} onChange={() => toggle('showUnderlay')} />
      Planunterlage
    </label>}
    <label className="plan-display-toggle">
      <input type="checkbox" checked={value.showObjectNames} onChange={() => toggle('showObjectNames')} />
      Namen
    </label>
    <label className="plan-display-toggle">
      <input type="checkbox" checked={value.showDimensions} onChange={() => toggle('showDimensions')} />
      Maße
    </label>
    <label className="plan-display-toggle">
      <input type="checkbox" checked={value.showTexts} onChange={() => toggle('showTexts')} />
      Texte
    </label>
    <label className="plan-display-toggle">
      <input type="checkbox" checked={value.showTrusses} onChange={() => toggle('showTrusses')} />
      Traversen
    </label>
    <label className="plan-display-toggle">
      <input type="checkbox" checked={value.showLightingFixtures} onChange={() => toggle('showLightingFixtures')} />
      Scheinwerfer
    </label>
  </div>;
}

export { defaultPlanDisplay };
