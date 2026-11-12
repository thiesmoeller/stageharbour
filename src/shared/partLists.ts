import { z } from 'zod';
import type { ResolvedLayoutObject } from './layoutObjects.js';
import type { PartDefinition, PartMaterial, PartRef, StockMode } from './parts/definition.js';
import { STOCK_MODES } from './parts/definition.js';

/**
 * Parts list, cut list, weight and stock demand of resolved Bühnenbild objects. One Bühnenbild
 * yields one `BuildLists`; a venue visit or a package combines the lists of its Bühnenbilder by
 * taking the largest quantity of every row, because the Bühnenbilder are played one after
 * another with the same pieces.
 */

export type ListContext = {
  material(key: string): PartMaterial | undefined;
  part(ref: PartRef): PartDefinition | undefined;
};

export type InventoryItem = {
  id: string; label: string; partId: string; variantKey: string | null;
  values?: Readonly<Record<string, number>>; usable: boolean; archived: boolean;
};
export type InventoryCount = { materialKey: string | null; partId: string | null; variantKey: string | null; quantity: number };

export const inventoryItemSchema = z.strictObject({
  id: z.string(), label: z.string(), partId: z.string(), variantKey: z.string().nullable(),
  values: z.record(z.string(), z.number()).optional(), usable: z.boolean(), archived: z.boolean(),
});
export const inventoryCountSchema = z.strictObject({
  materialKey: z.string().nullable(), partId: z.string().nullable(), variantKey: z.string().nullable(), quantity: z.number(),
});
/** Physical pieces and counted stock the demand is compared with. */
export const stockInventorySchema = z.strictObject({
  items: z.array(inventoryItemSchema),
  counts: z.array(inventoryCountSchema),
});
export type StockInventory = z.infer<typeof stockInventorySchema>;

/** The inventory shape of the stock API lists. */
export function inventoryOf(
  items: readonly { id: string; label: string; partId: string; variantKey: string | null; values: Record<string, number>; usable: boolean; archived: boolean }[],
  counts: readonly InventoryCount[],
): StockInventory {
  return {
    items: items.map(item => ({
      id: item.id, label: item.label, partId: item.partId, variantKey: item.variantKey,
      ...(Object.keys(item.values).length ? { values: { ...item.values } } : {}), usable: item.usable, archived: item.archived,
    })),
    counts: counts.map(count => ({ materialKey: count.materialKey, partId: count.partId, variantKey: count.variantKey, quantity: count.quantity })),
  };
}

const sceneRefSchema = z.strictObject({ id: z.string(), name: z.string() });
export type SceneRef = z.infer<typeof sceneRefSchema>;

export const objectListRowSchema = z.strictObject({
  objectId: z.string(),
  label: z.string(),
  assemblyNumber: z.number().nullable(),
  partId: z.string(),
  partName: z.string(),
  variantLabel: z.string().nullable(),
  widthMm: z.number(), depthMm: z.number(), heightMm: z.number(),
  weightKg: z.number(),
  stock: z.enum(STOCK_MODES),
  stockItemLabel: z.string().nullable(),
});
export type ObjectListRow = z.infer<typeof objectListRowSchema>;

export const partsListRowSchema = z.strictObject({
  key: z.string(),
  partId: z.string(),
  name: z.string(),
  variantKey: z.string().nullable(),
  variantLabel: z.string().nullable(),
  stock: z.enum(STOCK_MODES),
  /** Placed in the Bühnenbild. */
  placed: z.number(),
  /** Built into other parts, such as the legs of a deck. */
  nested: z.number(),
  count: z.number(),
});
export type PartsListRow = z.infer<typeof partsListRowSchema>;

export const beamCutRowSchema = z.strictObject({
  key: z.string(), material: z.string(), materialName: z.string(),
  section: z.strictObject({ width: z.number(), height: z.number() }),
  lengthMm: z.number(), count: z.number(), totalLengthMm: z.number(), weightKg: z.number(),
});
export type BeamCutRow = z.infer<typeof beamCutRowSchema>;

