# Rough edges: production navigation, physical inventory and print output

Research date: 28 September 2026. This note combines official product documentation with the user's requested workflow. It is a product research note, not a fresh browser audit or a release certification. External product features are precedents, not evidence that a particular interaction will work for this theatre's crew.

## Scope of the current work

Implemented alongside this review: production gallery/search and scene previews; wall-type and front/back panel previews; physical-panel outlet/cable cutouts; panel rename/delete with assignment checks; actual finishes updated separately from captured assignment intent; and missing construction-PDF geometry/framing.

The follow-up request also adds **2D-Ansicht drucken / PDF**, based on the actual rendered drawing. It offers A4–A1, whole/current framing, fit/fixed scale, layer and object visibility, movable notes/arrows, and SVG download. Print compositions are temporary and can be retained through PDF/SVG; named server-side construction revisions remain a separate workflow. Rectangular technical cutouts are inventory details; custom wallpaper photo uploads and cutout propagation into scene meshes are follow-ups.

Validation during implementation: build passed; 44 unit test files and 103 integration cases passed; eight targeted browser journeys passed, including mobile navigation, inventory rename/cutout/delete, PDF issue/download and direct vector printing with composition controls. The original missing-stage PDF case was reproduced before its fix. Hardware printing still needs the crew's printer settings (matching paper and 100% for a fixed scale).

The user explicitly confirmed the finish rule: **assignment captures the intended finish; actual paint/wallpaper changes only after a separate work-completed confirmation**. Inventory appearance must remain distinct from the stage designer's planned appearance. A physical cutout belongs to an individual panel; it must not silently modify every instance of its wall type.

## What the primary sources establish

| Area | Verified precedent | Implication for this planner (our inference) |
| --- | --- | --- |
| Several productions | Trimble Connect project tiles support a project image, favorites for sorting, and reopening the last saved 3D view. [Trimble documentation](https://help.trimble.com/doc/trimble-connect/trimble-connect/connect-for-windows/projects/project-tile-functions) | Production cards should answer “which play?” visually, while a direct scene action answers “where did I stop?”. Keep the production, scene and venue adaptation recognizable in navigation. |
| Recognizing stock | Sortly supports multiple item photos with notes and fields; it explicitly uses photos to distinguish variants and track condition. [Sortly inventory photos](https://www.sortly.com/features/photos/) | Geometric previews help compare dimensions and openings, but a future actual front/back photograph would capture wear and wallpaper that a drawing cannot. Label schematics and photographs clearly. |
| Design demand versus available stock | Vectorworks Spotlight compares equipment placed in drawings with selected inventories and produces equipment reports. Its source assignment and inventory counts remain distinguishable. [Vectorworks 2024 equipment lists](https://app-help.vectorworks.net/2024/eng/VW2024_Guide/LightingDesign2/Managing_and_reporting_equipment_lists.htm) | Show stock shortages and physical assignments alongside design demand; the number of drawn walls alone is not an availability promise. This is a versioned reference, not a claim about the newest Vectorworks release. |
| Finding the real object | Sortly can link existing QR/barcodes to an item; scanning opens that item's record. [Sortly scanning documentation](https://help.sortly.com/scan-and-connect-existing-qr-codes-or-barcodes) | Stable panel labels can later become printable QR labels, taking a crew member directly from the stored panel to its condition and finish record. |
| Paper composition | LayOut explicitly configures page dimensions, orientation and margins, and separates display from output resolution. [SketchUp document setup](https://help.sketchup.com/en/layout/document-setup) | Export framing should use drawing bounds and the printable frame, rather than inheriting an arbitrary editor camera. A print preview must expose the actual paper composition. |
| Drawing scale | LayOut scaled groups preserve text, label and dimension properties while scaling geometry. [SketchUp scaled drawings](https://help.sketchup.com/en/layout/creating-scaled-drawing) | Fitting a full drawing and retaining a fixed construction scale are separate modes. Labels need their own readable paper sizes. If a fixed-scale view cannot fit, disclose it and offer a larger sheet or additional pages. |

## Further rough edges worth addressing

These are proposed follow-ups and acceptance questions, not newly reproduced bugs. Existing behavior should be checked before opening implementation work. Priority means suggested product order, not a finding of a release-blocking defect.

### Next: make assignment consequences visible

Put **planned**, **assigned snapshot**, and **actual** finish next to each other at the assignment/work-completion boundary. A scene change after assignment should show “plan changed since assignment” with an explicit way to renew the intended work. Completion should name the physical panel and the snapshot being applied. A stale open screen must not confirm a different, newer assignment accidentally. Removing or replacing an assignment must not erase the real finish or silently mark unfinished work complete.

This follows the user's chosen workflow; it is not a workflow claimed by the external sources. A useful acceptance case is: assign red, change the scene to blue, confirm the original red work, and verify that inventory is red while the scene is blue and the mismatch remains understandable.

### Next: show availability across productions

With multiple plays, a panel can look available inside one scene while another production expects it. First expose “also assigned in…” with links, and distinguish missing inventory from unavailable stock. Before adding scheduling, define which dates or production states reserve an object; reuse in successive scenes should not automatically count as a conflict. This extends the demand-versus-stock distinction supported by the Vectorworks reference above.

Acceptance question: can a user tell whether ten drawn wall placements need ten simultaneous panels or reuse five across scenes, and which production currently owns the work commitment?

### Next: make print completeness inspectable

After the geometry/framing fix, add or verify a clear fit-to-page/fixed-scale choice, readable scale indication, and an explicit overflow warning before issue. Exercise negative coordinates, distant offstage objects, curtains, room boundaries, labels and empty scenes. A PDF may include all geometry but still be unusable if one distant object shrinks the main stage beyond readability. Offer a deliberately chosen detail view rather than silently dropping that object.

Acceptance question: does the preview explain exactly what will print, at what scale, and which filters are active? The paper and scale references above support this distinction; the particular controls are our recommendation.

### Then: help the workshop recognize the right face

For asymmetric cutouts and two-sided finishes, mark front/back and the measurement origin on previews. Define whether an outlet hole passes through the panel and whether its offset is measured from the front-left edge. A back view should mirror geometry consistently without changing stored dimensions. Unknown actual finish should read “not recorded”, rather than appearing as a verified default colour.

Later, add dated front/back photos, location and a stable physical label. Keep actual photos in inventory; planned stage finishes should still render from the scene. This builds on Sortly's documented use of photos to identify variants and condition.

### Then: make returning to work faster

Once galleries exist, consider favorites/recently opened productions, an archived-production filter, and direct links to the last scene/adaptation. Scene duplication should explain whether physical assignments are copied, cleared or require review; otherwise creating a visual alternative can accidentally imply a second claim on real panels. Trimble's tiles are a useful precedent for quick return, while the duplication rule is specific to this domain.

### Later: close the handoff loop

Offer a compact workshop/picking sheet with physical label, intended finish snapshot, actual finish, cutouts and outstanding preparation. Printable QR labels and scan-to-record access are a useful subsequent step, grounded in the Sortly scanning precedent. Avoid building a full warehouse system before validating a simple crew journey: locate panel → inspect it → complete finish work → confirm → use the issued plan.

## Relation to earlier reviews

The [27 September release review](release-ui-ux-review-2026-09-27.md) and [release fix progress](release-fix-progress.md) already cover interaction and export defects. Their findings have a different evidence basis and may have been fixed since review; do not treat this note as reopening them. The next useful validation is a real crew walkthrough with several productions and reused physical panels, followed by printing a representative plan on the intended paper size.
