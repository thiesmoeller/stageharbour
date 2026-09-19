# Agreed planner behavior

## Language

Version one uses German for the user interface and generated PDF labels. Additional languages may be added later.

## Connectivity

CapRover is an installation/deployment target only; it does not determine the backend architecture or require CapRover-specific application behavior.

Invitation and password-reset emails use the user's existing Brevo service. Mail connection settings and credentials are deployment configuration.

Version one will be deployed to the user's existing CapRover installation. This supersedes the earlier standalone Docker Compose deployment direction. CapRover supports container deployment using a `captain-definition` or a prebuilt image; database and uploaded-file persistence must be configured explicitly. See [deployment methods](https://caprover.com/docs/deployment-methods.html) and [persistent apps](https://caprover.com/docs/persistent-apps.html). Server-specific application configuration remains to be established.

Version one serves a single theatre group in one shared workspace with individual logins. A future service for multiple independent groups is intended; multi-group operation and commercial service features are outside version one.

The workspace has three roles: administrators manage members, editors maintain venues and plans, and viewers inspect plans and download PDFs.

Sign-in supports the user's existing Pocket ID installation through OpenID Connect (OIDC), as supported by [Pocket ID](https://pocket-id.org/docs), and an alternative email/password login. Administrators assign workspace roles inside the planner. Workspace access requires an administrator's invitation regardless of sign-in method; successful authentication alone does not grant membership.

Opening a plan for editing acquires an exclusive editing lock. Other users can view the plan and see who is editing it. Locks expire automatically after the editor disconnects. Concurrent editing of the same plan is outside version one.

Version one requires an internet connection for editing. Users can download PDF construction plans for offline assembly at venues. Offline editing and synchronization are outside the initial scope.

## Construction plan revisions

Construction PDFs include an overhead plan and optional front elevations for selected wall groups. Elevations show panel heights and door/window dimensions.

PDF exports support A4 and A3 paper, a selectable drawing scale, and tiled pages when the plan cannot fit legibly on one sheet.

Exporting a construction PDF saves a named, frozen revision, with its revision identifier and date printed on every page. The revision preserves the design and the venue layout and constraints used for that export, so later edits do not change what the crew received. This supports repeat visits where the venue may have changed since the previous year.

## Venue floor plans

Existing venue adaptations retain the venue version they use when newer venue information is saved. The planner flags that an update is available; users explicitly apply it, triggering conflict checks against the updated venue. Frozen construction plan revisions remain unchanged.

Users draw venue floor plans with exact dimensions. They can optionally upload an image or PDF as a tracing reference, calibrating its scale against a known distance.

Venues default to a flat floor and can include raised platforms defined by outline and height. Overhead obstructions, including ventilation structures crossing the stage area, must be represented so clearance can vary by position. Clearance is measured from the local supporting floor or platform surface.

Overhead obstructions are represented by rectangular boxes with adjustable position, length, width, bottom height, and thickness. Multiple boxes can describe a complex structure. They appear in 3D and participate in overlap warnings.

The performance area can extend across the audience floor and a raised main stage, connected by stair units. Venue layouts must support these multiple levels and set placement on each, rather than assuming a single stage surface.

Stairs and platforms can be permanent venue features or movable production pieces. Permanent features are stored in the venue layout; movable pieces are placed in the production's venue adaptation.

## Keep-clear zones

Users draw labelled polygons for areas that must remain clear, recording a reason such as an emergency exit route or audio equipment access. The planner warns when walls, braces, or furniture overlap these zones.

## Power, audio, and cable routing

Venue information includes known power and audio connection points and places where the group can route long cables. These represent available infrastructure and routing possibilities; detailed cable runs have not been agreed as part of version one.

Version one represents connection points as labelled power/audio pins and cable-routing possibilities as drawable corridors. Both support optional notes; the workflow stays simple.

## Editing views

Layout editing uses a command stack for undo and redo. Changes autosave with a visible save status. Autosaving updates the working design; frozen construction plan revisions are created explicitly on export and remain unchanged.

Undo/redo history is session-only in version one and is not restored when a plan is reopened. The command pattern provides the editing infrastructure; saved layouts and frozen export revisions persist independently of undo history.

The primary editing workflow uses a top-down plan for precise placement and dimensions, linked to a 3D view of the same layout. The 3D view supports inspection of heights, stairs, overhead obstructions, and views from the audience.

Users can explicitly group panels to move or rotate an entire wall arrangement together, while retaining individual panel editing. Panel connections alone do not cause neighbouring panels to move automatically.

The editor shows snapping guides for aligning wall edges and for alignment with a stage centreline defined per venue. This centreline provides a reference for symmetrical arrangements.

Version one supports selecting, copying, cutting, and pasting layout objects. Mirroring is outside the requested scope. Wall copies within a scene start without physical inventory panel IDs and are assigned later. Cut-and-paste moves existing placements and preserves their panel IDs.