export const sheetCutRowSchema = z.strictObject({
  key: z.string(), material: z.string(), materialName: z.string(),
  thicknessMm: z.number(), widthMm: z.number(), heightMm: z.number(),
  count: z.number(), areaMm2: z.number(), grossAreaMm2: z.number(), weightKg: z.number(),
});
export type SheetCutRow = z.infer<typeof sheetCutRowSchema>;

export const hardwareRowSchema = z.strictObject({
  key: z.string(), material: z.string(), materialName: z.string(), quantity: z.number(), weightKg: z.number(),
});
export type HardwareRow = z.infer<typeof hardwareRowSchema>;

export const stockDemandRowSchema = z.strictObject({
  key: z.string(),
  kind: z.enum(['item', 'count', 'hardware']),
  partId: z.string().nullable(),
  variantKey: z.string().nullable(),
  materialKey: z.string().nullable(),
  name: z.string(),
  variantLabel: z.string().nullable(),
  required: z.number(),
  /** Item stock: placed objects of the row with a stock item; null for counted stock. */
  assigned: z.number().nullable(),
  /** Usable pieces or counted quantity; null when the workspace does not count it. */
  available: z.number().nullable(),
  shortage: z.number(),
});
export type StockDemandRow = z.infer<typeof stockDemandRowSchema>;

export const STOCK_WARNING_KINDS = ['unassigned', 'missing', 'unusable', 'incompatible', 'duplicate', 'shortage'] as const;
export const stockWarningSchema = z.strictObject({
  kind: z.enum(STOCK_WARNING_KINDS),
  key: z.string(),
  scene: sceneRefSchema.nullable(),
  objectIds: z.array(z.string()),
  stockItemId: z.string().nullable(),
  message: z.string(),
});
export type StockWarning = z.infer<typeof stockWarningSchema>;

export const buildListsSchema = z.strictObject({
  scenes: z.array(sceneRefSchema),
  objects: z.array(objectListRowSchema),
  parts: z.array(partsListRowSchema),
  cutList: z.strictObject({ beams: z.array(beamCutRowSchema), sheets: z.array(sheetCutRowSchema) }),
  hardware: z.array(hardwareRowSchema),
  weightKg: z.number(),
  stock: z.strictObject({ rows: z.array(stockDemandRowSchema), warnings: z.array(stockWarningSchema) }),
});
export type BuildLists = z.infer<typeof buildListsSchema>;

const compare = (a: string, b: string) => a.localeCompare(b, 'de', { numeric: true });
const variantLabelFor = (definition: PartDefinition | undefined, key: string | null): string | null =>
  key === null ? null : definition?.variants?.find(variant => variant.key === key)?.label ?? key;
const materialName = (context: ListContext, key: string) => context.material(key)?.name ?? key;
const sameValues = (wanted: Readonly<Record<string, number>> | undefined, actual: Readonly<Record<string, number>>) =>
  Object.entries(wanted ?? {}).every(([key, value]) => Math.abs((actual[key] ?? Number.NaN) - value) < 1e-6);

const partKey = (partId: string, variantKey: string | null) => JSON.stringify([partId, variantKey]);

/** Variant a placed object is stocked as: the chosen one, else the one its values stand for. */
export function stockVariantOf(item: Pick<ResolvedLayoutObject, 'object' | 'resolved'>): string | null {
  return item.object.variant ?? item.resolved.variant ?? null;
}

/** Whether a physical piece can stand in for a placed object: same part, same variant, same own values. */
export function stockItemFits(
  stock: Pick<InventoryItem, 'partId' | 'variantKey' | 'values'>,
  item: Pick<ResolvedLayoutObject, 'object' | 'resolved'>,
): boolean {
  return stock.partId === item.object.part.id
    && stock.variantKey === stockVariantOf(item)
    && sameValues(stock.values, item.resolved.values);
}

