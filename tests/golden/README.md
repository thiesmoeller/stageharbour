# Golden baseline of the per-kind (v1) pipeline

These files record what the current per-kind code (`walls`, `braces`, `platforms`, `stairs`, `placeholders`)
produces, so a rebuilt pipeline can prove it yields the same geometry, warnings, lists and documents.
They describe today's behaviour, including quirks; they are not a statement that the behaviour is right.

## Layout

`tests/golden/<fixture>/<aspect>.json`, one directory per fixture. Keys are sorted, numbers rounded to 3 decimals
(inputs to 6), arrays keep a deterministic order, short values stay on one line so diffs stay readable.

| Fixture | Content |
| --- | --- |
| `demo-seed` | The browser demo scene exactly as `createSeedSnapshot()` builds it |
| `kitchen-sink` | Every element kind and geometry/list option (wall types, doors, finishes, hinges, ballast, platform styles, stairs, placeholders, groups, cables, dimensions, pictures, venue shell) |
| `warnings` | Triggers every warning family: overlaps and contact cases, keep-clear (incl. the 1 mm edge), ceiling/overhead, missing/unknown surface, all inventory kinds |
| `wall-types` | All wall types at several door-open percents, door walls at non-right rotations, banded finishes, venue doors, stale stored dimensions |
| `stage-decks` | Many Bühnenelement sizes, grains, elevations, rotations, stacked on a solid base |
| `all-scenes` | One production package over the synthetic scenes (`lists`, `document`, `pdf` only) |

| Aspect file | Content |
| --- | --- |
| `input.json` | The frozen, schema-validated `{venue, layout, panels, ballastStock}` the other files were computed from. Later slices read this, not `fixtures.ts` |
| `footprints.json` | Per element id: kind, plan polygon in venue mm (walls also opening polygons, braces also timber and slab outlines); also floor, keep-clear zones, overhead boxes, trusses, curtains |
| `solids.json` | Oriented boxes `{center, size, rotation}` in world mm (Euler XYZ degrees; x = plan x, y = up, z = plan y; unmirrored): wall panels, door frames and leaves, brace members and ballast, stage-deck modules, legs and rubber feet, stair steps, placeholder bodies and chair parts. Plus spheres (seated figure head), prisms (non-rectangular platform slabs), per-element bbox and height, `v1Kind` metadata, and for walls opening outlines and `wallMeshGeometry` mesh summaries |
| `surfaces.json` | Supporting surfaces (id, outline, elevation), each element's resolved support and elevation, stair rise, majority-vote supports |
| `warnings.json` | Overlap (scene and venue), keep-clear, overhead, placement diagnostics, inventory warnings; sorted `{family, kind, ids, message}` |
| `lists.json` | Material counts and requirements, ballast and brace parts, panel demand by wall type, assembly numbers and captions, package scene lists and stock, stage-deck module and leg counts, cable schedule, elevation faces, dimensions, group pivots, plan extents |
| `document.json` | Paper-independent export model: the frozen snapshot (without venue/layout, which are in `input.json`) and the composed `DocumentLayout` (sheets, paint primitives) from `composeDocument` |
| `pdf.json` | Fingerprints, not bytes, of the legacy plan PDF, the document PDF and the package PDF: page count, page sizes, extracted text per page, operator and path counts |

## Updating

```
UPDATE_GOLDENS=1 npm test
```

rewrites every file (and removes orphans). Review the diff: a change there is a change in behaviour. Without the
variable each test recomputes and deep-compares with the stored file and prints the first differing paths.
Run `npm test` twice after updating; the files must not change.

## Plugging in a different pipeline

`tests/golden/compare.ts` compares a neutral structure from any pipeline with a named golden, with a numeric
tolerance (default 0.5 mm, `{ tolerance }` to change). Polygons ignore start vertex and winding; box sets ignore
order, part names and equivalent rotation representations (corner-set comparison); warnings are a multiset of
family/kind/ids (messages only with `compareMessages`); v1 kinds are metadata unless `compareKind`.

```ts
import { assertMatchesGolden } from './golden/compare.js';
import type { NeutralFootprints, NeutralSolids } from './golden/types.js';

const footprints: NeutralFootprints = { [id]: { kind: 'wall', polygon: [{ x, y }, ...] } };
const solids: NeutralSolids = { [id]: { boxes: [{ part, center, size, rotation }] } };
assertMatchesGolden('kitchen-sink', { footprints, solids, surfaces, warnings, lists }, { tolerance: 0.5 });
```

