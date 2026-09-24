# Professional PDF generation and export workspace

## Summary

Build a unified export workspace that opens with a well-composed, ready-to-export document. Users can adjust settings, inspect actual PDF pages, and optionally customize layouts using reusable venue templates.

The target is dependable construction documents with polished presentation: exact scale, legible annotations, attractive 3D views, and predictable exports.

Confirmed choices: full composer, defaults before customization, saved camera controls, and A4/A3 portrait and landscape.

## User experience

- Replace the separate scene/package forms with one full-screen workspace, accessible from scenes and productions. Preserve the originating selection and return position.
- Use a left panel for scope, scenes, template, views, paper and scale; a central sheet preview; and a collapsible thumbnail rail. Keep page count and **PDF erstellen** visible.
- Start with an automatic construction set: ground plans, selected group elevations, relevant notes, and a parts schedule for packages. Offer a presentation preset that adds 3D views.
- Show actual rendered PDF pages with zoom, fit-to-page, searchable/selectable text, page navigation, and clickable issue references. Retain the previous preview while updating, clearly marked as outdated.
- Expose customization through **Layout bearbeiten**: add, duplicate, reorder and delete pages; place, resize, rotate and align frames; edit dimensions numerically; undo/redo; keyboard movement and selection.
- Frame types: ground plan, group elevation, 3D view, notes and schedule. Each drawing frame exposes its source, crop, layers and scale. Perspective views display “ohne Maßstab.”
- Provide camera presets plus orbit/pan/zoom and **Ansicht übernehmen**, storing the exact camera per frame.
- Keep export adjustments local to the document unless explicitly saved as a venue report template. Templates remain reusable across productions and must not depend on another scene’s object IDs.
- Preserve settings after export. Show distinct preparation, rendering and download states, actionable errors, retry, **PDF öffnen**, and **Herunterladen**. Keep revision history secondary.
- Maintain German UI copy, visible focus, labelled controls and status announcements. On narrow screens, switch between settings and preview; provide numeric alternatives to dragging.

## Document quality and rendering

- Introduce one measured document layout pipeline: frozen inputs → page/frame layout → annotation placement → PDF. Preview, page counts and final output consume the same layout result.
- Keep PDFKit for vector geometry and text. Embed bundled, licensed fonts; measure wrapping and row heights; add real PDF bookmarks and links. These capabilities are supported by [PDFKit](https://pdfkit.org/docs/text.html) and its [outline API](https://pdfkit.org/docs/outline.html).
- Use restrained technical styling: white sheets, charcoal geometry, muted venue context, one scenery accent and amber exceptions. Line weights, dashes and symbols must remain distinguishable in grayscale.
- Establish consistent title blocks with production, scene, venue, revision, sheet code and paper. Put scale beside each drawing; show a sheet-wide scale only when all drawings share it.
- Replace fixed-offset labels with deterministic callouts, leader lines and dimension lanes. Move full names into keyed schedules. When annotations cannot fit legibly, create detail/continuation sheets rather than shrinking text indefinitely.
- Compute bounds from complete geometry and annotations, including rotated objects and negative coordinates. Center drawings at the selected scale.
- Eliminate silent elevation rescaling and omitted faces. Automatically tile oversized plans and elevations at their selected scale, with overlap marks, tile maps and neighboring sheet references. Offer explicit paper/orientation/scale changes as alternatives.
- Treat intentional detail crops separately from full-object views; show their extent on an overview. Never silently crop a required construction view.
- Paginate notes and schedules by measured height, with repeated table headers and meaningful continuation titles. Notes pages use the available page body.
- Compose packages as one document with global sheet numbering, an index, bookmarks and stable object references. Preserve the distinction between physical inventory count and scene appearances.
- Include vector scale bars and actual-size print instructions. Keep construction geometry vector-based; rasterize only 3D imagery.
- Render 3D frames server-side from frozen scene data and saved cameras using a dedicated browser render entrypoint that shares the existing scene model. Target 300 dpi at printed size; freeze referenced assets and persist rendered images for retries. Bundle pinned Chromium and dependencies in the deployment image using the [Playwright deployment approach](https://playwright.dev/docs/docker).

## Interfaces, persistence and delivery

- Add a versioned `ExportDocumentSpec` shared by scene and package exports: ordered scenes, selected views, template snapshot, page/frame settings and revision metadata.
- Extend report templates with orientation, frame scale/crop, source selectors and saved camera projection/position/target. Resolve generic template selectors into concrete scene references when preparing a document.
- Add a document manifest containing ordered sheets, frame bounds, scales, navigation targets and layout diagnostics. Replace approximate page estimates with manifest counts.
- Introduce temporary preparation jobs returning an authorized preview handle, manifest and PDF. Preview creates no issued revision. Display the PDF through the existing PDF.js dependency, whose [display API supports browser rendering](https://mozilla.github.io/pdf.js/getting_started/).
- Bind each prepared document to its source versions and settings. Issuing promotes the reviewed artifact into an immutable revision; if source data changed, require a refreshed preview. Include the revision name/date in preparation so the issued pages match what was reviewed.
- Keep unsaved scene changes explicit: allow saving through the established save flow, then refresh preparation. Never quietly export stale saved data.
- Run rendering through bounded background workers with cancellation, timeout, progress stages and cleanup. Persist issued jobs; expire temporary previews after 30 minutes. Retry issued failures from frozen inputs, with idempotent issuance to prevent duplicates.
- Preserve workspace authorization on jobs, previews, files and assets. Viewers may inspect existing exports; existing editing/export permissions govern creation and template changes.
- Keep existing PDFs unchanged. Parse old snapshots through a legacy adapter; normalize existing A4/A3 templates into the new model without silently activating formerly ignored layouts. Surface invalid legacy frames for repair.
- Deliver in four increments: measured renderer and scale correctness; real preview and issuance; composer and template integration; saved-camera 3D and final visual polish. Keep the current flow available until the replacement passes acceptance tests.
- Record render duration, page count, failures and queue time to identify slow or unreliable exports.

## Acceptance and testing

- Add durable fixtures for sparse/dense scenes, rotated walls, openings, negative coordinates, irregular venues, long German names, Unicode text, many warnings, oversized elevations and multi-scene packages.
- Verify physical dimensions at every supported scale: a 1200 mm edge measures 48/24/12 mm at 1:25/1:50/1:100, within 0.1 mm in PDF coordinates.
- Assert complete geometry coverage, valid sheet/frame bounds, no unintended text collisions, correct pagination, repeated headers, bookmarks, tile references and global numbering.
- Rasterize representative PDFs for visual regression checks across A4/A3, both orientations and grayscale. Review them at printed size; text/path assertions alone are insufficient.
- Verify preview and issued artifacts match, preparation leaves history untouched, stale previews cannot be issued accidentally, and retries ignore subsequent scene/template/asset changes.
- Exercise composer persistence, undo/redo, keyboard-only operation, template reuse across scenes, saved cameras, failed 3D rendering, cancellation, expired previews and permission boundaries.
- Run existing unit, integration and browser suites, plus a production-container smoke test for fonts and Chromium.
- Usability gate: a crew member can export the current scene without editing its layout, identify scale and revision on every sheet, and recover from a failed export without losing settings.

Defaults: A4, 1:50, automatic orientation chosen to minimize sheet count, current scene selected, and existing layer defaults. Custom layouts may mix page sizes and frame scales. Large-format plotting, arbitrary HTML frames and formal PDF/UA certification remain outside this delivery.
