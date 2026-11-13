# Parametric part kernel

A part is a JSON document (`PartDefinition`): parameters, formulas, bodies, child parts,
connectors and traits. The kernel turns a definition plus the values of one placement into
solids, a footprint, faces, a cut list, hardware and a weight. It is pure and deterministic.

```ts
import { resolvePart, validateDefinition, placeResolvedPart, STARTER_CONTEXT } from '../shared/parts/index.js';
import { buildPartGeometry, placementMatrix } from '../shared/parts/geometry.js'; // imports three.js
```

`index.js` never imports three.js, so the server can use it. Only `geometry.js` does.

| Module | Holds |
| --- | --- |
| `formula.ts` | Formula parser and evaluator: numbers, names, `+ - * /`, comparisons, `min max abs round floor ceil sqrt if`. No `eval`. |
| `definition.ts` | zod schemas and types for definitions, materials and libraries; `partLibraryJsonSchema()`; `createPartContext`. |
| `resolve.ts` | `resolvePart`, the result types, helpers on solids. |
| `place.ts` | A resolved part at a plan position: `placeResolvedPart`, `placeFootprint`, `placePoint`. |
| `validate.ts` | `validateDefinition`, `validateLibrary`: everything to check before a definition is saved. |
| `geometry.ts` | three.js `BufferGeometry` for a solid or a whole part. |
| `starter/` | Built-in definitions and materials: wall/door, brace, deck/leg, floating and solid platforms, stair, table, chair, person, speaker and box. |

## Frame

All lengths are millimetres, all angles degrees.

- **Part-local:** origin at the centre of the footprint on the supporting surface. +X is the
  width, +Y is up, +Z points away from the audience. The front of a wall faces -Z.
- **Plan:** a part's plan is (x, z) of this frame, written as `Vec2 { x, y }` with y = part z.
- **Placement:** `{ x, y, rotation, elevation? }` in plan millimetres, rotation counter-clockwise
  in the plan. World x = plan x, world z = plan y, three.js yaw = `-rotation · π / 180`. This is
  the convention of `wallGeometry.ts` and `stageGeometry.ts`; the tests compare against both.
- **Beam:** runs from `from` to `to` and is cut square. The section width is horizontal and the
  height upright; a vertical beam has its width along +X. `roll` turns it about its centre line.
- **Sheet:** drawn in its own coordinates (u, v). `plane: 'xy'` stands upright with the material
  towards +Z, `'xz'` lies flat with the outline in (x, z) and the material below `at`, `'yz'`
  stands across. `anchor` moves `at` from the front face to mid-thickness or the back face.
- **Box:** centred on `at`. A box is a bought piece (rubber foot, crate) and takes a hardware
  material; it counts as one piece and is never cut.

## Resolve pipeline

`resolvePart(definition, { variant?, values?, state? }, context)` does this, in order:

1. **Values.** Parameter defaults, then the variant (the first one when none is named), then
   `values` for placement-scope and `state` for state-scope parameters. Each value is clamped
   and snapped to the parameter's domain; a changed value yields a `value-adjusted` warning.
2. **Derived values**, in declaration order. Each may read parameters and earlier derived values.
3. **Bodies.** `when`, then `repeat` (up to three nested levels, index names `i`, `j`, `k` or
   your own), then the formulas of the body. Sheet cut-outs are applied to the outline.
4. **Children.** Each child is resolved as its own part with the values the parent computes,
   then moved to `at` / `rotation`. Equal configurations are resolved once.
5. **Connectors, faces, walkable surface, hardware.**
6. **Totals.** Cut list, weight, footprint (convex hull of all solids in plan), bounds.

Nothing is thrown for bad data. Problems come back in `issues`, each with a German `message`
and the keys of what it is about (`body`, `hole`, `child`, `parameter`, `field`, ...). A body
with an error is left out and a cut-out with an error is not cut; the rest still resolves.
Check `hasErrors(result.issues)` before trusting a cut list.