/** Pieces that fit the object, usable ones first. Archived pieces are never offered. */
export function fittingStockItems<T extends Pick<InventoryItem, 'partId' | 'variantKey' | 'values' | 'archived' | 'usable' | 'label'>>(
  items: readonly T[], item: Pick<ResolvedLayoutObject, 'object' | 'resolved'>,
): T[] {
  return items.filter(stock => !stock.archived && stockItemFits(stock, item))
    .sort((a, b) => Number(b.usable) - Number(a.usable) || compare(a.label, b.label));
}

function objectRows(objects: readonly ResolvedLayoutObject[], items: ReadonlyMap<string, InventoryItem>,
  numbers: ReadonlyMap<string, number>): ObjectListRow[] {
  return objects.map(item => {
    const { size } = boundsSize(item);
    const variant = stockVariantOf(item);
    return {
      objectId: item.object.id,
      label: item.object.label,
      assemblyNumber: numbers.get(item.object.id) ?? item.object.assemblyNumber ?? null,
      partId: item.object.part.id,
      partName: item.resolved.name,
      variantLabel: variantLabelFor(item.definition, variant),
      widthMm: Math.round(size.x), depthMm: Math.round(size.z), heightMm: Math.round(item.resolved.height),
      weightKg: round(item.resolved.weightKg, 3),
      stock: item.resolved.stock,
      stockItemLabel: item.object.stockItemId ? items.get(item.object.stockItemId)?.label ?? null : null,
    };
  }).sort((a, b) => (a.assemblyNumber ?? Infinity) - (b.assemblyNumber ?? Infinity) || compare(a.label, b.label));
}

function boundsSize(item: ResolvedLayoutObject) {
  const { min, max } = item.resolved.bounds;
  return { size: { x: max.x - min.x, z: max.z - min.z } };
}

const round = (value: number, digits = 0) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

function partRows(objects: readonly ResolvedLayoutObject[], context: ListContext): PartsListRow[] {
  const rows = new Map<string, PartsListRow>();
  const add = (partId: string, ref: PartRef, name: string, variantKey: string | null, stock: StockMode, placed: number, nested: number) => {
    const key = partKey(partId, variantKey);
    const row = rows.get(key) ?? {
      key, partId, name, variantKey, variantLabel: variantLabelFor(context.part(ref), variantKey), stock, placed: 0, nested: 0, count: 0,
    };
    row.placed += placed;
    row.nested += nested;
    row.count = row.placed + row.nested;
    rows.set(key, row);
  };
  for (const item of objects) {
    add(item.object.part.id, item.object.part, item.resolved.name, stockVariantOf(item), item.resolved.stock, 1, 0);
    for (const child of item.resolved.partCounts) {
      add(child.part.id, child.part, child.name, child.variant ?? null, child.stock, 0, child.count);
    }
  }
  return [...rows.values()].sort((a, b) => compare(a.name, b.name) || compare(a.variantLabel ?? '', b.variantLabel ?? ''));
}

