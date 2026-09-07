# Proposed phase-one issue breakdown

Draft for review; these are not yet published tracker issues. Sources: [project plan](./project-plan.md), [product decisions](./planner-decisions.md), [glossary](../CONTEXT.md), and [backend ADR](./adr/0002-typescript-postgresql-backend.md).

AFK means implementation can proceed without human input once blockers are complete. HITL includes an explicit human measurement or crew review. Proposed decisions within acceptance criteria are part of this breakdown's review. Every implementation slice includes its browser workflow, API/storage behavior, and focused integration verification; deployment and pilot slices verify the complete system. All UI text is German and workspace authorization applies throughout. No existing parent issue exists.

## Review index

1. **Enter a private workspace with password sign-in** — AFK; blocked by none.
2. **Create and edit a saved rectangular stage layout** — AFK; blocked by 1.
3. **Inspect the saved layout in linked Three.js views** — AFK; blocked by 2.
4. **Export a frozen A4 overhead construction plan** — AFK; blocked by 2.
5. **Define rectangular door and window wall types** — AFK; blocked by 3, 4.
6. **Represent the group's arch-opening panel** — HITL; blocked by 5.
7. **Assign available inventory panels to scene placements** — AFK; blocked by 5.
8. **Label panels for assembly and record connections** — AFK; blocked by 7, 4.
9. **Place weighted rear braces with measurable footprints** — AFK; blocked by 3, 4.
10. **Draw a measured venue and trace a calibrated reference** — AFK; blocked by 2, 4.
11. **Arrange sets across floor levels, platforms, and stairs** — AFK; blocked by 10, 3, 9.
12. **Warn about ceiling and overhead-obstruction conflicts** — AFK; blocked by 11.
13. **Mark keep-clear zones and show overlap warnings** — AFK; blocked by 11.
14. **Annotate venue power, audio, and routing possibilities** — AFK; blocked by 10, 4.
15. **Move and rotate explicitly grouped set pieces** — AFK; blocked by 3, 8.
16. **Align walls with snapping guides and a stage centreline** — AFK; blocked by 15, 10.
17. **Copy, cut, and paste layout selections** — AFK; blocked by 15, 7.
18. **Place furniture, people, and audio placeholders** — AFK; blocked by 11, 13, 15.
19. **Duplicate scenes while retaining physical panel identities** — AFK; blocked by 8, 17.
20. **Reuse a base design in a different venue** — AFK; blocked by 19, 12, 18.
21. **Save and use read-only scene templates** — AFK; blocked by 20.
22. **Apply venue updates explicitly to existing adaptations** — AFK; blocked by 20, 4.
23. **Print scaled A4/A3 plans across tiled pages** — AFK; blocked by 4.
24. **Export front elevations for selected wall groups** — AFK; blocked by 5, 15, 23.
25. **Export a complete scene construction package and parts list** — AFK; blocked by 8, 9, 12, 13, 14, 18, 19, 23, 24.
26. **Sign in through Pocket ID and manage linked accounts** — AFK; blocked by 1.
27. **Invite members and recover passwords through Brevo** — AFK; blocked by 1.
28. **Protect editing with exclusive leases and stale-write checks** — AFK; blocked by 2.
29. **Install and restore a complete test instance** — AFK; blocked by 22, 25, 26, 27, 28.
30. **Validate the real inventory and crew construction workflow** — HITL; blocked by 6, 16, 21, 25, 29.

## Issue bodies

### 01. Enter a private workspace with password sign-in

Type: AFK

#### What to build

Create the first German-language application workflow: bootstrap an administrator, sign in, and view the private workspace. Establish the chosen backend stack, browser shell, database migrations, and workspace ownership through this path.

#### Acceptance criteria

- [ ] Administrator bootstrap is configured privately; public sign-up cannot grant membership.
- [ ] Authenticated members see their workspace; unauthenticated requests and cross-workspace identifiers are rejected.
- [ ] Role checks are enforced server-side; sessions can be ended. Select and document the browser framework and compatible stable dependencies during this slice.

#### Blocked by

None - can start immediately

### 02. Create and edit a saved rectangular stage layout

Type: AFK

#### What to build

Create a production, a simple venue, a venue adaptation, and a scene containing rectangular wall placements. Edit dimensions, position, and rotation in a top-down plan using the command stack.