`context` supplies materials and child definitions: `createPartContext({ materials, parts })`.

## Result

```ts
type ResolvedPart = {
  part: { id, revision }; name; category; variant?: string;
  values: Record<string, number>;      // every parameter, as used
  derived: Record<string, number>;
  solids: ResolvedSolid[];             // box | beam | sheet, children included, part-local
  footprint: Vec2[];                   // plan polygon, counter-clockwise
  bounds: { min, max }; height: number;
  faces: ResolvedFace[];               // finishable faces: key, solid, side, areaMm2, plane?
  surfaces: ResolvedSurface[];         // walkable tops: plan outline, holes, elevation
  connectors: ResolvedConnector[];     // id, kind, position, axis (unit), length
  cutList: { beams: BeamCut[]; sheets: SheetCut[] };
  hardware: HardwareTotal[];           // boxes and `hardware` entries, by material
  weightKg: number;
  parts: PartInstance[];               // child tree
  partCounts: PartCount[];             // children counted by part and variant
  stock: 'item' | 'count' | 'none'; planSymbol: 'footprint' | 'solids' | 'stair';
  issues: PartIssue[];
};
```

Solid ids are stable paths: `platte`, `rahmen-lang[1]`, `fuss[0,1]/rohr`. A sheet carries its
`outline` (cut-outs that reach the edge are notched in), `holes`, the authored `openings`,
`blank` (the rectangle to cut) and `netAreaMm2`. The result is plain data and survives JSON.

## Worked examples

### 1. Stützdreieck: cut list and hardware

```ts
const brace = resolvePart(STARTER_BRACE, { variant: 'standard', values: { ballast: 2 } }, STARTER_CONTEXT);
```

`T = 500`, `H = 1200`, derived `s = 40`, `wandZ = -230`, `spitzeZ = 230`. Three beams of
`latte-40x40`: `stiel` 1200, `schwelle` 500 and `strebe` from (0, 20, 230) to (0, 1180, -230),
length √(1160² + 460²) = 1247.88. `cutList.beams` has one row per length (1248, 1200, 500;
`lengthMm` is rounded, `totalLengthMm` is exact). `hardware` lists two `betonplatte-400` and,
because `ballast >= 2`, one `spanngurt-25`. Footprint: 40 × 500 around the origin.

### 2. Wandelement with a door, placed in the plan

```ts
const wall = resolvePart(STARTER_WALL, { variant: 'doorLeft', state: { open: 0 } }, STARTER_CONTEXT);
const placed = placeResolvedPart(wall, { x: 3000, y: 2000, rotation: 30 });
```

One sheet of `tischlerplatte-28`, centred on z = 0 (`anchor: 'centre'`). The door cut-out
starts on the floor edge, so it becomes a notch: `outline` has eight corners, `holes` is empty,
`openings[0].placement` is `'edge'`. `netAreaMm2` = 1200 · 2400 − 800 · 2000 = 1 280 000, the
cut list row is the 1200 × 2400 blank, weight 16 kg. `faces` holds `front`, `back` (each with
a `plane` to draw or measure on) and `edge`. `placed.footprint` equals `wallCorners` for the
same position; `placed.solids` are the same solids in world millimetres.

### 3. Bühnenelement: children, repeat, counted stock

```ts
const deck = resolvePart(STARTER_DECK, { variant: '2x1', values: { H: 800 } }, STARTER_CONTEXT);
```

The deck has a plywood top (`plane: 'xz'` at height `H`), four frame beams from two repeated
bodies, and the child `fuss` repeated 2 × 2 with `values: { H: 'H' }`. Solids:
`platte`, `rahmen-lang[0..1]`, `rahmen-quer[0..1]`, `fuss[0,0]/gummifuss`, `fuss[0,0]/rohr`, ...
`partCounts` says 4 × Steckfuß, variant `800`; `surfaces[0]` is the 2000 × 1000 top at
elevation 800; `connectors` has the four `deck-edge` edges, four `leg-socket` points and the
connectors of each leg as `fuss[0,0]/kopf`. The leg positions equal `stageDeckLegPositions`.

