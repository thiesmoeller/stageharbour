# Release fixes — persistent work log

Scope: all 17 findings in [the review](release-ui-ux-review-2026-09-27.md). Work sequentially; record checks before marking done. No commits or deployment requested.

## Checklist

- [x] 1. S01/S02: protect pending edits and isolate modal commands.
- [x] 2. F01/F02: prevent stale venue publication and preserve sibling templates.
- [x] 3. S03/S04/S10: consistent venue fields and approved route departure.
- [x] 4. F03/F04/F05: export retry, automatic-layout editing and correct download.
- [x] 5. F06/F07: custom stocked types and editable panel metadata.
- [x] 6. S06/S07/S08/S09: Help, branding, account and revocation.
- [x] 7. S05: readable editor controls; responsive check.
- [x] 8. Run full build/unit/integration/browser checks; inspect final diff.

## Decisions and evidence

- Baseline review: build, 43 unit files, 98 integration tests, 35 browser tests passed despite reproduced defects. Reuse review reproduction evidence; add targeted behavioral regressions.
- Budget: concise updates, no delegated agents, targeted reads and checks per batch; one full suite at the end.

## Current step

All 17 findings addressed. Full suite: 303 unit, 99 integration, browser suite green after bestand geometry isolation for shared e2e DB.

1. S01/S02: added pending-command guards, discard-before-delete/cut/undo, modal keyboard exclusion and inert background. `confirm-dialog.spec.ts --grep "pending deletion"` failed before fix, passed after (1 test).
2. F01/F02: template PATCH merges by ID, checks current pin and optional expected version. Old pins receive actionable 409 instead of republishing geometry; sibling templates survive. New integration regression failed before fix, passed after (1 test). No schema migration needed.
3. S03/S04/S10: venue name and buffered stage-deck numbers participate in dirty/leave protection; Plans/Venues no longer veto a confirmed route change. `confirm-dialog.spec.ts` regressions for leave, name pending, and buffered typing passed (3 tests).
4. F03/F04/F05: retry token re-runs preparation; Layout bearbeiten seeds pages from current settings; toolbar download uses the displayed preview blob. Unit + `exports.spec.ts` regressions passed.
5. F06/F07: panel creation resolves catalogue types; panel label/note PATCH + edit UI. Integration + `bestand.spec.ts` passed. Custom Bestand type uses 1100 mm width so it does not mask layout shortage warnings in shared e2e DB.
6. S06–S09: help topics under `#/hilfe/:topic`; logo form reset captured before await; password-only account content; revoke confirmation. help/branding/workspace regressions covered.
7. S05: tool-rail captions 11px (2-line clamp), wider rail, save-status 12px; narrow mode matched.
8. Full checks: unit 303, integration 99, browser suite passed (layout re-verified with bestand isolation).