#### Acceptance criteria

- [ ] Creation, movement, rotation, and deletion support session undo/redo; one drag is one undoable action.
- [ ] Autosave exposes pending, saved, and failed states; reloading restores the saved layout but not undo history.
- [ ] Use schema-versioned layout documents, explicit coordinate/unit conventions, immutable venue-version references, and revision-checked saves. The default wall is 1200 × 2400 × 28 mm; dimensions remain configurable.

#### Blocked by

- Draft slice 1

### 03. Inspect the saved layout in linked Three.js views

Type: AFK

#### What to build

Display the same saved scene in a linked Three.js view with orbit controls and an audience viewpoint, while retaining precise top-down editing.

#### Acceptance criteria

- [ ] Edits, undo/redo, and reloads produce matching dimensions and positions in both views.
- [ ] Front/back orientation is visible; geometry calculations are independent of rendering.
- [ ] A fixture with rotated walls verifies shared transforms. Lighting-planning controls and framing details are absent.

#### Blocked by

- Draft slice 2

### 04. Export a frozen A4 overhead construction plan

Type: AFK

#### What to build

Export a named frozen construction plan revision as a scaled vector A4 PDF from the saved layout. Provide an export history and download action.

#### Acceptance criteria

- [ ] The snapshot preserves the design, resolved wall geometry, and venue information used; later source edits cannot change it.
- [ ] Every page identifies revision and date; the plan includes dimensions, scale, and audience viewing direction.
- [ ] Numeric PDF coordinates verify a known distance at the selected scale. Export work runs off the API event loop and exposes failure and retry from the same frozen input; viewers download existing exports only.

#### Blocked by

- Draft slice 2

### 05. Define rectangular door and window wall types

Type: AFK

#### What to build

Create and edit reusable wall element types with configurable outer dimensions, thickness, and exactly positioned rectangular openings; place them in scenes and export them.

#### Acceptance criteria

- [ ] Reject invalid dimensions and openings outside the panel; allow multiple valid openings.
- [ ] Openings agree in saved layouts, top-down/3D views, and exports; edits preserve frozen historical geometry.
- [ ] Door handing, swing simulation, and rear timber construction are excluded.

#### Blocked by

- Draft slice 3
- Draft slice 4

### 06. Represent the group's arch-opening panel

Type: HITL

#### What to build

Confirm the arch profile with the user, then add a parameterized opening with straight sides and a rounded top through wall type editing, placement, rendering, and export.

#### Acceptance criteria

- [ ] Obtain the profile convention and required measurements or explicitly approved example dimensions; do not invent measurements for the real panel.
- [ ] Support the arch panel's 250 mm thickness and validate the opening against its outer dimensions.
- [ ] Save/reload, 3D, and exported drawings agree for the approved profile.

#### Blocked by

- Draft slice 5

### 07. Assign available inventory panels to scene placements

Type: AFK

#### What to build

Maintain physical panels with permanent panel labels, wall element types, availability, and repair notes. Assign panels to previously unassigned placements and expose stock warnings.

#### Acceptance criteria

- [ ] Unassigned placements remain editable; unavailable panels do not count as usable stock.
- [ ] Warn on incompatible, unavailable, or duplicate panel assignment within a scene; preserve existing references when availability changes.
- [ ] Document the reported 29-panel inventory without fabricating real IDs or unknown dimensions; fixtures are clearly examples.

#### Blocked by

- Draft slice 5

### 08. Label panels for assembly and record connections

Type: AFK

#### What to build

Show permanent panel labels beside initial assembly numbers and front/back markers in the editor and PDFs. Record panel connection references and rigging notes.

#### Acceptance criteria

- [ ] Left-to-right numbering uses the audience viewpoint and venue viewing direction; assembly numbers remain distinct from physical IDs and do not silently renumber when later scenes rearrange panels.
- [ ] Connections are explicit metadata and do not implicitly move neighbouring panels.
- [ ] Frozen exports retain labels and notes as issued; connection compatibility is presented as manually verified.

#### Blocked by

- Draft slice 7
- Draft slice 4

### 09. Place weighted rear braces with measurable footprints

Type: AFK

#### What to build

Define adjustable weighted rear braces and place them behind panels in saved scenes with visible dimensions and footprints in the editor and construction plans.

