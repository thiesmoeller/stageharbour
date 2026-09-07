# Stage planner implementation plan

## Planning baseline

The design interview has established enough shared understanding to begin project planning. This plan implements the agreed phase-one scope; it does not authorize deployment or sending invitations. The domain glossary is in [CONTEXT.md](../CONTEXT.md), product decisions in [planner-decisions.md](./planner-decisions.md), and backend choices in [ADR 0002](./adr/0002-typescript-postgresql-backend.md).

Deliver a German-language planner in which the group can reuse venue information, arrange its set across scenes and levels, check spatial conflicts, and hand volunteers reproducible construction PDFs. Each milestone delivers a usable workflow across UI, API, and storage. Milestones are sequential unless a later ticket explicitly identifies independent work. Milestone 1 is an early proof of the complete workflow, not the full release.

## 1. First saved layout and scaled PDF

Create the TypeScript application structure, Fastify API, PostgreSQL/Drizzle migrations, and shared layout model. Select and pin the browser framework and compatible dependencies before scaffolding. Implement a German browser workflow for a simple venue, one production/adaptation/scene, and rectangular wall placement. Support exact dimensions, position, rotation, top-down editing, and a linked Three.js view.

Introduce the command stack, session undo/redo, autosave, visible save status, and schema versioning with the first editable object. Generate an A4 vector overhead PDF from a frozen revision, retaining the venue information used. Add the initial invitation-only password login and administrator bootstrap; all saved data belongs to the single workspace.

Acceptance: a member creates a layout, moves a panel, undoes/redoes the move, reloads the saved result, and exports a dimensioned PDF. A known model distance maps to the expected PDF distance at the chosen scale. Later edits leave the frozen revision unchanged. Another workspace's records cannot be accessed by substituting identifiers in API requests.

## 2. Actual wall inventory and assembly identification

Add wall type editing for rectangular panels, door/window openings, and simple arches. Use 28 mm standard thickness and 250 mm arch thickness. Support physical panel IDs, availability and repair notes, unassigned placements, and stock warnings. Seed real inventory only once identifiers and missing dimensions are provided; development fixtures must be labelled as examples.

Add front/back markers, audience orientation, initial left-to-right assembly numbering, connection references, rigging notes, and manually placed rear braces with adjustable footprints. Represent panels with simplified geometry.

Acceptance: a mixed arrangement can be designed before inventory assignment, assigned available panels later, and exported with both assembly numbers and physical panel IDs. Unavailable or duplicate assignments within a scene are detected. Counts across scenes allow reuse of the same physical panels. Openings and orientation agree between the editor and exports.

## 3. Real venue geometry and constraints

Add dimensioned venue outlines and calibrated image/PDF tracing, a venue-defined centreline, multiple floor levels, permanent platforms/stairs, and box-shaped overhead obstructions. Add labelled keep-clear polygons, power/audio connection pins, routing corridors, and notes.

Implement overlap and clearance warnings using local supporting floor heights. Provide visible diagnostics for unsupported or ambiguous placement at floor-level boundaries; finalize those interaction rules in this milestone. Users supply restrictions and the crew reviews conflicts. Warnings do not prevent saving and unresolved warnings appear in construction exports, as accepted in the initial interview.

Acceptance: reproduce a venue where acting spans the audience floor, stairs, and raised stage beneath a ventilation duct. A wall that fits at the lower level but intersects the duct when raised is flagged. A brace intersecting a keep-clear zone is flagged. Connections and routing possibilities remain simple venue annotations.

## 4. Efficient set editing

Add explicit groups, multi-selection, group movement/rotation, wall-edge and centreline snapping guides, numeric transforms, and select/copy/cut/paste. Add movable platforms/stairs and resizable table, chair, person, speaker, and generic-box placeholders. Choose snapping tolerances, keyboard mappings, and group-pivot behavior during interaction design.

Acceptance: the user moves the whole arrangement while preserving relative positions, aligns it with the centreline, and undoes the edit as one action. Copying walls within a scene clears panel IDs; cutting and pasting retains them. Editor gestures remain responsive with a representative layout using the group's 29 panels plus equipment and venue geometry. Establish a measured performance budget on representative hardware in this milestone.

