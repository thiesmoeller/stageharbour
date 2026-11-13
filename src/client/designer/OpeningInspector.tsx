import { openingParameterKeys } from '../../shared/parts/openingParams.js';
import type { PartDefinition, SheetHole } from '../../shared/parts/definition.js';
import { NumberInput } from './FormulaField.js';
import { writeOpening } from './faceSketchView.js';

const FIELD_LABELS = {
  left: 'Links',
  sill: 'Brüstung',
  width: 'Breite',
  height: 'Höhe',
} as const;

function holeOf(definition: PartDefinition, bodyKey: string, holeKey: string): SheetHole | undefined {
  const body = definition.bodies.find(candidate => candidate.key === bodyKey);
  return body?.kind === 'sheet' ? body.holes?.find(hole => hole.key === holeKey) : undefined;
}

/**
 * Compact measures for the opening selected on the face sketcher. Keys and formulas stay under
 * Erweitert; this is the non-CAD path after drawing.
 */
export function OpeningInspector({ definition, bodyKey, holeKey, activeVariant, disabled, onChange }: {
  definition: PartDefinition;
  bodyKey: string;
  holeKey: string;
  activeVariant?: string;
  disabled: boolean;
  onChange: (definition: PartDefinition) => void;
}) {
  const hole = holeOf(definition, bodyKey, holeKey);
  if (!hole) {
    return <div className="opening-inspector" data-testid="designer-opening-inspector">
      <p className="muted">Öffnung auf der Fläche wählen.</p>
    </div>;
  }

  if (hole.shape === 'polygon') {
    return <div className="opening-inspector" data-testid="designer-opening-inspector" data-shape="polygon" data-opening={holeKey}>
      <p className="muted">Polygon „{holeKey}“ — Ecken auf der Fläche ziehen. Einzelmaße gibt es hier nicht.</p>
    </div>;
  }

  const keys = openingParameterKeys(holeKey);
  const values = {
    left: definition.parameters.find(parameter => parameter.key === keys.left)?.default ?? 0,
    sill: definition.parameters.find(parameter => parameter.key === keys.sill)?.default ?? 0,
    width: definition.parameters.find(parameter => parameter.key === keys.width)?.default ?? 1,
    height: definition.parameters.find(parameter => parameter.key === keys.height)?.default ?? 1,
  };

  function setField(field: keyof typeof values, value: number) {
    const next = { ...values, [field]: value };
    onChange(writeOpening(definition, bodyKey, holeKey, {
      shape: hole!.shape as 'rect' | 'arch',
      box: { x: next.left, y: next.sill, width: next.width, height: next.height },
    }, activeVariant));
  }

  return <div className="opening-inspector" data-testid="designer-opening-inspector" data-shape={hole.shape} data-opening={holeKey}>
    <p className="opening-inspector-title">
      {hole.shape === 'arch' ? 'Bogen' : 'Rechteck'} „{holeKey}“
    </p>
    <div className="designer-grid-2 opening-measures">
      {(['left', 'sill', 'width', 'height'] as const).map(field => (
        <label key={field} className="designer-field">
          {FIELD_LABELS[field]}
          <NumberInput
            label={`${FIELD_LABELS[field]} von ${holeKey}`}
            value={values[field]}
            disabled={disabled}
            testId={`parameter-default-${keys[field]}`}
            onChange={next => setField(field, next)}
          />
        </label>
      ))}
    </div>
    <p className="muted">Millimeter. Ziehen auf der Fläche geht weiter.</p>
  </div>;
}