#### Acceptance criteria

- [ ] Footprint and height can be entered without manufacturing a real equipment default.
- [ ] Placement participates in undo/redo, saving, and 3D inspection; the PDF shows footprint and position.
- [ ] Placement remains manual; no structural stability recommendation is generated.

#### Blocked by

- Draft slice 3
- Draft slice 4

### 10. Draw a measured venue and trace a calibrated reference

Type: AFK

#### What to build

Edit an irregular venue outline with exact dimensions and optionally upload an image or select a PDF page to trace after calibration.

#### Acceptance criteria

- [ ] Two reference points and a known distance establish a reproducible scale; outlines and calibration survive reload.
- [ ] Uploads and references are workspace-authorized and stored persistently; invalid files and degenerate geometry are rejected.
- [ ] The derived measured outline appears in saved scenes and exports; source files remain available to frozen revisions that reference them.

#### Blocked by

- Draft slice 2
- Draft slice 4

### 11. Arrange sets across floor levels, platforms, and stairs

Type: AFK

#### What to build

Represent permanent venue platforms/stairs and movable production units so a performance area can span the audience floor and raised stage.

#### Acceptance criteria

- [ ] Each supporting surface has an outline and elevation; stairs connect levels using configurable dimensions.
- [ ] Wall and brace placement uses an explicitly selected supporting surface; ambiguous edge placements show a diagnostic rather than silently floating or changing height.
- [ ] Permanent features stay with the venue; movable units participate in scene commands, persistence, 3D, and exports.

#### Blocked by

- Draft slice 10
- Draft slice 3
- Draft slice 9

### 12. Warn about ceiling and overhead-obstruction conflicts

Type: AFK

#### What to build

Define a venue ceiling limit and rectangular overhead boxes, then warn when placed set geometry violates local clearance.

#### Acceptance criteria

- [ ] Boxes have position, dimensions, bottom height, and thickness; multiple boxes represent complex structures.
- [ ] A panel that fits on the audience floor but hits a duct from a raised stage is detected using local floor height.
- [ ] Warnings appear in the editor and exported revision; saving remains possible. Geometric checks make no structural certification claim.

#### Blocked by

- Draft slice 11

### 13. Mark keep-clear zones and show overlap warnings

Type: AFK

#### What to build

Draw labelled keep-clear polygons with reasons and show conflicts with panels, braces, and movable pieces.

#### Acceptance criteria

- [ ] Zones are tied to the intended floor/surface so objects on unrelated levels are not conflated.
- [ ] Overlap warnings identify the zone and object, update after edits, and survive export as unresolved warnings.
- [ ] Users can save conflicted drafts; tests cover rotated panels, braces, and boundary contact with a documented tolerance.

#### Blocked by

- Draft slice 11

### 14. Annotate venue power, audio, and routing possibilities

Type: AFK

#### What to build

Place labelled power/audio connection pins and drawable cable-routing corridors with optional notes.

#### Acceptance criteria

- [ ] Pins and corridors can be created, edited, saved, and reopened in the venue workflow.
- [ ] Annotations are visible in the plan and construction export.
- [ ] These represent infrastructure and possible routes; no electrical calculations or detailed cable inventory is introduced.

#### Blocked by

- Draft slice 10
- Draft slice 4

### 15. Move and rotate explicitly grouped set pieces

Type: AFK

#### What to build

Select multiple pieces, form explicit groups, and move or rotate the arrangement while retaining individual editing.

#### Acceptance criteria

- [ ] Relative transforms are preserved; group edits are atomic undo/redo actions.
- [ ] Choose and document a predictable group pivot; numeric transforms and saved/reloaded groups agree.
- [ ] Connections alone never force grouping or neighbour movement.

#### Blocked by

- Draft slice 3
- Draft slice 8

### 16. Align walls with snapping guides and a stage centreline

Type: AFK

#### What to build

Define a venue stage centreline and show optional alignment guides while positioning wall edges and groups.

#### Acceptance criteria

- [ ] Centreline position/orientation are configurable per venue and persist with venue data.
- [ ] Guides support wall-edge alignment and centreline alignment, with a way to temporarily bypass snapping.
- [ ] Document tolerances; verify snapping under rotated venues and grouped movement. Mirroring is excluded.

#### Blocked by

- Draft slice 15
- Draft slice 10

