# Plan: Face openings sketcher (Bühnentechnik)

Implements [ADR 0011](../adr/0011-face-openings-sketcher.md). **This document is the build plan only** — no sketcher code in the ADR/plan PR.

## Goal

In `#/designer`, select a sheet body → draw openings on its face → save a part revision whose holes and parameters a non-CAD tech created without reading formulas.

## Out of scope (this plan)

- Edge → beam frame sketcher (Stützdreieck, etc.)
- Sliding-window starter
- SolidCraft plugin / `.sc` import
- 3D mesh drawing, full-screen CAD mode, constraint solver

## Current seams (dev)

| Piece | Location |
| --- | --- |
| Hole schema (rect / arch / polygon) | `src/shared/parts/definition.ts` (`sheetHoleSchema`) |
| Resolve / cut / weight | `src/shared/parts/resolve.ts` |
| Starter wall with one opening param set | `src/shared/parts/starter/parts.ts` (`STARTER_WALL`) |
| Designer shell, selection, preview | `src/client/designer/*` |
| 2D views | `src/client/designer/PartViewsSvg.tsx` |
| Library JSON import/export | catalog routes + `LibrarySidebar` |

## Work packages

### P0 — Parameter groups for holes

- Helper: for hole key `fenster`, ensure parameters such as `fensterLeft`, `fensterSill`, `fensterB`, `fensterH` (names TBD; stable, unique, German labels).
- Arch may reuse rect fields; polygon gets point parameters or a documented literal-points mode still keyed off the hole.
- When the sketcher creates/deletes a hole, create/remove or retire its parameter group (no dangling refs).
- Update **STARTER_WALL** (new revision semantics as today) toward one group per hole so multi-window matches the model. Keep v1→v2 / golden notes if behaviour changes.

### P1 — Face view canvas

- When selection is a sheet body, show an **elevation/face** drawing surface (sheet local u/v) beside or instead of the generic SVG slot for that body.
- Render outline + existing holes from the live resolve (or from definition + preview values).
- Toolbar: **Rechteck**, **Bogen**, **Weitere Form → Polygon**; select; delete.
- Interactions: click-drag create; select → move/resize handles; escape/deselect.
- Every edit updates `definition.bodies[n].holes` formulas to reference that hole’s parameters and updates parameter defaults/preview values so the 3D preview tracks.

### P2 — Designer wiring

- Entry: selecting a sheet in `BodyList` / views focuses the face sketcher.
- Non-sheet selection: hide sketcher; keep current inspector.
- Read-only role: view holes, no draw.
- Dirty/save/conflict behaviour unchanged (`savePart` / revision bump).

### P3 — Proof

- **e2e:** duplicate wall (or open copy) → draw rect window pocket → save → reload → hole + params present; preview shows opening.
- **Manual success gate:** non-CAD person on `/preview/` adds a window pocket without opening the formula fields.
- Unit tests for parameter-group helpers and hole↔param binding.

### P4 — Docs touch-ups (with implementation PR)

- Link ADR 0011 from `src/shared/parts/README.md` (short “authoring” note).
- Designer empty-state / help one-liner: openings on the face of a sheet.

## Suggested implementation order

1. P0 helpers + tests (no UI).
2. P1 canvas with rect only behind a flag or route, then arch, then polygon under Weitere Form.
3. P2 wiring + starter wall alignment.
4. P3 e2e + manual gate on preview.
5. P4 README blurb.

## Follow-ups (not this plan)

1. **Frames:** sketch edges → beam bodies (brace-like).
2. **Sliding window starter** using openings + translating child (state param).
3. **SolidCraft plugin** → emit StageHarbour library JSON when their plugin API exists.

## Acceptance

- ADR 0011 decisions hold.
- Success check from the grill: window pocket on a wall copy without reading formulas.
- Library import/export still the only external part ingress; no `.sc` loader.
