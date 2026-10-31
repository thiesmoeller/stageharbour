# Trek export designer reuse review

Reviewed 2026-10-31. Planner checkout `286a288`; Trek checkout `f4e524f3c` at `<trek-checkout>`. Source review only: no Trek application, print output or browser interaction was exercised. Neither application's runtime code was changed.

## Recommendation

Use **TREK Studio as a reference for the optional sheet composer**, while retaining the planner's document model, measured vector renderer and preparation/issuance workflow. Its best reusable parts are interaction geometry and editor UX. It is a substantial application feature, not an upstream export-designer package that can be installed and configured. The Studio shell imports journey-specific loading, authentication, routing, provider pickers, assistant features and application styles directly. [StudioShell.tsx](<trek-checkout>/client/src/components/Studio/StudioShell.tsx:1)

There are two different export experiences in Trek: the ordinary trip export dialog offers PDF/calendar/GPX, while **Studio** edits printable photo-book pages. Studio is the relevant designer; the ordinary dialog is not a page-layout editor. [TripExportModal.tsx](<trek-checkout>/client/src/components/Planner/TripExportModal.tsx:50), [StudioShell.tsx](<trek-checkout>/client/src/components/Studio/StudioShell.tsx:107)

## What is valuable to reuse

| Capability | Concrete Trek source | Fit for this planner |
| --- | --- | --- |
| Millimetre-based sheet geometry | [book.schema.ts](<trek-checkout>/shared/src/book/book.schema.ts:12) | Matches the planner's paper-space millimetres. Keep the separate model-space units and drawing scale. |
| Resize handles, aspect lock, selection bounds and marquee selection | [studioGestures.ts](<trek-checkout>/client/src/components/Studio/studioGestures.ts:10) and its adjacent tests | Best extraction candidate. Adapt `{x,y,w,h}` to `DocumentFrame`'s `{x,y,width,height}` and its minimum dimensions. The module still imports Trek grouping helpers, so it is not directly independent. |
| Magnetic edges/centres and visible snap guides | [useSpreadInteraction.ts](<trek-checkout>/client/src/components/Studio/useSpreadInteraction.ts:84) | Reuse the algorithms and behaviour, replacing book gutter/bleed targets with sheet margins, title block and other frames. The six-screen-pixel tolerance is converted through pixels per millimetre, keeping the interaction consistent under zoom. |
| One drag or held arrow key = one undo step | [studioStore.ts](<trek-checkout>/client/src/store/studioStore.ts:207), [useStudioKeys.ts](<trek-checkout>/client/src/components/Studio/useStudioKeys.ts:128) | Planner already has `begin/preview/finish`, undo and redo in [useDocumentDraft.ts](../src/client/editor/useDocumentDraft.ts:27). Extend/reuse that mechanism rather than adding a second document store. |
| Page thumbnails with duplicate, move, insert and remove actions | [StudioPagesPanel.tsx](<trek-checkout>/client/src/components/Studio/sidebar/StudioPagesPanel.tsx:31) | Strong fit for ordered `DocumentPage[]`; remove single/double-spread and cover rules. Measure actual thumbnail container width as Trek does. |
| Numeric X/Y/width/height inspector alongside direct manipulation | [StudioPositionSection.tsx](<trek-checkout>/client/src/components/Studio/inspector/StudioPositionSection.tsx:29) | Useful for exact placement and a non-dragging alternative. Respect planner rotations of 0/90/180/270 degrees rather than importing arbitrary angles. |
| Familiar keyboard selection, duplicate, clipboard and nudge behaviour | [useStudioKeys.ts](<trek-checkout>/client/src/components/Studio/useStudioKeys.ts:19) | Adopt the small relevant subset, including input/contenteditable guards and platform modifier handling. |
| Template thumbnails run the same layout function as template application | [templatesModel.ts](<trek-checkout>/client/src/components/Studio/templates/templatesModel.ts:16) | Good principle for venue report-template cards; render from the planner's actual layout manifest. |
| Save a layout without keeping the original page's content references | [book-saved-layouts.ts](<trek-checkout>/shared/src/book/book-saved-layouts.ts:34) | Apply the principle to scene IDs, group IDs and captured images. Venue templates must retain generic source selectors, not another production's content. |

