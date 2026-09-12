# Pascal editor implementation status

Baseline: `implement/phase-one` at `768f9b4`. Working branch: `feature/pascal-stage-editor`. The pre-reconciliation Pascal stash remains available.

## Implemented

- Restored the phase-one venue, inventory, opening, grouping, snapping, clipboard, constraint and export features.
- Pascal theatre-node projection for scene objects and permanent venue objects, incremental node updates, material presets, catalogue access and GLB imports.
- Shared validated transforms and history for 3D move/rotate, with preview, commit, cancel and additive selection. Imported models use placeholder selection, clipboard and supporting surfaces.
- Separate venue draft/history, vertex dragging, fixed-wall authoring, 3D object transforms, publication and discard.
- Venue plan rubberband selection, 2D object dragging, clipboard, delete and Escape cancellation for walls, platforms and stairs.
- Scene snapping and brace alignment treat permanent venue walls as fixed geometry targets.
- Full-width workspace, adjustable split, fullscreen, plan/3D modes, camera presets and selection framing.
- Fixed rotation-guide pointer interception that prevented wall-centre dragging. Scene shortcuts no longer edit the hidden scene while the venue editor is open.

## Verification

Final local browser acceptance: all 14 tests passed together (fresh production build, Chromium). Type checking also passes.

The checked-in GitHub Actions workflow installs Chromium and runs unit, integration and freshly built browser checks against PostgreSQL. Its hosted run remains unverified until the branch is pushed.

Production build and 23 unit-test files pass. All 76 integration tests pass against disposable databases. Browser coverage includes imported assets, SVG wall snapping/rotation, mixed marquee deletion/clipboard, venue vertex undo/publication, exports, saved layouts and an actual drag of the rendered Pascal 3D translation handle with one-step undo/redo. Browser tests build fresh assets; authentication throttling is disabled only in the browser fixture, with production throttling covered separately.

## Remaining scope

Venue 2D object dragging, rubberband selection, clipboard/delete and Escape cancellation are in place for walls, platforms and stairs, and scene snapping treats permanent venue walls as fixed targets. Opening authoring on permanent walls, hierarchy/layers, broader precision tools, asset-authoring polish and scene-change workflows remain. 3D snapping remains wall-led; constraint-aware snapping for every object kind needs further work. Camera/rendering acceptance still needs broader visual baselines, browser/GPU coverage, large-scene performance measurements and crew review. Pascal's full architectural shell and ToolManager are not used; the theatre adapter deliberately retains one application-owned document history.

The local database's earlier asset migration had identical SQL to the new 0010 migration. Its hash was verified, the five missing phase-one migrations were applied transactionally, and its journal timestamp was reconciled. No application data was deleted; a subsequent normal migration completed successfully.

The one existing local scene's zero-elevation model was converted from the former `props` array into the shared placeholder representation, preserving placement identity, asset reference and dimensions. This is a local data reconciliation, not a runtime compatibility layer.