### 17. Copy, cut, and paste layout selections

Type: AFK

#### What to build

Provide selection clipboard actions through the editor command stack, persistence, and inventory-aware placement.

#### Acceptance criteria

- [ ] Copy within a scene creates new placements with no physical panel assignments; cut/paste preserves identities.
- [ ] Groups and internal connection references are remapped consistently; references to uncopied pieces are not left dangling.
- [ ] Undo/redo restores both geometry and assignment state; shortcuts respect text inputs.

#### Blocked by

- Draft slice 15
- Draft slice 7

### 18. Place furniture, people, and audio placeholders

Type: AFK

#### What to build

Add resizable tables, chairs, person figures, speakers, and generic boxes with labels and dimensions.

#### Acceptance criteria

- [ ] Placeholders can be placed on the intended surface, saved, selected, grouped, and exported.
- [ ] They appear in linked views and participate in relevant overlap warnings.
- [ ] Use simple geometry; CAD imports, fixture placement, and lighting planning remain deferred.

#### Blocked by

- Draft slice 11
- Draft slice 13
- Draft slice 15

### 19. Duplicate scenes while retaining physical panel identities

Type: AFK

#### What to build

Manage multiple scene layouts within a production and duplicate a scene to rearrange the same inventory.

#### Acceptance criteria

- [ ] Whole-scene duplication preserves physical IDs while creating independent editable placement records.
- [ ] Stock counts allow the same physical panel in different scenes but flag duplicate use within one scene.
- [ ] Rigging setups record fixed hinge mounting; pin changes are notes and remounting is a separate setup. Compatibility remains a crew check.

#### Blocked by

- Draft slice 8
- Draft slice 17

### 20. Reuse a base design in a different venue

Type: AFK

#### What to build

Create venue adaptations from a base design and copy scenes across productions or venues using the destination venue's features.

#### Acceptance criteria

- [ ] Cross-production copies clear physical panel assignments while retaining wall types, group structure, and relative arrangement.
- [ ] Only movable pieces transfer; source venue outlines, permanent equipment, and constraints stay behind.
- [ ] Map transferred pieces onto explicitly chosen destination surfaces, preserving relative arrangement within mapped groups; show unresolved support placement and rerun destination conflicts.

#### Blocked by

- Draft slice 19
- Draft slice 12
- Draft slice 18

### 21. Save and use read-only scene templates

Type: AFK

#### What to build

Capture a named independent scene template and insert an editable copy into a production adaptation.

#### Acceptance criteria

- [ ] Source edits and later wall type edits do not alter the stored template geometry.
- [ ] Using a template clears physical inventory assignments and uses the destination venue.
- [ ] Templates remain read-only; copied scenes can be edited without altering the template.

#### Blocked by

- Draft slice 20

### 22. Apply venue updates explicitly to existing adaptations

Type: AFK

#### What to build

Save venue versions, notify adaptations that newer information exists, and let users explicitly apply an update.

#### Acceptance criteria

- [ ] Existing adaptations keep their pinned venue version until updated; frozen PDFs and their snapshots never change.
- [ ] Updating reruns clearance/overlap checks and flags removed or changed supporting surfaces.
- [ ] Retrying or failing an update cannot leave half-applied venue references; test a return visit after a ceiling or platform change.

#### Blocked by

- Draft slice 20
- Draft slice 4

### 23. Print scaled A4/A3 plans across tiled pages

Type: AFK

#### What to build

Select A4/A3 paper and drawing scale and tile oversized plans into a printable package.

#### Acceptance criteria

- [ ] A known model distance has the correct PDF length at each supported scale.
- [ ] Pages include overlap/registration aids, scale, audience direction, revision, date, and page identifiers.
- [ ] Vector content crossing tile boundaries is retained; repeated exports from a revision reproduce geometry and pagination.

#### Blocked by

- Draft slice 4

### 24. Export front elevations for selected wall groups

Type: AFK

#### What to build

Select wall groups for dimensioned front-elevation pages alongside the overhead drawing.

#### Acceptance criteria

- [ ] Show panel heights and opening dimensions at the selected scale.
- [ ] For angled groups use explicit labelled face projections rather than falsely dimensioning a flattened overview; document that projection convention.
- [ ] Elevation geometry comes from the frozen model and handles any supported opening shape, including arches once available.