function cutRows(objects: readonly ResolvedLayoutObject[], context: ListContext) {
  const beams = new Map<string, BeamCutRow>();
  const sheets = new Map<string, SheetCutRow>();
  const hardware = new Map<string, HardwareRow>();
  for (const item of objects) {
    for (const beam of item.resolved.cutList.beams) {
      const key = JSON.stringify(['beam', beam.material, beam.section.width, beam.section.height, beam.lengthMm]);
      const row = beams.get(key) ?? {
        key, material: beam.material, materialName: materialName(context, beam.material), section: { ...beam.section },
        lengthMm: beam.lengthMm, count: 0, totalLengthMm: 0, weightKg: 0,
      };
      row.count += beam.count;
      row.totalLengthMm += beam.totalLengthMm;
      row.weightKg += beam.weightKg;
      beams.set(key, row);
    }
    for (const sheet of item.resolved.cutList.sheets) {
      const key = JSON.stringify(['sheet', sheet.material, sheet.thicknessMm, sheet.widthMm, sheet.heightMm]);
      const row = sheets.get(key) ?? {
        key, material: sheet.material, materialName: materialName(context, sheet.material), thicknessMm: sheet.thicknessMm,
        widthMm: sheet.widthMm, heightMm: sheet.heightMm, count: 0, areaMm2: 0, grossAreaMm2: 0, weightKg: 0,
      };
      row.count += sheet.count;
      row.areaMm2 += sheet.areaMm2;
      row.grossAreaMm2 += sheet.grossAreaMm2;
      row.weightKg += sheet.weightKg;
      sheets.set(key, row);
    }
    for (const total of item.resolved.hardware) {
      const key = JSON.stringify(['hardware', total.material]);
      const row = hardware.get(key) ?? { key, material: total.material, materialName: materialName(context, total.material), quantity: 0, weightKg: 0 };
      row.quantity += total.quantity;
      row.weightKg += total.weightKg;
      hardware.set(key, row);
    }
  }
  return {
    beams: [...beams.values()].sort((a, b) => compare(a.materialName, b.materialName) || b.lengthMm - a.lengthMm),
    sheets: [...sheets.values()].sort((a, b) => compare(a.materialName, b.materialName) || b.widthMm * b.heightMm - a.widthMm * a.heightMm),
    hardware: [...hardware.values()].sort((a, b) => compare(a.materialName, b.materialName)),
  };
}

const listWeight = (cut: { beams: readonly BeamCutRow[]; sheets: readonly SheetCutRow[] }, hardware: readonly HardwareRow[]) =>
  round([...cut.beams, ...cut.sheets, ...hardware].reduce((sum, row) => sum + row.weightKg, 0), 3);

function countAvailable(counts: readonly InventoryCount[], match: (count: InventoryCount) => boolean): number | null {
  const rows = counts.filter(match);
  return rows.length ? rows.reduce((sum, row) => sum + row.quantity, 0) : null;
}

function itemAvailable(items: readonly InventoryItem[], partId: string, variantKey: string | null): number {
  return items.filter(item => item.partId === partId && item.variantKey === variantKey && item.usable && !item.archived).length;
}

function shortageWarning(row: StockDemandRow): StockWarning {
  const subject = row.variantLabel ? `${row.name} (${row.variantLabel})` : row.name;
  return {
    kind: 'shortage', key: `shortage:${row.key}`, scene: null, objectIds: [], stockItemId: null,
    message: `${subject}: ${formatCount(row.required)} gebraucht, ${formatCount(row.available ?? 0)} im Bestand – es fehlen ${formatCount(row.shortage)}.`,
  };
}

const formatCount = (value: number) => Number.isInteger(value) ? String(value) : value.toLocaleString('de-DE', { maximumFractionDigits: 2 });

function withAvailability(row: Omit<StockDemandRow, 'available' | 'shortage'>, stock: StockInventory): StockDemandRow {
  const available = row.kind === 'item'
    ? itemAvailable(stock.items, row.partId ?? '', row.variantKey)
    : row.kind === 'count'
      ? countAvailable(stock.counts, count => count.partId === row.partId && (count.variantKey ?? null) === row.variantKey)
      : countAvailable(stock.counts, count => count.materialKey === row.materialKey);
  return { ...row, available, shortage: available === null ? 0 : Math.max(0, row.required - available) };
}

