import type { CreateStockItemRequest, StockItem, UpdateStockItemRequest } from './catalog.js';
import {
  MATERIAL_KIND_LABELS, normalizeParameterValue, type PartDefinition, type PartMaterial, type StockMode,
} from './definition.js';

/** Rules for what stock items and stock counts may point at, shared by the server and the local transport. */

export const STOCK_MODE_LABELS: Record<StockMode, string> = {
  item: 'einzelne Bestandsstücke', count: 'Zählbestand', none: 'kein Bestand',
};

/** Sentinel the tables use for "no variant"; the API speaks null. */
export const NO_VARIANT = '';
export const variantColumn = (variantKey: string | null | undefined): string => variantKey ?? NO_VARIANT;
export const variantFromColumn = (value: string): string | null => value === NO_VARIANT ? null : value;

export type StockPart = { definition: PartDefinition; archived: boolean };

export function variantLabelOf(definition: PartDefinition, variantKey: string | null): string | null {
  if (variantKey === null) return null;
  return (definition.variants ?? []).find(variant => variant.key === variantKey)?.label ?? null;
}

/** A part with variants needs one of them; a part without takes none. */
export function variantIssue(definition: PartDefinition, variantKey: string | null): string | undefined {
  const variants = definition.variants ?? [];
  if (!variants.length) {
    return variantKey === null ? undefined : `„${definition.name}“ hat keine Varianten.`;
  }
  if (variantKey === null) return `„${definition.name}“ hat Varianten; bitte eine Variante wählen.`;
  return variants.some(variant => variant.key === variantKey) ? undefined : `„${definition.name}“ hat keine Variante „${variantKey}“.`;
}

function modeIssue(definition: PartDefinition, wanted: Exclude<StockMode, 'none'>): string | undefined {
  const mode = definition.traits.stock;
  if (mode === wanted) return undefined;
  return `„${definition.name}“ wird als ${STOCK_MODE_LABELS[mode]} geführt, hier ist ${STOCK_MODE_LABELS[wanted]} gefragt.`;
}

/**
 * Own values of a stock item are those of placement-scope parameters, inside the parameter's
 * domain. Variant values come from the variant and state values from the Bühnenbild.
 */
export function valuesIssue(definition: PartDefinition, values: Readonly<Record<string, number>> | undefined): string | undefined {
  for (const [key, value] of Object.entries(values ?? {})) {
    const parameter = definition.parameters.find(item => item.key === key);
    if (!parameter) return `„${definition.name}“ hat keinen Parameter „${key}“.`;
    if (parameter.scope !== 'placement') return `Der Parameter „${key}“ wird nicht von der Platzierung bestimmt und kann nicht am Bestandsstück stehen.`;
    if (Math.abs(normalizeParameterValue(parameter, value) - value) > 1e-9) {
      return `Der Wert für „${key}“ liegt nicht im Bereich oder in der Werteliste.`;
    }
  }
  return undefined;
}

export function stockItemTargetIssue(args: {
  part: StockPart | undefined; variantKey: string | null; values?: Readonly<Record<string, number>> | undefined; allowArchived?: boolean;
}): string | undefined {
  const { part } = args;
  if (!part) return 'Das Bauteil ist nicht vorhanden.';
  if (part.archived && !args.allowArchived) return `„${part.definition.name}“ ist archiviert.`;
  return modeIssue(part.definition, 'item') ?? variantIssue(part.definition, args.variantKey) ?? valuesIssue(part.definition, args.values);
}

export function stockCountPartIssue(part: StockPart | undefined, variantKey: string | null): string | undefined {
  if (!part) return 'Das Bauteil ist nicht vorhanden.';
  if (part.archived) return `„${part.definition.name}“ ist archiviert.`;
  return modeIssue(part.definition, 'count') ?? variantIssue(part.definition, variantKey);
}

export function stockCountMaterialIssue(material: PartMaterial | undefined): string | undefined {
  if (!material) return 'Das Material ist nicht vorhanden.';
  if (material.kind !== 'hardware') {
    return `„${material.name}“ ist ${MATERIAL_KIND_LABELS[material.kind]}; gezählt wird nur Zubehör.`;
  }
  return undefined;
}

export type StockItemFields = Pick<StockItem, 'label' | 'variantKey' | 'values' | 'usable' | 'notes' | 'cutouts' | 'finish'>;

const confirmed = (finish: NonNullable<CreateStockItemRequest['finish']>, now: Date) =>
  ({ surfaces: finish.surfaces, description: finish.description, confirmedAt: now.toISOString() });

export function newStockItemFields(request: CreateStockItemRequest, now: Date): StockItemFields {
  return {
    label: request.label,
    variantKey: request.variantKey ?? null,
    values: request.values ?? {},
    usable: request.usable ?? true,
    notes: request.notes ?? null,
    cutouts: request.cutouts ?? [],
    finish: request.finish ? confirmed(request.finish, now) : null,
  };
}

/** A new finish is stamped as confirmed now, like a finish recorded on a physical panel. */
export function updatedStockItemFields(current: StockItemFields, request: UpdateStockItemRequest, now: Date): StockItemFields {
  return {
    label: request.label ?? current.label,
    variantKey: request.variantKey === undefined ? current.variantKey : request.variantKey,
    values: request.values ?? current.values,
    usable: request.usable ?? current.usable,
    notes: request.notes === undefined ? current.notes : request.notes,
    cutouts: request.cutouts ?? current.cutouts,
    finish: request.finish === undefined ? current.finish : request.finish ? confirmed(request.finish, now) : null,
  };
}
