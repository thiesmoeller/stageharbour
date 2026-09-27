# First public release: current-state UI/UX code review

Reviewed 27 September 2026 at `986ef21`, against the complete working tree rather than a branch diff. Application code was not changed. This report and its screenshots are the review deliverables.

**Recommendation: hold the public release for the four P1 findings.** The main workflows are substantially more coherent than the earlier September review, but cancellation, modal isolation, and venue template saves can still change or lose data contrary to what the interface promises. Resolve the P2 workflow defects before calling the first-user experience consistent.

## Evidence and coverage

- `npm run build`: passed, including TypeScript checks. The main JavaScript chunk is approximately 2.96 MB minified / 822 KB gzip; this is a loading concern to measure, not proof of poor runtime performance.
- `npm test`: 43 test files passed.
- `npm run test:integration`: 98 tests passed against disposable PostgreSQL databases.
- `npx playwright test`: all 35 existing Chromium browser tests passed.
- Additional disposable-workspace browser probes reproduced S01, S02, S03, S06–S08, S10, F03–F05. A targeted API scenario reproduced F01 and confirmed the collection replacement in F02. S04, S09, F06 and F07 are source-traced findings, not claimed browser reproductions. S05 combines source and visual inspection.
- Inspected authentication/account/admin surfaces, production and scene creation, navigation, scene and venue editing, inventory, templates, exports, persistence and concurrency behavior. The existing browser suite additionally exercised invitations, models/catalogue placement, surfaces, 3D manipulation, venue facilities, failed saves and lease recovery.
- Captured the current scene editor at [1440 px desktop](release-ui-ux-review-2026-09-27/scene-desktop.png) and [390 px mobile](release-ui-ux-review-2026-09-27/scene-mobile.png). The narrow capture had no horizontal document overflow. These are Chromium viewport checks, not physical touch-device testing.

This is a source-led release review with automated journeys and targeted interaction checks. It is not an exhaustive security audit, screen-reader/contrast certification, physical print-scale audit, live Pocket ID/Brevo delivery test, performance benchmark, or crew usability session. Existing green tests establish their covered behavior, not absence of the defects below.

Reference documents: [domain model](../CONTEXT.md), [previous UX plan](ui-ux-review.md), [PDF export plan](pdf-export-plan.md), [Bestand plan](bestand-workspace-plan.md), feature breakdown and ADRs. The earlier UX document contains **proposed product conventions**, not a formally adopted coding-standard document; recommendations against those conventions are identified as such. No generic code smell is elevated to a release defect merely because a component is large.

## Standards

Interaction consistency, truthful feedback and shared UI behavior. P1 means a release blocker because ordinary interaction can unexpectedly change/lose data. P2 means an actionable workflow or usability defect.

| ID | Priority | Finding | Evidence |
| --- | --- | --- | --- |
| S01 | P1 | Cancelling the discard dialog does not cancel deletion; pending inputs have already been lost. | Browser reproduced |
| S02 | P1 | Editor keyboard shortcuts modify the document behind a modal dialog. | Browser reproduced |
| S03 | P2 | Venue name edits are excluded from dirty status and navigation protection. | Browser reproduced |
| S04 | P2 | Venue stage-deck dimensions snap on every keystroke, unlike buffered scene fields. | Source traced |
| S05 | P2 | Core tool captions and save feedback remain too small for the proposed readability target. | CSS and screenshots |
| S06 | P2 | Help contents links leave Help and open Productions. | Browser reproduced |
| S07 | P2 | Successful logo uploads also report failure. | Browser reproduced |
| S08 | P2 | Account navigation opens an empty content area without Pocket ID. | Browser reproduced |
| S09 | P2 | Access revocation bypasses the application's destructive-action confirmation pattern. | Source traced |
| S10 | P2 | Confirming “Verwerfen und wechseln” can bounce back to the dirty editor and reopen confirmation. | Browser reproduced |

### S01 — Guard the mutation before asking to discard inputs