Aspects left out of the argument are skipped. Load inputs with `loadFixtures()` from `capture.ts` (reads `input.json`).
`compareFootprints`, `compareSolids`, `compareSurfaces`, `compareWarnings`, `compareLists` return mismatch lists for finer control.

## Element kind to v1 functions

| Element kind | Footprint | Elevation / support | Solids (world boxes) | Warnings and lists |
| --- | --- | --- | --- | --- |
| wall (layout, venue) | `resolveWall`, `wallCorners`, `openingCorners` | `supportingSurfaces`, `surfaceElevation` | `wallSolid` + client `DoorFittings` (`DOOR_LEAF`, `DOOR_FRAME`, `doorOpenAngleDegrees`); mesh summary `buildWallPanelGeometry`, `openingOutlinePoints`, `faceSplitMm` | `objectOverlapWarnings`, `keepClearWarnings`, `overheadClearance`, `layoutDiagnostics`, `inventoryWarnings`, `assignAssemblyNumbers`, `assemblyCaption`, `elevationFaces` |
| brace | `braceCorners` (includes ballast bounds), `braceSlabFootprints` | same | `braceSolid`, `braceMembers`, `braceBallast` + client `StageBraces` pose | the same warning functions, `sceneMaterials`, `materialRequirements`, `ballastLabel` |
| platform (floating, solid, stageDeck) | `outline` | `platform.elevation` | client `PlatformMesh`: `orientedPlatformBox`, `surfaceElevationUnderPoint`, `layoutStageDeckModules`, `stageDeckLegPositions`, `STAGE_DECK_*` | overlap (platforms only collide with platforms), keep-clear (always floor), stage-deck counts from `layoutStageDeckModules`/`stageDeckLegPositions` |
| stair | `stairCorners` | `lowerSurfaceId` elevation, `stairRise` | `stairSteps` | overlap, keep-clear (lower and upper surface), `layoutDiagnostics` (unknown surface) |
| placeholder (layout, venue) | `placeholderCorners` | `surfaceElevation` | `placeholderSolid` + client `ChairMesh` for chairs | overlap, keep-clear, `layoutDiagnostics` |
| venue fixtures | `measuredOutline`, `overheadBoxCorners`, `trussCorners`, `curtainCorners`, keep-clear polygon | n/a | n/a | `overheadClearance` (ceiling, boxes, trusses) |
| document / PDF | n/a | n/a | n/a | `freezeSnapshot`, `freezePackage`, `composeDocument`, `renderConstructionPlan`, `renderDocument`, `renderPackage` |

## Not captured

- Client-only rendering that depends on materials or the lit/unlit mode: surface textures, shadows, seam planes over stage decks with a top finish, pick-handle boxes, shadow volumes. The unfinished-deck geometry (frame and infield per module) is recorded.
- Byte-level PDF output (the PDF library stamps creation dates); 3D view images in documents.
- Interactive behaviour (snapping, group transforms, push-pull).

## Layout v2 comparison (A4/A5)

`tests/golden/v2.ts` migrates each frozen v1 input, resolves the starter catalog, and feeds neutral
footprints, solids and supporting surfaces into `compare.ts` at the default 0.5 mm tolerance.
The demo seed matches all three aspects exactly. Stage-deck footprints and surfaces also match, as
do wall-type supporting surfaces.

The remaining differences are intentional model changes and are locked by
`tests/golden-compare.test.ts`:

- An open door is now a child part. Its swung leaf participates in the resolved physical footprint;
  v1 plan footprints always stayed the closed panel rectangle. A few rotated leaves differ slightly
  because the old renderer and the part kernel use different hinge/depth pivots.
- Window, arch and door panels are real sheets with holes. A neutral bounding box cannot reproduce
  the old renderer's list of synthetic panel/frame boxes even though the authored cut-out matches.
- Furniture/person starter parts are constructive part solids. The old placeholder renderer used
  different approximations (including a sphere for a seated head).
- A migrated stage-deck platform remains one placement with its exact outer footprint and top
  elevation. Its starter definition is one deck with four legs; v1 subdivided every large platform
  into many renderer-only 2×1 m modules. That tiling is deliberately not persisted as hidden child
  placements.
- Floating/solid platforms preserve their oriented bounding rectangle. The current parametric
  kernel cannot accept an arbitrary polygon as placement values, so irregular v1 platform outlines
  are the one footprint/surface difference.