## 5. Reuse across scenes, productions, and visits

Add scene duplication, base designs and explicit venue adaptations, cross-production copying, named read-only templates, venue versions, update notifications, and explicit application of a new venue version. Distinguish rigging setups with fixed hinge mounting; compatibility remains manually verified.

Acceptance: duplicating a scene within a production retains panel assignments; copying from another production or template clears them. Only movable set pieces transfer to a destination venue. Template and export snapshots survive edits to their source. An adaptation keeps its old venue version until explicitly updated, then reruns conflict checks. Resolve how copied elevations are placed on destination surfaces before implementing cross-venue placement.

## 6. Complete construction package

Extend the early PDF workflow to selectable A4/A3 sizes and scale, tiled pages, selected wall-group elevations, panel/opening dimensions, positions and angles, parts lists, braces, orientation, constraints, and rigging notes. Include revision and date on every page. Scope selected scene exports explicitly so the parts list distinguishes physical stock from repeated scene appearances.

Acceptance: a volunteer can identify panel order, physical panel IDs, measurements, and venue orientation from the package. Check numeric scaling and page boundaries automatically, and inspect representative prints at actual size. Define elevation projections for angled groups and page overlap/registration marks during this milestone. Perform export work outside the API event loop, with explicit error status and reproducible retry from the frozen revision.

## 7. Shared operation and account workflows

Complete Pocket ID OIDC alongside password authentication, administrator-managed roles and invitations, Brevo invitation/recovery email integration, and exclusive editing leases with visible ownership. Apply appropriate write coordination to shared venue and inventory editing as well as plans. Bootstrap the first administrator through deployment configuration rather than public registration.

Acceptance: both login methods enforce invitation-only membership. Viewers cannot modify records or create new frozen revisions; they can access allowed plans and existing PDFs. Expired/disconnected editors cannot overwrite a newer editor's changes. Verify role changes, lease expiry, password reset, and invitation expiry. Decide and test account linking and lease recovery during implementation; never assume matching email addresses alone are sufficient proof for linking accounts.

## 8. Installation and group pilot

Provide container builds, configuration documentation, migrations, persistent storage setup, and CapRover installation files. Keep installation concerns outside domain logic. Define database/file backups and restore procedures, then verify a restoration including uploaded references and frozen PDFs. Configure Pocket ID and Brevo only when deployment settings are available.

Acceptance: install a clean instance, migrate an existing instance, and restore saved data in a test environment. Run a pilot with one real production and two differing venue layouts, including a changed venue version. Review the printed construction package with the group before release. Actual deployment and outbound messages require authorization at that time.

## Inputs and decisions to resolve within milestones

- Actual door, window, arch, brace, platform, and stair dimensions; confirmation of outer dimensions for special panels; permanent panel numbers and which panels are broken. These are configuration inputs, not blockers to starting implementation.
- Exact arch profile parameterization and raised-surface placement behavior before the relevant geometry is implemented.
- Browser framework, units/coordinate conventions, shared geometry interfaces, and schema migration approach before milestone 1 code; detailed schema and API contracts within each slice.
- Role inheritance, initial administrator bootstrap, account linking, lease expiry/recovery, and shared-record concurrency before their workflows ship.
- Deployment addresses, mail configuration, storage and backup destinations before installation. Keep credentials out of these documents.

## Phase-one exclusions

Lighting placement/simulation and PBR planning, door handing/swing detail, detailed panel construction geometry, automatic hinge compatibility checks, suggested stabilization positions, CAD-library imports, offline editing, persistent undo history, simultaneous collaborative editing, mirroring, and commercial multi-group service workflows are outside phase one. Some have been identified as future possibilities rather than committed phase-two deliverables.

## Release verification

Use focused geometry and command tests; API/database integration tests for revisions, permissions, leases, and inventory; and browser tests for the main create/edit/reuse/export workflows. Validate PDF vector coordinates and pagination with representative fixtures and an actual-size print review. The pilot must cover the group's complete workflow, not just isolated features.

The next planning step is to turn milestones into bounded implementation tickets with dependencies and acceptance criteria. Do not infer calendar dates from this plan: staffing and availability have not been specified.
