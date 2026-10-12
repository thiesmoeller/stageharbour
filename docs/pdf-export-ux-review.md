# PDF export: workflow and visual quality review

> Historical review. The recipient-first document workspace and deterministic preview/issue renderer now replace the `ExportPanel`/browser-print flows referenced below.

Reviewed 2026-09-16 against `da71107`. Extends [the planner controls review](planner-controls-review.md). The user specifically identified unpolished graphical output, so this review includes actual rasterized PDFs, not only renderer source. No PDF renderer or export UI changes are included yet.

## Verdict

The PDF output needs a document-layout redesign. Changing colours or fonts alone will leave unreadable annotations, overwritten warnings and cropped drawings. The frozen-data and vector-scale foundation is useful; page composition, annotation layout and the export experience need their own design.

## Evidence inspected

Rendered a synthetic theatre scene with six numbered walls, two perpendicular wall facings, a table, brace, platform, overhead obstruction, keep-clear zone, centreline and assembly notes. Inspected A4 and A3 at 1:50, a two-scene construction package, and A4 at 1:25. The fixture deliberately includes overlapping geometry to exercise warnings; these are supported saved states and must remain legible in an export.

Review-session artifacts are in `/tmp/planner-pdf-review/`: `plan-A4.pdf`, `plan-A3.pdf`, `package.pdf`, `elevation-detail.pdf`, and rasterized PNGs. `/tmp/planner-pdf-review.mts` generates the samples using the existing renderers. These are synthetic examples, not user production data; temporary artifacts are not durable repository fixtures.

## Findings

1. **P1 — Notes and warnings overwrite one another. Visually reproduced.** `assemblyPdf.ts:22` positions its legend and notes at 268/274/280 mm, `overheadPdf.ts:23` starts warnings at 262 mm, and `keepClearPdf.ts:25` starts another warning list at 272 mm. All share the same page space without measuring previous content. They also run inside the drawing clip in `pdf.ts:173`, so overflowing notes can disappear. The A4 sample has several illegible lines; on A3 the same collision occurs in the middle of a largely empty page. Allocate one measured notes region outside the drawing clip; paginate overflow onto clearly identified notes pages.

2. **P1 — Elevations can run off the sheet. Visually reproduced.** `elevationPdf.ts:12` stacks every face of a group on one page without checking available width or height. `pdf.ts:144` reserves exactly one elevation page per group. At 1:25, four adjacent 1200 mm panels occupy 192 mm starting at X=37 mm, ending at 229 mm on a 210 mm A4 sheet; the rightmost panel and dimensions are cut off. Lay out elevation sheets by actual bounds including annotations. Offer another paper/orientation or tile at the selected scale; never silently shrink a dimensioned drawing.

3. **P1 — Object annotations collide with geometry and each other. Visually reproduced.** Widths, assembly IDs, brace dimensions, front/back marks and obstruction labels are independently placed at fixed offsets (`pdf.ts:89`, `assemblyPdf.ts:15`, `bracePdf.ts:20`, `overheadPdf.ts:18`). The front/back letters sit almost on top of each other for thin walls. A rotated wall's width label remains horizontal. The sample's rear wall run is difficult to identify even before adding more objects. Use compact numbered callouts with leaders, reserve dimension lanes outside the geometry, and deduplicate repeated dimensions. Put full labels and construction details in a keyed schedule.

4. **P2 — Page composition does not adapt to the content. Visually reproduced.** The drawing starts at the upper-left paper margin, while registration marks frame the entire available drawing region (`pdf.ts:167`, `shared/tiling.ts:41`). A3 retains the same physical drawing size at 1:50, which is correct, but simply adds unstructured whitespace. The centreline stretches far below the venue, into the notes area. Use a defined drawing viewport, centre the extent at exact scale, constrain reference lines, and reserve title/legend/notes areas explicitly. Extra paper area should enable useful schedules or a deliberate spacious composition, not imply that a larger paper setting automatically enlarges the drawing.

5. **P2 — Typography and symbols do not provide a reliable hierarchy. Visually reproduced.** Headers are four similar lines of Helvetica; the full UUID has nearly the same prominence as production and scene (`pdf.ts:158`, `packagePdf.ts:29`). Text uses unbounded single lines and can overflow with valid long names. The audience arrow is an unsupported glyph rendered as punctuation in both header and drawing. Use measured wrapping, a strong production/scene title, quiet revision metadata, an embedded font with required language coverage, and vector arrows. Keep the full revision identity in metadata/a small reference field, with a short human-readable sheet code on the page.