function demandRows(objects: readonly ResolvedLayoutObject[], context: ListContext, hardware: readonly HardwareRow[],
  stock: StockInventory): StockDemandRow[] {
  type Pending = Omit<StockDemandRow, 'available' | 'shortage'>;
  const rows = new Map<string, Pending>();
  const add = (kind: 'item' | 'count', ref: PartRef, name: string, variantKey: string | null, required: number, assigned: number) => {
    const key = `${kind}:${partKey(ref.id, variantKey)}`;
    const row = rows.get(key) ?? {
      key, kind, partId: ref.id, variantKey, materialKey: null, name,
      variantLabel: variantLabelFor(context.part(ref), variantKey), required: 0, assigned: kind === 'item' ? 0 : null,
    };
    row.required += required;
    if (row.assigned !== null) row.assigned += assigned;
    rows.set(key, row);
  };
  for (const item of objects) {
    const mode = item.resolved.stock;
    if (mode !== 'none') add(mode, item.object.part, item.resolved.name, stockVariantOf(item), 1, item.object.stockItemId ? 1 : 0);
    for (const child of item.resolved.partCounts) {
      if (child.stock !== 'none') add(child.stock, child.part, child.name, child.variant ?? null, child.count, 0);
    }
  }
  for (const total of hardware) {
    rows.set(`hardware:${total.material}`, {
      key: `hardware:${total.material}`, kind: 'hardware', partId: null, variantKey: null, materialKey: total.material,
      name: total.materialName, variantLabel: null, required: total.quantity, assigned: null,
    });
  }
  const order = { item: 0, count: 1, hardware: 2 } as const;
  return [...rows.values()].map(row => withAvailability(row, stock))
    .sort((a, b) => order[a.kind] - order[b.kind] || compare(a.name, b.name) || compare(a.variantLabel ?? '', b.variantLabel ?? ''));
}

function assignmentWarnings(objects: readonly ResolvedLayoutObject[], stock: StockInventory, scene: SceneRef | null): StockWarning[] {
  const items = new Map(stock.items.map(item => [item.id, item]));
  const warnings: StockWarning[] = [];
  const users = new Map<string, ResolvedLayoutObject[]>();
  const sceneKey = scene?.id ?? '';
  for (const item of objects) {
    const { object } = item;
    if (!object.stockItemId) {
      if (item.resolved.stock === 'item') {
        warnings.push({
          kind: 'unassigned', key: `unassigned:${sceneKey}:${object.id}`, scene, objectIds: [object.id], stockItemId: null,
          message: `„${object.label}“ hat noch kein Bestandsstück.`,
        });
      }
      continue;
    }
    const piece = items.get(object.stockItemId);
    const base = { scene, objectIds: [object.id], stockItemId: object.stockItemId };
    if (!piece || piece.archived) {
      warnings.push({ ...base, kind: 'missing', key: `missing:${sceneKey}:${object.id}`,
        message: `Das Bestandsstück von „${object.label}“ ist nicht mehr im Bestand.` });
      continue;
    }
    users.set(piece.id, [...users.get(piece.id) ?? [], item]);
    if (!piece.usable) {
      warnings.push({ ...base, kind: 'unusable', key: `unusable:${sceneKey}:${object.id}`,
        message: `Bestandsstück ${piece.label} („${object.label}“) ist als nicht verwendbar markiert.` });
    }
    if (!stockItemFits(piece, item)) {
      warnings.push({ ...base, kind: 'incompatible', key: `incompatible:${sceneKey}:${object.id}`,
        message: `Bestandsstück ${piece.label} passt nicht zu „${object.label}“ (anderes Bauteil, andere Variante oder andere Maße).` });
    }
  }
  for (const [stockItemId, placed] of users) {
    if (placed.length < 2) continue;
    warnings.push({
      kind: 'duplicate', key: `duplicate:${sceneKey}:${stockItemId}`, scene, objectIds: placed.map(item => item.object.id), stockItemId,
      message: `Bestandsstück ${items.get(stockItemId)?.label ?? stockItemId} ist mehrfach zugeordnet: ${placed.map(item => `„${item.object.label}“`).join(', ')}.`,
    });
  }
  return warnings;
}

