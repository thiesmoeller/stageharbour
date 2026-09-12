# Stage planner / Pascal readiness review

Historical review before branch reconciliation. See [the implementation status](pascal-editor-status.md) for completed changes and remaining scope.

Reviewed 2026-09-11. Scope: current working tree, including untracked Pascal files, against HEAD `cf7cd95` (`slice/09-braces`); user requirements from this conversation, CONTEXT.md, ADR 0004 and the Pascal feasibility research. This is a review and recovery plan, not a claim that the findings are fixed.

## Verdict

The application has a useful Pascal rendering and asset foundation, but it is not yet a professional Pascal-enabled editor. Important planner interactions are incomplete, and the test suite does not protect them. Earlier completion claims about snapping, multi-selection and synchronized commands were too strong.

The principal integration mistake is the baseline: `implement/phase-one` at `768f9b4` is 45 commits ahead of current HEAD. Its tracked diff contains 117 changed files, including richer selection, snapping, groups, inventory, venue constraints and exports. Those features must be reconciled with the Pascal changes rather than recreated as small patches in the older editor. Availability on that branch does not establish that each feature is correct; its tests and behavior need to be rerun after integration.

Both histories also contain a different migration numbered 0005 and corresponding metadata. Reconciliation must cover database schema and migration history, not just Editor.tsx. The user's permission to reset local data removes the need to preserve that local account's old documents, but does not remove the need for a coherent fresh migration chain.

## Standards / correctness findings

No AGENTS.md or coding-standards file was present at the repository root. ADR 0004 requires validated commands and one authoritative history. The findings below are concrete behavior failures; split selection state and repeated per-object branching are architectural contributors, not standalone style violations.

1. **P1: Commands can create invalid documents.** `src/client/editor/Editor.tsx:223` adds rotation without normalization. Starting at 360° and clicking +15° produces 375°, outside the schema. Direct execution confirmed `layoutSchema.safeParse` rejects it and `pascalScene` throws a ZodError. Paste (`:114`) also bypasses coordinate and per-type object-count limits. Commit must validate before publishing to React, Pascal and autosave; invalid operations must preserve the previous valid document.
2. **P1: Mixed selection is not operationally consistent.** Marquee collects wall/brace/prop IDs (`Editor.tsx:202`), but its delete path filters only walls (`:102`). Dragging a selected wall replaces the multi-selection with that wall (`:147`). Selection highlights and the 3D interface still consume singular IDs. Thus a selection cannot reliably be seen, moved and deleted as one set.
3. **P1: Commands can target a different object from the inspector.** Adding or placing B after selecting A updates singular selection but leaves `selectedIds` unchanged (`Editor.tsx:235`). Copy and rotation prefer the stale IDs (`:107`, `:220`). A newly added brace or prop can also lack a usable rotation selection. One selection model must drive every entry point.
4. **P2: Angle snapping never changes the input.** `src/shared/snapping.ts:7` starts its nearest-angle reducer with the original rotation, which already has zero distance. Direct execution returned 14→14, 16→16, 89→89 and 91→91 rather than snapping. There are no neighbor-wall inputs, so position snapping is only grid rounding. The advertised Alt bypass is not wired into gestures.
5. **P2: Exact inspector edits can move geometry unexpectedly.** `Editor.tsx:87` applies position snapping on every submission, including labels and materials. An intentional 25 mm offset is rounded away when renaming the panel. Snapping belongs to deliberate placement/transform gestures, with explicit policy for numeric edits.

## Spec / experience findings

1. **Wall-to-wall planning remains unmet.** The user requested restored wall snapping. Endpoint/edge, centreline and neighboring-panel alignment are absent from the current implementation. The later branch contains more substantial snapping logic and tests to recover and assess.
2. **Multi-selection, rotation and clipboard are partial.** The failures above directly contradict the earlier claims of restored interactions. There is no rotation handle gesture; toolbar buttons rotate each selected object around its own center rather than rotating the arrangement around a shared pivot. Repeated paste always uses the same +500/+500 offset, stacking copies. Cut, selection-preserving group drag and modifier selection need defined behavior and tests.
3. **Pascal supplies real infrastructure, but interactive editing is not connected.** `PascalStageNodes.tsx:23` sets the scene read-only; `:103` declares only selectable capability. The only editor-package import in application source is `@pascal-app/editor/catalog`. Rendering, registry dispatch, GLB loading, finishes and catalog data are integrated. Pascal move/rotate/snap/placement tools and a command adapter are absent. ADR 0004 explicitly deferred the full shell; that limited implementation does not yet meet the user's broader experience goal.
4. **Important theatre features exist on the later branch but not here.** These include physical inventory assignments, wall types/openings, groups, stage centreline, venue tracing/outlines, levels/stairs, keep-clear/overhead constraints and richer construction exports. CONTEXT.md names many of them; current layout/venue schemas do not represent them. Restore their domain model before extending Pascal node coverage.
5. **Workspace polish is incomplete.** `style.css:80` overrides the earlier mobile single-column editor rule, reintroducing a 260px inspector column at narrow widths. The 3D canvas remains fixed at 280px on desktop. Width changes alone do not deliver a workspace with resizable views, usable full-screen modes and reliable narrow-screen behavior.