## Validating before saving

```ts
const result = validateDefinition(json, context); // { ok, definition?, issues, evaluated, sampled }
```

It checks the structure (unknown keys are errors), names and references, materials and child
parts in `context`, cycles and depth, and then resolves the definition for every variant with
the free parameters at their defaults, each alone at its range ends or listed values, and in
combination. An issue found that way names the parameter and the values:
`Körper „bein“: Länge 0 mm unterschreitet das Mindestmaß von 1 mm. Tritt auf bei B = 1200, T = 800, H = 500.`
Save only when `ok`. Ranges are tried at their ends, not in between; a formula that fails only
inside a range is caught at resolve time instead. `validateLibrary` does the same for a file of
materials and parts.

## Authoring openings

Selecting a sheet body in the Designer opens the face sketcher for drawing, moving and resizing
rectangular, arched and polygonal openings without editing formulas directly. New openings are
stored as sheet holes and per-opening parameters as decided in [ADR 0011](../../../docs/adr/0011-face-openings-sketcher.md).

## Drawing

`buildPartGeometry(resolvedOrPlaced)` returns one indexed `BufferGeometry` and `slots`: one
material group per stock material, plus one per finishable face (`slot.face` is the key in
`faces`). `buildSolidGeometry(solid)` gives a single solid with a group per side
(`BOX_SIDE_SLOTS`, `SHEET_SIDE_SLOTS`). Geometry is in the frame of its input: pass a resolved
part and set the mesh matrix to `placementMatrix(placement)`, or pass a placed part.

## Documents and stock

Construction documents freeze a Bühnenbild as a `ConstructionSnapshot` (version 2,
`src/shared/export.ts`): the layout, the venue, `library` (the exact revisions the objects use,
their child parts and every material they name, see `frozenParts.ts`) and the `stock` pieces and
counts it was checked against. Drawings and lists are derived again from the snapshot alone, so
editing the library later cannot change an issued document.

- `partDrawings.ts`: `planSymbol` (footprint, solids or stair steps from `traits.planSymbol`,
  floor gaps and door swings from openings and child hinge edges) and `elevationOutline`
  (projected faces with cut-outs).
- `assembly.ts`: `assemblyOrder` numbers chains of `hinge-edge` joints from left to right.
- `partLists.ts`: parts list, cut list, hardware, weight and stock demand of resolved objects
  (`sceneLists`); several Bühnenbilder of one venue visit or package share stock, so
  `combineLists` takes the maximum per row.
- `stockDemand.ts`: the same lists for saved Bühnenbilder against the live library, served at
  `…/scenes/:id/stock-demand`, `…/productions/:id/venues/:venueId/stock-demand` and
  `…/productions/:id/stock-demand`.

## Rules worth knowing

- A cut-out within 0.5 mm of the sheet edge is cut through it (door to the floor). An error is
  reported for one that only touches the edge with a corner or a curve, whose edge runs exactly
  through a corner of the outline, that splits the sheet, or that overlaps or touches another
  inner cut-out. Move it by a millimetre or merge the two.
- No body dimension below 1 mm; coordinates within ± 100 m; at most 8 levels of children;
  at most 4000 solids per part.
- Keys of bodies, children, holes and connectors are part of solid ids and of what a Bühnenbild
  stores (face finishes, connections). Renaming one is a breaking change of the definition.
- A definition is immutable per `id` + `revision`; children point at an exact revision.
- Not expressible yet: curved outlines (only the crown of an arch cut-out), outlines drawn
  freely per placement, bodies that are neither box, beam nor sheet (turned legs, pipes bent in
  a curve, fabric). The footprint is a convex hull, so an L-shaped part over-covers its corner;
  use `solids` or `surfaces` where the true outline matters.