/** Lists of one Bühnenbild. `assemblyNumbers` fills numbers the objects do not carry themselves. */
export function sceneLists(args: {
  objects: readonly ResolvedLayoutObject[];
  context: ListContext;
  stock?: StockInventory;
  scene?: SceneRef;
  assemblyNumbers?: ReadonlyMap<string, number>;
}): BuildLists {
  const stock = args.stock ?? { items: [], counts: [] };
  const scene = args.scene ?? null;
  const cut = cutRows(args.objects, args.context);
  const rows = demandRows(args.objects, args.context, cut.hardware, stock);
  return {
    scenes: scene ? [scene] : [],
    objects: objectRows(args.objects, new Map(stock.items.map(item => [item.id, item])), args.assemblyNumbers ?? new Map()),
    parts: partRows(args.objects, args.context),
    cutList: { beams: cut.beams, sheets: cut.sheets },
    hardware: cut.hardware,
    weightKg: listWeight(cut, cut.hardware),
    stock: {
      rows,
      warnings: [...assignmentWarnings(args.objects, stock, scene), ...rows.filter(row => row.shortage > 0).map(shortageWarning)],
    },
  };
}

function maxRows<T extends { key: string }>(lists: readonly (readonly T[])[], pick: (a: T, b: T) => T): T[] {
  const rows = new Map<string, T>();
  for (const list of lists) for (const row of list) {
    const known = rows.get(row.key);
    rows.set(row.key, known ? pick(known, row) : row);
  }
  return [...rows.values()];
}

const larger = <T extends { key: string }>(field: (row: T) => number) => (a: T, b: T) => field(b) > field(a) ? b : a;

/**
 * Lists for Bühnenbilder that follow one another with the same pieces (a venue visit, a
 * package): every row takes its largest quantity, warnings are kept per Bühnenbild and the
 * shortage is checked again against the combined demand. The object list is the concatenation.
 */
export function combineLists(lists: readonly BuildLists[], stock?: StockInventory): BuildLists {
  const inventory = stock ?? { items: [], counts: [] };
  const beams = maxRows(lists.map(list => list.cutList.beams), larger(row => row.count));
  const sheets = maxRows(lists.map(list => list.cutList.sheets), larger(row => row.count));
  const hardware = maxRows(lists.map(list => list.hardware), larger(row => row.quantity));
  const parts = maxRows(lists.map(list => list.parts), larger(row => row.count));
  const demand = maxRows(lists.map(list => list.stock.rows), (a, b) => ({
    ...(b.required > a.required ? b : a),
    required: Math.max(a.required, b.required),
    assigned: a.assigned === null || b.assigned === null ? null : Math.max(a.assigned, b.assigned),
  })).map(row => withAvailability(row, inventory));
  const order = { item: 0, count: 1, hardware: 2 } as const;
  demand.sort((a, b) => order[a.kind] - order[b.kind] || compare(a.name, b.name) || compare(a.variantLabel ?? '', b.variantLabel ?? ''));
  const cut = {
    beams: beams.sort((a, b) => compare(a.materialName, b.materialName) || b.lengthMm - a.lengthMm),
    sheets: sheets.sort((a, b) => compare(a.materialName, b.materialName) || b.widthMm * b.heightMm - a.widthMm * a.heightMm),
  };
  const sortedHardware = hardware.sort((a, b) => compare(a.materialName, b.materialName));
  return {
    scenes: lists.flatMap(list => list.scenes),
    objects: lists.flatMap(list => list.objects),
    parts: parts.sort((a, b) => compare(a.name, b.name) || compare(a.variantLabel ?? '', b.variantLabel ?? '')),
    cutList: cut,
    hardware: sortedHardware,
    weightKg: listWeight(cut, sortedHardware),
    stock: {
      rows: demand,
      warnings: [
        ...lists.flatMap(list => list.stock.warnings.filter(warning => warning.kind !== 'shortage')),
        ...demand.filter(row => row.shortage > 0).map(shortageWarning),
      ],
    },
  };
}