#### Blocked by

- Draft slice 5
- Draft slice 15
- Draft slice 23

### 25. Export a complete scene construction package and parts list

Type: AFK

#### What to build

Choose scenes and generate a revision package containing dimensions, panel positions/angles, assembly labels, braces, notes, constraints, warnings, and parts requirements.

#### Acceptance criteria

- [ ] Per-scene lists and a production stock summary distinguish repeated appearances from physical panels.
- [ ] Unassigned, unavailable, or conflicting assignments and unresolved spatial warnings are clearly listed.
- [ ] Every page identifies the frozen revision; viewers can retrieve the exact package after live inventory, types, or venue data change.

#### Blocked by

- Draft slice 8
- Draft slice 9
- Draft slice 12
- Draft slice 13
- Draft slice 14
- Draft slice 18
- Draft slice 19
- Draft slice 23
- Draft slice 24

### 26. Sign in through Pocket ID and manage linked accounts

Type: AFK

#### What to build

Integrate configurable OIDC with Pocket ID as the initial provider while retaining local password sign-in and app-owned roles.

#### Acceptance criteria

- [ ] Both methods enforce explicit membership; a valid external identity alone cannot join the workspace.
- [ ] Linking requires authenticated proof of account ownership; matching email alone does not silently merge identities.
- [ ] Use a test OIDC provider to verify callback, state/nonce, session and sign-out behavior without needing production credentials.

#### Blocked by

- Draft slice 1

### 27. Invite members and recover passwords through Brevo

Type: AFK

#### What to build

Let administrators invite members with roles and let local-password users recover access using Brevo-backed email delivery.

#### Acceptance criteria

- [ ] Invitations and resets expire, are single-use, and cannot be replayed to change another account.
- [ ] Administrator/editor/viewer checks hold at the API; roles can be changed and access revoked.
- [ ] Test delivery through a fake mail transport and exercise failure/retry; production sending is not part of this ticket.

#### Blocked by

- Draft slice 1

### 28. Protect editing with exclusive leases and stale-write checks

Type: AFK

#### What to build

Acquire a visible exclusive editing lease for a plan and protect edits to shared venue/inventory records from stale writes.

#### Acceptance criteria

- [ ] Others see the editor and can view without modifying the plan; heartbeat expiry releases abandoned leases.
- [ ] An expired editor cannot autosave over a new owner's work, including after network reconnection.
- [ ] Atomic lease checks, record revisions, and server-side permissions are tested with competing clients; preserve unsaved local work for recovery instead of silent overwrite.

#### Blocked by

- Draft slice 2

### 29. Install and restore a complete test instance

Type: AFK

#### What to build

Provide container installation, migrations, persistent file/database configuration, and CapRover-specific installation support, then verify backup/restore of a working instance.

#### Acceptance criteria

- [ ] A clean test installation supports login, edit, upload, freeze, and PDF download through configured endpoints.
- [ ] A restored instance retains memberships, venue versions, uploaded references, and immutable construction packages; test database migration on retained data.
- [ ] Document required settings and rollback limits; use local/test services and keep CapRover concerns outside application logic.

#### Blocked by

- Draft slice 22
- Draft slice 25
- Draft slice 26
- Draft slice 27
- Draft slice 28

### 30. Validate the real inventory and crew construction workflow

Type: HITL

#### What to build

Populate confirmed real inventory and dimensions, then run a group pilot with one production and two differing venues, including a changed return-visit venue.

#### Acceptance criteria

- [ ] Confirm real panel IDs, broken-panel statuses, opening/brace dimensions, and any provisional geometry conventions with the group.
- [ ] Review actual-size A4/A3 prints, elevations, assembly identification, and movement across floor levels with a crew member.
- [ ] Measure editing performance on representative hardware using 29 panels plus venue/equipment geometry; record reproducible defects and release readiness. Production deployment and real emails require the user's approval.

#### Blocked by

- Draft slice 6
- Draft slice 16
- Draft slice 21
- Draft slice 25
- Draft slice 29

## Review requested

Confirm the granularity, dependency relationships, any desired merges/splits, and HITL/AFK assignments. After approval, publish these bodies as individual local issues with real relative dependency links, in dependency order. Ready labels indicate specification readiness, not that blockers may be ignored.
