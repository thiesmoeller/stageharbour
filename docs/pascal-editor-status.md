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

## Workspace UI update (13 September 2026)

The editor now uses a compact application shell inspired by SketchUp's canvas, toolbar and inspector arrangement. On desktop, the document header and command bar stay above the canvas, creation tools sit on the left, and a separately scrolling properties tray sits on the right. Account management remains in the overview. The plan has its own zoom controls; the status bar offers an explicit help disclosure. Selected-object properties precede expandable wall-type, inventory, assembly, grouping, clipboard and placeholder sections. Collapsing a section keeps its form mounted, preserving entries. Selecting another object brings its properties back into view.

The asset library opens beside the properties tray. Construction plans and packages share one export drawer. Venue drafting retains its own scrollable workspace and history controls; scene creation and history controls are hidden while drafting the venue. Narrow screens use stacked views and a horizontal creation toolbar.

Verification: production build and type checking pass; all 23 unit-test files and all 16 Chromium browser journeys pass. Added browser coverage checks the desktop canvas bounds, collapsed-panel draft retention, view switching, help and layout at 1440, 1024 and 390 pixels. The final mobile header adjustment is also checked by rerunning that focused journey. Screenshots are generated as `test-results/editor-workspace-desktop.png` and `test-results/editor-workspace-mobile.png`.

Visual follow-up remains: crew feedback, broader browser/GPU acceptance, and refinement of the 3D camera/render controls. This update changes presentation and access to existing tools, not the scene document format.

## Venue editor shell (13 September 2026)

The independent Spielstätte editor now uses the same canvas-first chrome as the scene workspace: left tool rail, 2D/3D view modes, and a right-hand properties tray. Outline, calibration, infrastructure, levels, overhead, keep-clear and centreline live in collapsed inspector sections instead of a long stacked form.

Spielstätten can be designed outside a production: outline, fixed walls and a default warm/cool lighting mood live on the venue version. Creating a production can pin an existing venue version instead of inventing a new rectangle. Copying a scene into another venue and inserting a scene template both offer the venue library as destination choices, so an existing production can adopt a newly designed room.

Scene lighting is stored on the layout and edited from the Raumsicht panel; venue lighting stays on the venue draft until published. Reloading keeps the two independently. Browser coverage walks the full path (standalone venue → production reuse → scene preset → blackout screenshot → copy into a second library venue). The wall-height inspector label uses an exact match so it no longer collides with the lighting “Aufhängepunkt” field.

## Camera and workspace polish (14 September 2026)

Scene and venue workspaces now offer a collapsible properties tray, retaining mounted forms and unfinished entries. The 3D camera presets use compact labelled icons with active states; render environment and quality settings live in a disclosure. Switching to the simple renderer returns to the supported orbit view, and repeated fit commands reset the camera after navigation.

3D selection clearing now goes through the pointer-distance check instead of also handling the floor click, so releasing a transform handle preserves the selected object's properties. Browser journeys were updated for click-to-place library walls, collapsed render/venue settings, and automatic platform support with separate platform/stair undo steps.

Overhead and keep-clear overlays ignore pointer events when no editing handler is supplied, allowing scene objects beneath them to be selected while preserving venue editing.

Verification: production build and TypeScript checks pass. Nine targeted Chromium journeys passed across the final run and focused rerun: assets, responsive workspace, five gesture journeys, linked plan/3D editing, and venue lighting. The focused rerun after the overlay fix passed all six interaction and linked-view checks. Desktop and mobile screenshots were visually inspected during verification.