Trek's gestures are implemented directly with pointer events, not an external canvas/editor toolkit. The hook connects to a Zustand store and Trek grouping operations. There is no need to introduce a drag-and-drop library to reproduce this behaviour. [useSpreadInteraction.ts](<trek-checkout>/client/src/components/Studio/useSpreadInteraction.ts:1)

## Existing planner foundation and actual gap

The backend already accepts a versioned `ExportDocumentSpec` with custom pages and frame types for plans, elevations, 3D, notes and schedules. Frames carry explicit sources, crops, scales and saved cameras; custom pages are limited to 80, with up to 40 frames per page. The measured compositor already dispatches to `composeCustom` when custom pages are present. [exportDocument.ts](../src/shared/exportDocument.ts:95), [document schema](../src/shared/exportDocument.ts:118), [custom page dispatch](../src/shared/exportDocument.ts:1003)

There are also helpers to seed an editable page from current settings and to adapt venue report templates. These are better integration seams than translating a `BookDocument` into a construction PDF. [editablePagesFromSettings](../src/shared/exportDocument.ts:1458), [documentPagesFromTemplate](../src/shared/exportDocument.ts:1489)

The active recipient-oriented workspace currently configures purpose, scope, contents and paper/scale; it saves a production document draft and previews the generated PDF in an iframe. It has no page/frame manipulation interface. The separate `ReportSheetEditor` is explicitly labelled a draft whose placement does not control issued PDFs; it operates on the first template and first page. Thus the opportunity is to finish the existing composer path, not replace the entire export system. [RecipientDocumentWorkspace.tsx](../src/client/editor/RecipientDocumentWorkspace.tsx:154), [preview](../src/client/editor/RecipientDocumentWorkspace.tsx:305), [ReportSheetEditor.tsx](../src/client/editor/ReportSheetEditor.tsx:27), [draft notice](../src/client/editor/ReportSheetEditor.tsx:104)

This aligns with the existing [PDF export plan](pdf-export-plan.md): useful automatic output first, then optional “Layout bearbeiten,” reusable venue templates and an actual PDF proof.

## Rendering and persistence boundaries

**Keep planner PDF generation.** Trek renders its own React page components offscreen, captures their HTML, and creates a browser print view with copied stylesheets and CSS `@page` sizes. That is a good photo-book workflow, but it does not provide the planner's stored preview artifact and immutable issue operation. The planner already produces vectors and embedded fonts with PDFKit, converting millimetres to points, and fetches a prepared PDF before issuing it. [StudioExport.tsx](<trek-checkout>/client/src/components/Studio/StudioExport.tsx:55), [printSheets.ts](<trek-checkout>/client/src/components/Studio/printSheets.ts:117), [documentPdf.ts](../src/server/exports/documentPdf.ts:6), [prepare and issue](../src/client/editor/RecipientDocumentWorkspace.tsx:166)

**Separate viewport resizing from drawing scale.** Trek proportionally scales element frames and saved layouts; construction plans must retain their issued 1:25/1:50/1:100 scale. Resizing a frame should alter the viewport/crop and coverage diagnostics, with scale changes explicit. Never use Trek's proportional page adaptation to stretch construction geometry. [mapFrame](<trek-checkout>/client/src/components/Studio/studioGestures.ts:81), [applySavedBookLayout](<trek-checkout>/shared/src/book/book-saved-layouts.ts:82), [planner frame scale](../src/shared/exportDocument.ts:125)

