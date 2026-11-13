# Exchange: glTF and MVR

A saved Bühnenbild leaves StageHarbour as a binary glTF 2.0 (`.glb`) or as an MVR archive
(`.mvr`, My Virtual Rig, DIN SPEC 15801 version 1.6) so lighting and visualiser tools can load
the set and the room it stands in.

| Module | Holds |
| --- | --- |
| `sceneMesh.ts` | `buildSceneMesh(layout, venue, catalog)`: the one list of entries (mesh + placement) both formats read. `sceneMeshToObject3D` for three.js. |
| `gltf.ts` | `exportGltf(mesh)` and `exportObject3DGlb(object)`, on three.js `GLTFExporter`. |
| `mvr.ts` | `exportMvr(mesh, meta)`, `buildMvrXml`, `mvrMatrix`. |
| `zip.ts` | A small ZIP writer and reader (STORE or DEFLATE, no ZIP64). |
| `fileReaderShim.ts` | Gives Node the `FileReader` that `GLTFExporter` calls; browsers are left alone. |
| `formats.ts` | File names, content types and the download path. No three.js, so the UI may import it eagerly. |
| `index.ts` | `exportSceneFile({ format, scene, venue, layout, catalog })`, what the routes and the local demo call. |

Routes (any member of the workspace): `GET /api/workspaces/:workspaceId/scenes/:sceneId/export/gltf`
and `.../export/mvr`. The local demo answers the same paths through `getBlob`.

## What is in the file

- **Placed parts.** Every layout object, from its resolved part (`resolvePart` solids, the same
  geometry as the 3D view), at its plan position, rotation and support height. Identical parts
  (same revision, variant, values, finishes) share one mesh.
- **Venue shell.** The audience floor (outline, 50 mm slab), fixed walls with their openings,
  permanent podiums (floating, solid, deck: slab only), permanent stairs, venue placeholders
  (as boxes) and trusses (four 50 mm chords, not a lattice).
- **Materials.** Stock material colour per part body, RAL paint finishes of faces, a fixed
  colour per venue element. PBR roughness/metalness are rough constants.
- **Identities.** Layout object and venue element ids are the glTF `extras.stageharbour.id` and
  the MVR `uuid`, so a re-export keeps them. Objects that could not be exported (part missing
  from the catalog, part without bodies) are listed in `glTF extras.skipped` and in the MVR
  `UserData` as `Skipped`.

## Coordinates and units

The plan has x to the right, y away from the audience and height above the audience floor.

- **glTF**: metres, right-handed, +Y up, as glTF requires. Plan x is +X, plan y is -Z, so a
  viewer that opens the file looks at the stage from the audience side with the stage in front
  of it. One node per entry, translation in metres, rotation about Y.
- **MVR**: `Matrix` values are millimetres in a right-handed Z-up system (MVR 1.6): X is plan x,
  Y is plan y, Z is height. Rotation is counter-clockwise about Z, written as the four rows
  `{u}{v}{w}{o}`. The geometry files are glb, so metres and Y-up inside; a reader converts
  glTF Y-up to Z-up as it does for any glTF (the MVR specification states no units for glTF, only
  1 unit = 1 mm for 3DS).

The viewer in the browser mirrors X so that +X points audience-right; the exported meshes are
the corrected, right-handed form, with the triangle winding flipped to stay outward-facing.

## MVR subset

- `GeneralSceneDescription.xml` (UTF-8) at the archive root, `verMajor="1" verMinor="6"`,
  `provider="StageHarbour"`, plus `UserData/Data` with production, venue, scene, export time.
- Two `Layer`s: `Spielstätte` (venue shell, trusses) and `Bühnenbild` (placed parts), each with a
  `ChildList`. Layer UUIDs are derived from the scene id and stay stable.
- `SceneObject` per entry, `Truss` for trusses, each with `Matrix` and
  `Geometries/Geometry3D fileName="geo-NNN.glb"`. One glb per distinct geometry, referenced by
  every object that uses it. Files are at the archive root, names portable and unique ignoring case.
- ZIP: no encryption, entries DEFLATE or STORE.

## Not in the first pass

- No GDTF: no fixtures, no `Fixture` nodes, no DMX addresses. The hang plan (Scheinwerfer on
  trusses) is not exported. Trusses carry no GDTF spec.
- `FixtureID`, `Position`, `Class`, `Symdef`/`Symbol` and `GroupObject` are not written. MVR's table
  asks for a `FixtureID` on every `SceneObject`; scene objects here are not fixtures and omit it,
  as other exporters do.
- Materials are flat colours. Library and registry finishes (textures) are not exported; paint
  (RAL) is. Banded faces use one colour.
- Door leaves of venue walls, curtains, keep-clear zones, cables, dimensions and wall pictures are not exported.
  A door part placed from the library is exported, in its stored open/closed state.
- Podiums of the style "Bühnenelement" are a slab without Steckfüße. Trusses are four chords.
- The export is built from the saved Bühnenbild, not from unsaved editor changes; the editor
  disables the menu entries until autosave has finished.
- The glTF has no lights, cameras or animation (`extensionsRequired` is empty).