[Editor.tsx:448](../src/client/editor/Editor.tsx#L448), cut at 458, keyboard undo/redo at 493, keyed wall inspector at 1219.

Select a wall, change X from 4000 to 4500 without applying, then click **Wand löschen**. The wall disappears before the discard dialog is answered. Click **Weiter bearbeiten**: it remains deleted. The probe counted zero walls both before and after cancellation. `remove()` commits before `clearSelection()` asks whether pending inputs may be discarded; cut follows the same ordering. Autosave can persist the deletion. Undo may recover geometry, but not the discarded field draft.

Source inspection also found mutation paths through undo/redo and dragging an already-selected object that can remount inspectors keyed by serialized object values without protecting their inputs. Put the pending-input decision before the entire command and retain drafts through unrelated rerenders. Acceptance: cancellation preserves both object and input values; confirmation performs one undoable command. This implements the earlier U01 input-protection proposal.

### S02 — Make modal interaction exclusive

[interactionKeys.ts:5](../src/client/editor/interactionKeys.ts#L5), [Editor.tsx:480](../src/client/editor/Editor.tsx#L480), [useModalFocus.ts:26](../src/client/editor/useModalFocus.ts#L26).

Select a wall, open **Wandtypen wählen**, leave focus on the dialog's close button, then press Delete. The wall is deleted while the dialog stays open; the probe observed one wall become zero. The shared command decoder ignores text inputs, but not modal targets. Focus trapping handles Tab and Escape, while global editor commands still receive other keys.

Suspend document commands while a modal owns interaction, and make background content inert where appropriate. Acceptance: Delete, Cut and Undo inside a modal never mutate the underlying scene or venue; closing restores focus. Audit every overlay using the same mechanism, not only the wall-type picker. This is a behavioral accessibility defect, not just missing ARIA.

### S03 — Include venue names in pending-change protection

[VenuePanel.tsx:1536](../src/client/editor/VenuePanel.tsx#L1536); dirty reporting at 197 and saved status at 972.

Open **Umriss**, edit **Name der Spielstätte**, then use the venue Back button. The status still says **Spielstättenfassung gespeichert**, Back remains enabled, and navigation silently loses the name. The probe confirmed no dialog and the original name on the overview. `nameDraft` lives outside the document draft and is saved by a separate button.

Track name edits as pending and distinguish their save state, or include them in one clearly scoped save action. Acceptance: leaving or reloading protects the changed name, and “saved” cannot describe unapplied visible fields. Do not silently redefine publication/version semantics to solve this.

### S04 — Buffer numeric entry before applying snapping

[VenuePanel.tsx:1382](../src/client/editor/VenuePanel.tsx#L1382), input updates at 1418; compare [PlatformInspector.tsx:25](../src/client/editor/PlatformInspector.tsx#L25).

For a venue platform with **Bühnenelement** selected, the controlled width/depth fields call `Number(value)` and snap immediately on every change. Clearing a field or typing the first digit of 2000 immediately writes a snapped value back into the field, interfering with normal sequential typing. Elevation has the same issue. The corresponding scene inspector waits for Apply.

Keep raw input while editing; validate and snap on the agreed commit boundary, with one undo entry. Acceptance: select-all and type `2000` normally, enter a temporary incomplete number, cancel, and undo one completed edit in both editors. A size/leg-height selector could also make the constrained catalogue choices clearer.

### S05 — Increase readability of core editor controls

[workspace.css:119](../src/client/workspace.css#L119), save status at 74 and further compact captions at 263.

Tool captions are 8 px and save status is 10 px. In the current desktop capture the loudspeaker caption is truncated and several placement tools reuse the same generic icon, making text recognition particularly important. Narrow mode keeps very small labels too.

Adopt readable secondary text and let the rail or tool grouping accommodate it. The earlier UX plan proposes 12 px secondary labels; that is a design target, **not a claimed WCAG font-size rule**. Acceptance: a new user can identify each insertion tool and distinguish saved/pending/error states at normal zoom, including long German labels. Verify touch target sizes on hardware separately.

### S06 — Separate Help anchors from application routing

[Help.tsx:13](../src/client/Help.tsx#L13), [main.tsx:37](../src/client/main.tsx#L37), [workspaceRoutes.ts:13](../src/client/workspaceRoutes.ts#L13).

Open Help and click **Wandoberflächen** in the contents. The URL becomes `#hilfe-oberflaechen`; the router treats it as an unknown workspace route and displays Productions. All seven contents links have this conflict. The existing Help test checks that links exist but never clicks them.

Use route-compatible section anchors or explicit section scrolling that preserves the Help route. Acceptance: each link scrolls to its section, stays on Help, and works with reload and Back/Forward under the chosen URL model.

### S07 — Do not show failure after a successful logo upload

[main.tsx:380](../src/client/main.tsx#L380).

Upload a valid PNG in Administration. The logo changes and **Logo wurde übernommen** appears, but so does **Das Logo konnte nicht übernommen werden**. After awaiting upload, `event.currentTarget` is no longer the form; resetting through it throws and enters the upload-failure handler.

Capture the form before awaiting, as the invitation form already does. Acceptance: successful upload has exactly success feedback, clears the file input, and persists after reload; a rejected upload has only failure feedback. The existing branding test asserts success without checking absence of alerts.

### S08 — Give password-only accounts a meaningful destination

[main.tsx:330](../src/client/main.tsx#L330), [main.tsx:438](../src/client/main.tsx#L438).

**Mein Konto** is always present, but its only child returns `null` when OIDC is disabled. In the default test configuration the selected destination contains no heading, account explanation or actions; the probe found zero account sections.

Show basic account information and an explicit explanation of available sign-in methods, or remove/rename the destination when it offers nothing. Acceptance: every visible navigation destination has meaningful content and a clear state in both password-only and OIDC configurations. This does not require adding unrelated account-management features.

### S09 — Confirm access revocation consistently

[main.tsx:503](../src/client/main.tsx#L503), the button at 520; compare the existing scene/venue/export delete dialogs.

**Zugang entziehen** immediately sends DELETE, with no person-specific confirmation or undo, unlike less consequential document deletion. An accidental click can revoke an active member and their editing access. Last-administrator protection does not protect other members from a mistaken click.

Use the existing confirmation component, name the affected member and consequence, and disable the action while pending. Acceptance: cancellation sends no mutation; confirmation removes only the named member and gives clear feedback. This follows the earlier U12 destructive-action proposal.

### S10 — Use one owner for confirmed route departure

[Plans.tsx:98](../src/client/editor/Plans.tsx#L98), [main.tsx:76](../src/client/main.tsx#L76); analogous guard in [Venues.tsx:61](../src/client/editor/Venues.tsx#L61).

With unapplied wall inputs, navigate to `#/produktionen` through hash/Back navigation, then accept **Verwerfen und wechseln**. The top-level router accepts the destination, but the Plans effect sees the still-dirty document and restores the scene hash. The probe remained in the scene with another confirmation dialog visible.

Coordinate approved departure, draft discard and route application in one transaction; the child must not veto a departure already approved by the user. Acceptance: one cancel leaves route and draft intact; one confirm leaves once, clears the appropriate draft state and releases the lease. Cover scene-to-list, scene-to-scene and venue routes.

## Spec

Requirements and correctness against the domain model and feature plans, assessed separately from shared UI conventions.

| ID | Priority | Finding | Requirement |
| --- | --- | --- | --- |
| F01 | P1 | A template-only save can republish obsolete venue geometry. | Export changes remain local except explicit template persistence. |
| F02 | P1 | Saving one export template removes its siblings. | Venue templates are reusable shared resources. |
| F03 | P2 | Export Retry clears the error without retrying. | Actionable errors and retry. |
| F04 | P2 | Layout editing is unavailable for the default automatic layout. | Customization through Layout bearbeiten. |
| F05 | P2 | Download can return a different revision from the displayed preview. | Predictable preview/issued output. |
| F06 | P2 | A new stocked wall type cannot be chosen for its first panel. | Manage panels and stocked types together in Bestand. |
| F07 | P2 | Existing panel labels and repair notes cannot be corrected. | Platten list/create/edit/availability. |

### F01 — Preserve current geometry when saving a shared template

[server/venues/routes.ts:277](../src/server/venues/routes.ts#L277).

Reproduction: keep a scene pinned to venue V1; independently publish V2 with a new ceiling height; save an export template from the V1 scene. The template route constructs a new venue version by spreading `pinned.geometry`, then makes that version the newest and retargets the issuing adaptation. In the API probe V2 had ceiling height 7777; after the template save, the newest version had no ceiling height. This is a real rollback of the latest published geometry through a template-only action, though the historical versions remain stored.

The export plan says: **“Keep export adjustments local to the document unless explicitly saved as a venue report template.”** Template saving should not publish unrelated stale geometry or silently decide whether an old adaptation adopts newer geometry. Separate template persistence from geometry publication, or implement explicit version/conflict handling that preserves both current geometry and adaptation pin semantics.

Acceptance: saving a template from an old pin leaves the newest venue's ceiling, outline, fixtures and other geometry unchanged. Any adaptation update is an explicit, explained choice. Test with an independently published newer version, not just a scene already on the latest version.

### F02 — Preserve sibling templates when saving one layout

[ExportWorkspace.tsx:431](../src/client/editor/ExportWorkspace.tsx#L431), [Editor.tsx:917](../src/client/editor/Editor.tsx#L917), [server/venues/routes.ts:279](../src/server/venues/routes.ts#L279).

The save button passes `[currentTemplate]`; the callback forwards it unchanged; the server replaces the entire `reportTemplates` collection. With templates A and B, saving edited A leaves only A. The targeted API scenario seeded both templates and confirmed only the updated A remained after the singleton payload produced by the UI.

The domain model defines a report template as **“A reusable construction-sheet layout … that belongs to a venue.”** Save/update one template by identity while preserving siblings; handle stale concurrent collections explicitly. Acceptance: saving A keeps B and every unaffected template unchanged, including names/pages/frames. Historical version retention is not an adequate substitute for preserving the active template collection.

### F03 — Make the export Retry button invoke work

[ExportWorkspace.tsx:442](../src/client/editor/ExportWorkspace.tsx#L442), preparation effect dependencies at 170.

Force the preview preparation request to fail, then click **Erneut versuchen**. The handler only changes `outdated` and `error`; neither is a preparation dependency. The probe recorded one request before and one request after clicking Retry, with the status left at **Vorschau veraltet**. Closing/reopening or changing a setting is currently needed to trigger preparation again.

The export plan explicitly requires **“actionable errors, retry.”** Invoke preparation through an explicit retry action/token and choose the appropriate action for preparation, issuance and download failures. Acceptance: a transient failure followed by Retry issues a new request and can reach Ready without changing the user's settings.

### F04 — Initialize editable pages for automatic layouts

[ExportWorkspace.tsx:414](../src/client/editor/ExportWorkspace.tsx#L414), template application at 180.

A fresh workspace defaults to **Automatischer Satz**. Clicking **Layout bearbeiten** activates the button but shows no editor: the render condition requires `customPages`, populated by selecting an existing template. The browser probe confirmed the active button and absence of editing controls.

The export plan says **“Expose customization through Layout bearbeiten.”** Initialize editable pages from the actual resolved automatic composition, or clearly explain and offer the prerequisite workflow. Acceptance: a first-time user can click this action and edit the layout currently being previewed without needing a pre-existing venue template.

### F05 — Bind Download to the artifact the user sees

[ExportWorkspace.tsx:462](../src/client/editor/ExportWorkspace.tsx#L462), `download()` at 199 and `issued` state at 90.

Issue revision A, change name or scale, wait for preview B, then click the preview toolbar's **Herunterladen**. It passes the retained `issued` revision A, while **PDF öffnen** opens B. The browser probe had **Preview B** in the current name field but downloaded `konstruktionsplan-Issued_A.pdf`.

This contradicts the export plan's predictable-export and reviewed-artifact contract. Bind toolbar actions to the displayed prepared artifact, or make issued versus preview downloads visibly separate. Acceptance: open/download refer to the same artifact after settings change; earlier revisions remain available through explicitly labelled history actions.

### F06 — Populate panel creation from the stocked type catalogue

[InventoryPanel.tsx:24](../src/client/editor/InventoryPanel.tsx#L24), creation at 53, select options at 96.

Inventory responses contain `types` and `panels`, but this component retains only panels. Its type selector uses built-ins plus types already attached to a panel. Consequently a custom type created under **Bestand → Wandtypen** is unavailable for creating its first physical panel. The creation lookup also resolves only through existing panels, so changing the options alone is insufficient.

The Bestand plan promises **“Platten … list / create / edit / availability”** and **“list / create / edit stocked types.”** Retain the catalogue and resolve selected type IDs against it. Acceptance: create a custom type with a distinctive size/opening, switch tabs, create its first panel, and verify that exact type is stored and later assignable to a compatible scene wall.

### F07 — Expose editing for existing panel metadata

[InventoryPanel.tsx:84](../src/client/editor/InventoryPanel.tsx#L84); existing server update endpoint at [inventory/routes.ts:91](../src/server/inventory/routes.ts#L91).

The panel list exposes only an availability checkbox. Labels and repair notes are entered on creation and then displayed as text. A mistyped permanent label or stale repair note cannot be corrected through the UI. The API already supports note changes; label correction additionally requires extending its update contract.

The first-slice Bestand plan explicitly includes **“list / create / edit / availability.”** Add a leased edit flow preserving physical panel identity and assignments, with duplicate-label feedback. Acceptance: change a label and note, reload, and verify existing scene assignments still point to the same panel.

## Consistency and first-user journey assessment

| Area | Current strengths | Remaining first-user friction |
| --- | --- | --- |
| Sign-in and membership | German sign-in, invitation, reset, role checks and retry paths; automated coverage. | Empty account destination, contradictory branding feedback, revocation without confirmation. Real identity-provider/mail delivery still needs deployment validation. |
| Productions and scenes | Clearer production/scene creation, existing venue reuse, scoped actions, stable scene URLs. | Confirmed dirty navigation is contradicted by child guards. Large-workspace browsing remains unmeasured. |
| Scene editing | Linked plan/3D, selection inspector, explicit units, pending-input feedback, undo and autosave. | Command paths bypass draft protection; modals do not isolate shortcuts. Small labels reduce discovery. |
| Venue editing | Separate publication model, version pins, undo/discard and independent venue work. | Rename save state differs from geometry save state; numeric fields commit differently from scene fields. |
| Bestand | Dedicated home separates physical stock and wall types from design. | Custom-type-to-first-panel flow is broken; existing metadata cannot be edited. |
| Object/model/surface library | Existing browser tests cover GLB/catalogue placement and per-face surface assignment. | Keep terminology consistent between this library and Bestand; no representative novice session has established discoverability. |
| Sheet templates and exports | Actual PDF preparation, immutable issuance, history, scale/paper and 3D capture have passing tests. | Template saves affect unrelated resources; retry/layout/download actions violate their labels. |
| Help and narrow screens | Dedicated Help and one active canvas on narrow screens are improvements. | Help links break routing; microtext and generic icons remain. Narrow capture passes overflow checks, not ergonomic validation. |

Do not repeat the earlier review's already-addressed claims that scenes lack addresses, administration remains on the production overview, there is no New Scene action, or the export UI has no real PDF preview. Those are materially improved. Remaining wording drift such as **Raumsicht/Raumansicht**, **Passend/Bühne einpassen**, and implementation terms in Help deserves a final German copy pass, but is secondary to the concrete failures above.

## Focused remediation and acceptance

1. **Protect document state:** fix S01/S02 and F01/F02 before release. Add regression scenarios for cancel-before-mutation, shortcuts inside every modal, old venue pins and multiple templates.
2. **Make save/navigation/export actions truthful:** S03/S04/S07/S10 and F03–F05. Share a buffered form-commit policy and one confirmed-departure flow; bind preview, issue, open and download to identifiable artifacts.
3. **Finish first-use paths:** S06/S08/S09 and F06/F07. Test a fresh workspace from invitation through custom stock, first scene and corrected panel metadata to downloaded construction plan.
4. **Validate readability and language:** S05 plus a scoped terminology pass. Use desktop, narrow viewport and real touch input; then ask representative crew members to complete tasks without coaching.

The passing suite missed these defects because it commonly verifies presence or success without the next consequential interaction: Help links are present but not activated; branding succeeds without an assertion that no error appears; stock types and panels are tested independently; export downloads come from history after issuance, not after a changed preview; the template integration test uses one template on a current pin. Add behavioral tests at those boundaries rather than more assertions mirroring implementation.

The code-review skill's `docs/agents/issue-tracker.md` configuration is absent. Local product documents were sufficient for this review. Run `/setup-matt-pocock-skills` when configuring issue-tracker-based review/publishing; no issue creation or application changes were performed here.

**Standards: 10 findings, worst P1 (pending-input loss and modal background edits). Spec: 7 findings, worst P1 (obsolete geometry publication and sibling-template removal).**