**Keep planner ownership and authorization.** Trek books belong to journeys; its autosave uses a 1.2-second quiet period, a maximum 15-second wait, optimistic versions and websocket broadcasts. Those are useful design references, not a compatible persistence layer. Planner document drafts belong to productions and report templates belong to venues. Use the existing endpoints and consciously design conflict handling if autosave is added. [useBookStore.ts](<trek-checkout>/client/src/components/Studio/useBookStore.ts:69), [planner draft save](../src/client/editor/RecipientDocumentWorkspace.tsx:154), [documentRoutes.ts](../src/server/exports/documentRoutes.ts:35)

**Preserve the actual PDF proof.** Fast frame previews can use a rendering of the planner's measured layout; a final prepare must still regenerate the PDF after composition changes before issuance. Trek's shared-component preview principle is useful, but the exact browser HTML is not the planner's authoritative artifact. 3D remains a captured/raster frame, not a scalable construction drawing. [composeCustom](../src/shared/exportDocument.ts:1230), [planner image handling](../src/server/exports/documentPdf.ts:84)

**Retain responsive requirements.** Trek Studio explicitly displays a desktop-only message on mobile. Do not inherit that restriction accidentally: the planner's existing plan calls for settings/preview switching and numeric alternatives on narrow screens. [StudioShell.tsx](<trek-checkout>/client/src/components/Studio/StudioShell.tsx:49), [PDF export plan](pdf-export-plan.md)

## Dependencies and reuse terms

The relevant Trek pieces use React, Zod, Zustand, Lucide icons, application CSS and the internal `@trek/shared` workspace. React and Zod already exist in the planner. Zustand and Lucide are optional implementation choices: the planner already has document history and an icon component. Importing `@trek/shared` wholesale would also pull in the book domain, templates, travel data and many unrelated rendering concepts. [studioStore.ts](<trek-checkout>/client/src/store/studioStore.ts:1), [StudioShell.tsx](<trek-checkout>/client/src/components/Studio/StudioShell.tsx:1), [planner ReportSheetEditor imports](../src/client/editor/ReportSheetEditor.tsx:1)

Trek's checked-in source declares **GNU AGPL version 3**, rather than a permissive component licence. No separate permissive licence for the inspected Studio files was found. Treat source copying or extraction into this repository as an explicit licensing decision; this review does not establish ownership or an alternative grant. Its trademark policy separately excludes trademark rights from the source licence. Font assets have their own notices (OFL/Apache), so copying the font catalogue also requires retaining the relevant asset notices. [LICENSE](<trek-checkout>/LICENSE:1), [README licence statement](<trek-checkout>/README.md:445), [TRADEMARKS.md](<trek-checkout>/TRADEMARKS.md:5), [font notices](<trek-checkout>/NOTICE.md:58)

## Suggested implementation slices

1. Add optional “Layout bearbeiten” to the recipient document workspace, seeded through `editablePagesFromSettings` and stored in `spec.customPages`. Keep automatic exports as the default. First expose page add/duplicate/reorder/delete and numeric frame placement.
2. Add pointer move/resize, visible snap guides, selection and keyboard nudging using the existing draft/history mechanism. Adapt the Trek geometry through a small frame interface if its licence is suitable; otherwise implement the desired interactions within the planner's own module boundaries.
3. Connect venue report-template selection and explicit template saving through `documentPagesFromTemplate`. Validate generic sources and show legacy repairs rather than silently binding templates to one stage layout.
4. Add accurate per-frame plan/elevation/3D proofing and preparation refresh on edits. Keep construction coverage diagnostics, physical scale, final PDF preview and immutable issue behavior as acceptance gates.

When implemented, verify one drag produces one undo step; zoom does not change snap feel; a 1200 mm wall stays 24 mm on paper at 1:50 after moving/resizing its viewport; template reuse changes the scene data without retaining old object references; custom page order survives draft reload; and the final prepared PDF matches what is issued. These are proposed acceptance checks, not tests executed in this review.