## Tests actually run

| Check | Result | What it establishes |
| --- | --- | --- |
| `npm run build` | Pass; large JS chunk warnings | Type checking and production compilation |
| `npm test` | Pass; runner reports seven test files | Existing geometry, history, autosave, config, assets and export checks |
| `npm run test:integration` | 36 passed | Auth/access, leases, database saves, assets and frozen exports |
| `npm run test:e2e` after fresh build | 9 passed, 1 failed | Existing browser workflows; not complete editor acceptance |
| Direct snapping probe | Incorrect results reproduced | Angular snapping defect |
| 375° layout/projection probe | Schema rejects; projection throws | Invalid command reaches a rendering failure path |

Browser failure: `tests/browser/workspace.spec.ts:15`. Error snapshot explicitly displays “Zu viele Versuche. Bitte warten Sie eine Minute.” The server limits email sign-ins to ten per minute (`src/server/identity/auth.ts:25`); the shared browser fixture/server and repeated logins can exhaust that allowance. Treat this as test isolation debt, not an unexplained flaky timeout. Preserve dedicated production-rate-limit tests when separating authenticated browser fixtures from login tests.

### Coverage gaps

- No current tests call snapping or exercise marquee selection, keyboard clipboard, rotation buttons/handles, Alt bypass or mixed-selection deletion/movement.
- `tests/browser/stage-view.spec.ts` asserts separately rendered HTML list attributes. Those can remain correct while the canvas is mirrored, empty or incorrectly transformed.
- Screenshots are written to disk, not compared with a baseline. There is no visual assertion for plan-left matching audience-left.
- Catalog GLBs are replaced by a cube in the asset test. That is useful isolation, but does not establish real model offset/orientation/scaling correctness.
- No configured Firefox/WebKit or explicit GPU/fallback matrix; no representative large-scene performance budget or editor narrow-screen coverage.
- Playwright serves `dist/web`, while `test:e2e` itself does not build. A standalone run can validate stale source. No repository CI workflow was found.

## Recovery and implementation order

1. **Recover one complete baseline.** Preserve the working Pascal integration and reconcile it onto the phase-one planner, including schema, migrations and tests. Inventory all recovered behaviors and run their tests before adding new UI. Do not blindly replace the current editor or merge migration journals.
2. **Establish one command and selection boundary.** Share typed object selection across plan, Pascal and inspector. Route add/move/rotate/delete/copy/cut/paste through validated operations with begin/preview/commit/cancel semantics, one undo entry per gesture, cancellation that restores the original, and one autosave authority. Selection-only clicks must never change coordinates.
3. **Enable Pascal theatre editing.** Use the installed 0.9.2 registry capabilities (movable, rotatable, snappable, duplicable, deletable, groupable) through the command boundary. Connect handles, placement previews and selection in both views. Preserve separate physical panels; do not apply architectural auto-joining. Prototype the smallest wall move/rotate adapter before committing to the full Next-dependent editor shell.
4. **Complete asset and theatre behavior.** Preserve original inventory identities and group/connection semantics during copies; preserve units, surface elevation, model transforms and material assignments through undo/save/reload/export. Add recoverable loading/error states and measured performance for imported assets.
5. **Polish the workspace after interaction correctness.** Resizable view/inspector regions, focus/full-screen modes, fit/zoom controls, clear selection and snap guides, pointer rotation and concise shortcuts. Verify asymmetric scenery on both renderers and target screen sizes.

### Acceptance gates

| Area | Required evidence before calling it complete |
| --- | --- |
| Snapping | Drag two rotated walls into endpoint/edge contact; show live guide; verify exact mm result, Alt bypass, tolerance, cancel and undo |
| Selection | Rubberband mixed types, modifier add/remove, highlight all in 2D/3D, move and rotate around a shared pivot, delete all; undo each action |
| Clipboard | Keyboard and toolbar copy/cut/paste with correct focus handling, identities, asset references, offsets and collection limits |
| Valid commands | Boundary angles/coordinates/counts cannot crash projection or create an unsavable draft; inspector label changes preserve pose |
| Pascal bridge | 2D and 3D gestures each produce one planner command; no second history; correct units and stable selection after edits |
| Rendering | Deterministic asymmetric fixtures with approved screenshots or projected screen-coordinate assertions; GLB transforms and fallback renderer checks |
| Persistence | Every command survives save/reload, undo/redo, failed save and lease loss without losing references |
| Test infrastructure | Fresh build is mandatory, login fixtures are isolated, all suites pass, supported browser/rendering matrix and performance budgets are recorded |

## Review totals

Standards/correctness: five finding groups; most severe is invalid transform commands reaching Pascal projection. Spec/experience: five finding groups; most severe is the absent coherent interaction layer on top of an older planner baseline. Passing the existing tests is insufficient evidence of professional-editor readiness.
