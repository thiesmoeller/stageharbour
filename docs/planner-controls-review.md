# Planner control consistency review

Reviewed 2026-09-16 against `da71107`, using the current implementation rather than the historical branch review. Scope: venue and stage selection, movement, rotation, snapping, clipboard, cancellation, keyboard commands, navigation, resizing and asset storage. Findings below describe the original source-traced behavior. The implementation status and subsequent validation are recorded separately below; no user usability study was performed.

## Implementation status — 2026-09-16

Implemented the ten findings: authoritative stage selection, mixed selection gestures, independent translation/rotation, transaction guards, shared snapping, warning-only overlaps, general selection rotation, matching shortcuts/cancellation, asset-library placement previews, and shared navigation plus scene face resizing. Fixed inventory dimensions remain protected. Uploaded models now follow their individual dimensions when resized.

Regression coverage includes Shift-deselect followed by commands; mixed wall/platform movement and cancellation; keyboard commands during 3D manipulation; actual face-resize preview/cancel/commit/undo; and asset preview cancellation and persistence. Unit coverage compares venue/stage snapping and rotation, brace orientation, navigation anchoring and scene/venue resize isolation.

## Original verdict

The controls are not yet orthogonal. The same gesture changes meaning depending on object type, planner and view. Most seriously, the highlighted selection is not always the command target, and moving an object can implicitly rotate it. Sharing the renderer and 3D gizmos has not unified the command behavior beneath them.

The [PDF export UX review](pdf-export-ux-review.md) extends this review to the export workflow and actual rendered sheets, including reproduced text collisions and cropped elevations.

## Findings, ordered by impact

1. **P1 — Shift-deselected stage objects remain command targets.** `Editor.tsx:312` (`pick`) toggles an object out of `picked` but still writes its ID into the singular inspector selection. `selection()` (`:363`) adds that singular ID back. Select wall A, Shift-click A to remove it, then Copy/Delete: A is still targeted. Platforms have the same problem (`:549`). Venue selection uses one ID list and does not have this particular mismatch. Use one authoritative selection; an inspector's primary object must be a member of it.

2. **P1 — A stage mixed selection cannot be manipulated consistently in 2D.** `Editor.tsx:329` considers only `picked`, excluding `pickedPlatforms`, when preserving a multi-selection. `startPlatform` (`:549`) explicitly clears other selected objects. Marquee a wall and platform, then drag either: the selection/target set changes, instead of moving the visible set together. The 3D command (`:1059`) accepts all `ClipboardMember` types, and the venue drag (`VenuePanel.tsx:201`) preserves the complete selection. Ordinary multi-selection must not inherit the narrower formal-group membership rules.

3. **P1 — Move can rotate a brace even with snapping disabled.** `Editor.tsx:947` unconditionally calls `alignBraceToNearestWall` on pointer release. The gesture's Alt/global snapping bypass is not consulted here. A brace near a suitable wall can acquire a different orientation after its move preview; other object types do not do this. Keep translation independent from rotation, or expose an explicit wall-contact alignment operation that respects bypass. The brace's contact-pivot rotation tool can remain a named domain-specific operation.

4. **P1 — Keyboard commands can mutate a document during an active transform.** The stage shortcut guard (`Editor.tsx:416`) omits stair drag/rotation, placeholder rotation, group rotation and the 3D gesture. Venue shortcuts (`VenuePanel.tsx:395`) have no active-gesture guard. For example, Delete during a 3D drag can delete the selection, followed by pointer-up committing the transform's older snapshot and restoring it. Undo can similarly be overwritten. Give both planners one gesture transaction gate: Escape cancels; conflicting commands are disabled or first resolve the active transaction.

5. **P2 — Snapping has different meanings across planners and object types.** Venue 2D translation snaps only a single wall (`VenuePanel.tsx:328`); stage stairs and placeholders also snap (`Editor.tsx:849`), while platforms translate freely. Venue 3D translation does not apply positional snapping at all (`VenuePanel.tsx:415`). Venue rotation rounds every angle to 15° (`:314`, `:421`), whereas stage rotation uses a 2.5° attraction tolerance (`shared/snapping.ts:52`). Thus 7° remains 7° in stage rotation but becomes 0° in venue rotation. Define one tolerance, eligible geometry, guide feedback and Alt policy for each transform, reused in both views.

6. **P2 — Collision acceptance depends on how the object is moved.** Individual stage 2D moves reject overlaps in `Editor.tsx:945`; group moves (`:904`) and 3D transforms (`:1076`) commit without that rejection. Venue transforms validate geometry without the same overlap rule. The same final pose can therefore be rejected in one view and accepted in another. Choose warning-only or blocking behavior per domain constraint and enforce it at the common command boundary, including numeric edits.