Duplicating a whole scene within a production preserves panel assignments because scenes reuse the same physical walls. Users can also copy a scene from another production as a starting point for the current production. Copies from another production or a template preserve the arrangement and wall types but clear physical panel assignments for later assignment from current inventory.

Scene templates are named, read-only snapshots. Changes to the source scene do not alter a saved template. Using a template creates an independent editable copy.

Scene copies into a destination venue bring only movable set pieces, preserving their relative arrangement. The destination venue supplies permanent features and constraints; source venue features and constraints are not copied. Users position the copied arrangement in the destination venue and check it for conflicts.

## Furniture, people, and equipment

Version one includes a small library of resizable placeholders: tables, chairs, person figures, speakers, and generic boxes, each with a label and dimensions. Chairs render as built-in low-poly seat/back geometry with an optional Sitzfigur. Importing models from a CAD database or library remains a possible later extension for other props.

## Traversen and lighting

Venue Traversen (hang bars) are first-class venue geometry with length, section, underside height, and optional hang-point slots. They participate in overhead clearance and appear on plan/PDF/3D. Fixture placement on hang points and lighting simulation remain deferred to phase two; Traversen are the attachment seam for that work. Mood lighting (warm/cool preview) is unchanged and is not a fixture plan.

## Molton curtains

Installed venue Molton tracks are first-class venue geometry: track length, drop height, optional floor clearance, opening style (traveler / stack left / stack right), and open percent. Plan graphics follow USITT soft-goods with fullness (sine-wave polyline and end ticks). The 3D view uses matte black theatre molton with folded fabric leaves that gather according to the opening. Curtains are drawn like Traversen (click start and end on the plan).

## Lighting

Lighting planning, including basic fixture placement, is deferred to phase two. It will be treated as a separate design workstream covering the desired physical realism, materials, and lighting simulation in Three.js.

## Custom wall types

The group owns 29 panels: 20 plain walls, 6 door panels, 2 window panels, and 1 arch-opening panel. The arch has straight sides and a rounded top.

Standard walls use 3 mm plywood stiffened around the edges with 50 × 25 mm construction timber, with the 25 mm side projecting behind the plywood. Overall standard panel thickness is 28 mm. The arch panel is 250 mm thick.

The editor and construction PDFs mark panel front/back orientation. For standard panels, the plywood face is the front and the timber-framed side is the back.

Phase one represents walls as solid panels with the correct overall dimensions, openings, and front/back orientation. Detailed construction geometry, including individual rear framing members, is outside phase one.

Version one supports rectangular panels with configurable width, height, and thickness, plus rectangular door/window openings and simple arch openings with straight sides and a rounded top. Openings are positioned using exact dimensions and appear in both the 3D view and construction plans. Arch-profile dimensions remain to be specified.

Door handing and inward/outward swing details are deferred to phase two.

Designers can place a wall type before assigning a specific physical inventory panel. Permanent panel IDs are assigned when preparing construction plans, which flag unassigned panels and stock shortages.

Physical inventory panels have an available/unavailable status and an optional note, such as damage or repair details. Some of the group's panels are currently broken. Unavailable panels are excluded from usable stock counts, and plans referencing them show a warning.

## Panel identification

Plans show both the assembly number and the permanent panel label, for example, “Position 3 · Panel W12”. Assembly numbers follow the left-to-right order of the initial setup. Permanent panel labels identify the same physical walls across scenes and productions.

Left to right is viewed from the audience looking toward the stage. Every plan includes an arrow indicating that viewing direction.

## Stabilization

The group can choose nearly arbitrary panel connection angles because hinge mounting positions are established during the initial rigging of a stage arrangement. This does not establish that an already mounted connection can pivot freely. The editor supports choosing panel angles with optional snapping to common angles during layout design; snapping is an editing aid.

Hinge mounting stays fixed across scenes within a rigging setup. Scene changes can disconnect and reconnect panels using removable pins. Changes requiring hinges to be unscrewed and remounted belong to a separate rigging setup.

In version one, the planner records which panels connect and allows rigging notes. The crew manually verifies connection compatibility between scenes; automatic hinge compatibility checks are outside the initial scope.

The group uses [Würth scenery hinges](https://eshop.wuerth.de/Produktkategorien/Kulissenscharnier/14011503280616.cyid/1401.cgid/de/DE/EUR/), screwed on during rigging. Würth describes removable ring pins and theatre construction use; the linked page does not specify an angular range.

Designers manually place weighted rear braces in the first version. Brace dimensions are adjustable, and their floor footprints appear in the editor and PDF plans to support clearance planning.

Suggested stabilization positions are a future advanced feature. The rules and evidence needed to make those suggestions remain to be defined.