6. **P2 — The parts list is prose rather than a usable schedule. Visually reproduced.** `packagePdf.ts:45` prints every record as one 180 mm-wide, nonwrapping line, including on A3. Labels, assignment status, dimensions and coordinates have no column alignment. Scene headings can land at the bottom of a page without their content; warnings repeat information already listed as unassigned. Use real tables with repeated column headers, measured row heights, tabular numerals, group subtotals and a separate exception summary. Retain the valuable distinction between physical panel count and scene appearances.

7. **P2 — A multi-sheet export lacks a document navigation system. Source-confirmed.** `packagePdf.ts:88` merges separately numbered PDFs. A package therefore contains repeated scene-local “Blatt 1 von …” sequences without global numbering or a table of contents. Tiled plans give overlap width but no thumbnail tile map or neighbor sheet references. Add global sheet IDs, a package index and PDF bookmarks; retain local tile coordinates such as A1/A2 when useful for assembly. Include a vector scale bar and an explicit actual-size/100% print instruction, so physical scale can be checked after printing.

8. **P2 — Export settings are blind choices. Source-confirmed.** `ExportPanel.tsx:153` offers paper and scale without a rendered preview, drawing footprint, page count, tile map or overflow feedback. Users must issue a frozen revision and download it to discover the layout. The scene and package forms repeat choices and long explanatory prose. Use one export workspace with settings on the left and actual sheet previews on the right; show a clear scope choice, selected views, paper/scale and resulting page count before the final action. Preview must not create a frozen revision or pollute export history.

9. **P2 — Export state and recovery feedback are weak. Source-confirmed.** The same `busy` state displays “Exportverlauf wird geladen …” while generating a PDF, and `freezeDisabled` disables settings without a nearby reason (`ExportPanel.tsx:153`, `Editor.tsx:1150`). Downloads use opaque UUID filenames. Failed package generation sets an error then immediately clears it through `load()` (`ExportPanel.tsx:35`); scene export only exposes failure later in the history list. Separate loading/generating/downloading states, preserve errors, explain “Waiting for saved changes,” and offer Open PDF plus Download with a readable production-scene-revision filename.

## Recommended visual direction

A restrained technical drawing set: white paper, charcoal geometry, strong but sparse headings, muted venue context, one accent for movable scenery, and an amber exception system. Preserve readable line styles in grayscale. Avoid making colour the only way to distinguish fixed geometry, scenery, overhead objects and keep-clear areas.

Use a consistent title block containing production, scene, drawing type, revision/date, scale, paper and sheet ID. The drawing is the primary content. The legend and notes have allocated space; full object names live in schedules rather than being repeated over geometry. Parts pages use aligned tables with units in headers and repeated headers on continuation pages. A presentation view with shaded imagery can be a separate future output; construction sheets should prioritize legibility and exact dimensions.

The export workflow should read: **Scope → Views → Paper and scale → Preview → Create PDF**. Keep those controls independent: paper changes sheet layout, scale changes printed geometry size, and view selection changes included sheets. Clearly show their consequences. Provide useful defaults based on the current scene, retain settings after export, and place previous immutable revisions in a secondary history panel.

## Implementation order and acceptance

1. Build a shared page compositor with explicit title, drawing, notes and footer regions. Remove page-coordinate text from geometry layers. Add measured wrapping/pagination and font/vector-symbol handling.
2. Add annotation placement and schedules, elevation overflow handling, global sheet identities and the tile index. Preserve model-to-paper scale throughout.
3. Build an export preview UI using the same renderer/layout calculation, with scope, settings, page count, clear progress and actionable errors.
4. Add visual regression fixtures for sparse/dense scenes, long German names, multiple warnings, rotated walls, A4/A3, all supported scales, large elevations and multi-scene packages. Verify readable output at physical print size and in grayscale, and check a known 1200 mm edge remains 24 mm at 1:50. Existing PDF text/path assertions do not catch the visibly overlapping content reproduced here.

The first acceptance gate is zero cropped drawings or overwritten text, including warning overflow. The next is a preview that matches the exported page count and layout. Only then assess stylistic polish through representative sheets with the crew.