7. **P2 — Venue selection rotation is unavailable for some otherwise transformable selections.** Venue 2D rotation handles (`VenuePanel.tsx:558`) require exactly one wall, platform, stair, placeholder or overhead box. Multiple selected objects, cable corridors and keep-clear polygons have no 2D rotation handle, although `transformVenue` supports rotating their geometry and 3D offers a selection rotation gizmo. Stage offers a multi-object handle, but it excludes platforms through `selectionBundle` (`Editor.tsx:990`). Use a shared-pivot handle for every rotatable selection; points alone need no rotation control.

8. **P2 — Cancellation and shortcuts differ.** Venue accepts Backspace but stage only Delete; stage supports Ctrl/Cmd+Y redo but venue does not (`Editor.tsx:404`, `VenuePanel.tsx:395`). Escape cancels a stage gesture while retaining selection, but venue clears selection too. Venue `endPlanGesture(cancel)` ignores `cancel` for marquee (`:350`), so pointer cancellation still applies the rectangle's hits; stage checks the flag. Match the shortcut map and restore the pre-gesture selection on cancellation.

9. **P2 — Identical asset-library actions use different placement workflows.** `Editor.tsx:1079` creates a wall placement preview requiring a canvas click, while braces and model/placeholder assets are immediately committed at the venue centre. Choosing an asset therefore sometimes creates an undoable object immediately and sometimes does not. Use preview → click to place → Escape to cancel for each placeable asset, with the same repeat-placement policy.

10. **P2 — Navigation and resize affordances are not consistent.** Stage plan zoom anchors to the pointer and Shift-wheel pans (`Editor.tsx:1030`); venue zoom changes only the zoom factor and does not handle Shift-wheel (`VenuePanel.tsx:434`). The shared 3D toolbar exposes face resizing only when `onPushPull` exists (`PascalStageCanvas.tsx:105`), currently venue-only; `PushPullControls.tsx:20` explicitly restricts targets to venue nodes. Scene placeholders/models can have editable dimensions but no equivalent direct size tool. Share navigation behavior and make resizing capability explicit per object; fixed inventory dimensions can legitimately be read-only.

## Proposed common interaction contract

| Operation | Consistent behavior in venue and stage, 2D and 3D |
| --- | --- |
| Select | Click replaces; Shift-click toggles without starting a transform; inspector primary stays inside selection |
| Move | Dragging any selected member moves the entire selection, preserving orientation and relative placement |
| Rotate | One handle rotates the selection around the displayed common pivot; special hinges are explicit modes |
| Resize | Only resizable objects expose handles; fixed dimensions explain their restriction |
| Snap | Same geometry/tolerance policy and guides; Alt bypasses every automatic adjustment |
| Cancel | Escape/pointer cancellation restores the pre-gesture document and selection; no undo entry |
| Commit | One validated command and one undo entry per gesture; no conflicting command during preview |
| Clipboard/delete | Operate on exactly the highlighted selection; retain existing domain rules for IDs and dependencies |
| Navigate | Same pointer-anchored zoom, pan modifiers and fit-selection behavior |

Legitimate domain differences remain: venue edits publish an explicit version, while stage layouts autosave; physical inventory can constrain dimensions; permanent venue objects are edited in venue mode; dependency constraints can block deletion. These should affect capabilities and feedback, not silently change gesture meaning.

Implement selection unification and the transaction gate first, then common transform/snap/constraint policy, then placement and navigation. Add browser acceptance cases for each matrix row with a wall, platform, stair, placeholder and mixed selection in both planners. Include Shift-deselect → Delete, Delete during a 3D drag, Alt brace movement, mixed platform movement, and cancel → undo/save/reload. Existing geometry tests alone cannot establish UI parity.

## Storage

`server/assets/routes.ts:57` writes GLB bytes through `FileStorage`; `server/db/schema.ts:122` stores only the file ID, workspace ID and storage key. Venue reference files and generated PDFs use the same filesystem interface. There is no database binary payload to migrate.

This change adds a container backend with a separate named `asset-data` volume mounted at `/data/storage`, a production build and migration startup, plus cutover/backup instructions in README. The existing database-only development Compose workflow remains available. Existing host files must be copied into the volume before switching that installation to the container; external catalogue URLs remain external.

## Validation performed

- `docker compose --profile app config --quiet`: passed.
- `docker compose --profile app build backend`: passed, including TypeScript checks and production UI/server builds. Vite reports its existing large-chunk warning.
- `node --import tsx --test tests/integration/assets.test.ts`: both tests passed, covering authenticated GLB upload/download, app restart, archival, workspace isolation and invalid input.
- Two disposable backend containers: first wrote through the compiled `localFilesystem` adapter as UID 1000; the second recovered the same bytes from `asset-data` and removed the probe. This verifies persistence across container replacement and volume permissions.
- Production image smoke test: compiled `createApp` served `/api/health` and the built HTML successfully using request injection. This did not exercise an HTTPS proxy or switch the live installation to containers.
- `git diff --check`: passed. The initial review was source-only. Subsequent implementation validation includes the production build, 179 unit tests and 80 integration tests, and all 22 browser tests (21 in the full run, followed by the corrected long workflow test).
