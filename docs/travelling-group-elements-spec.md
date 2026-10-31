# Travelling theatre groups and configurable set elements

Status: **working product spec** · 21 October 2026

This document is for discussion and refinement. It describes the intended behaviour, a first implementation slice, and decisions still to make. It does not authorize implementation or deployment.

## Product premise

A **theatre group** creates productions and travels with its own scenery, equipment, and stock. A **venue** is a place where the group performs. The group may stage the same production at several venues, changing the arrangement to fit each space while retaining the identity of its own physical pieces.

The current planner already has group-scoped workspaces and inventory, versioned venues, venue adaptations, stage layouts (**Bühnenbilder**), and frozen documents. It is optimized for one group's walls, weighted rear braces, and ballast. The next product step is to let each group describe the set elements it actually builds with, then carry those elements through planning, venue adaptation, stock review, and construction output.

## Outcomes

1. A group can define and reuse its normal set elements without asking a developer to add each variant.
2. A designer can place an element before a particular physical item is assigned.
3. A venue adaptation keeps the group's design intent while checking the destination venue's geometry and constraints.
4. A crew can distinguish planned placements, required stock/materials, assigned physical items, and unresolved issues.
5. An issued document remains understandable and unchanged after catalog, stock, stage-layout, or venue edits.
6. The core workflow remains usable on ordinary laptops as the number of productions and placements grows.

## Scope and ownership

| Concept | Owner | Meaning |
| --- | --- | --- |
| Element definition | Theatre group | A reusable description of a kind of set element, including shape, dimensions, allowed adjustments, and build requirements. |
| Physical stock item | Theatre group | One labelled, reusable object the group actually owns, with condition and availability. |
| Bulk stock item | Theatre group | A counted material or accessory, such as a weight or strap, with a unit and available quantity. |
| Stage-layout placement | Stage layout | One instance of an element at a position, with permitted overrides and an optional physical assignment. |
| Venue geometry and constraints | Venue version | The room, supporting surfaces, obstructions, keep-clear areas, and permanent features at that location. |
| Venue adaptation | Production | The group's design arranged for a venue version. Changes between adaptations are explicit. |
| Issued document | Frozen revision | The design, venue, assignments, requirements, warnings, and definitions as they were when issued. |

A separate installation for each group remains a valid first way to serve multiple groups. Shared hosting and self-service group provisioning are separate product decisions. In either case, one group's catalog, stock, and documents must not appear in another group's workspace.

## Vocabulary for this spec

**Element definition** is the working name for a group-owned reusable type. It differs from a **placement**, which is one appearance in a Bühnenbild, and from a **physical stock item**, which is one real object. Existing `AssetDefinition`, wall type, physical panel, brace, and placeholder records remain distinct until a migration proves which can be unified.

**Material requirement** is a quantity demanded by a placement or assembled group. It does not claim that the material has been reserved or packed.

**Assignment** links a placement to a compatible physical stock item. The same item may appear in successive Bühnenbilder of one production; those appearances are not automatically separate stock demand.

## User journeys

### Set up the group's catalog

An editor opens **Bestand**, creates a named element definition, chooses a supported shape, enters millimetre dimensions and permitted adjustments, and sees a 2D footprint and 3D preview. They can add a simple material recipe using named stock items and quantities. The definition can be used immediately without first registering every physical copy.

When the group owns numbered copies, an editor records them as physical stock and links each to a compatible definition. Unlabelled or consumable materials are recorded as counted stock instead. Default examples are visibly examples; the app never presents them as the group's real inventory.

### Design a production

A designer uses one **Einfügen** flow to find a definition and place it in a Bühnenbild. The placement is independent of later catalog edits unless the designer explicitly chooses to update it. Position, rotation, supporting surface, and allowed size or appearance overrides are edited in one selection inspector. A placed element may stay unassigned.

### Adapt the design to a venue

The designer copies a base design or existing adaptation to another venue. The app transfers movable placements, maps supporting surfaces explicitly, and checks the destination venue's bounds, overhead clearance, and keep-clear zones. Existing physical assignments are cleared on a cross-venue copy under the current rule, with a summary of what was cleared and what needs reassignment. Definition identity and frozen shape remain available so stock can be assigned again.

Venue-owned walls, platforms, hang equipment, and constraints stay with the venue. Group-owned scenery and stock do not become venue records simply because they were used there.

### Prepare and issue a build

The crew sees demand across the chosen Bühnenbilder for a venue visit: required physical pieces, counted materials, assigned items, shortages, and unresolved placement warnings. The app counts an item reused across successive Bühnenbilder once for a single visit, while preserving every appearance and assignment. The crew reviews and issues a frozen plan/package; later changes produce a new revision.

The app must state the scope of every count. It must not infer simultaneous demand from two productions or promise availability on a date without an explicit scheduling model.

## First release: configurable elements

### Definition fields

Each definition has a stable group-scoped ID, name, category for browsing, revision, description, supported geometry kind, default dimensions, allowed parameter ranges, optional visual asset, and a material recipe. Archived definitions remain resolvable from existing placements and issued revisions.

The initial geometry kinds should be a **finite, validated set**, for example panel with openings, rectangular volume, and platform footprint. A GLB may improve the visual representation but cannot be the only source of a measured footprint, height, or collision behaviour. Each kind exposes the same minimum planning facts: plan footprint, vertical extent, supported placement surfaces, and whether it participates in clearance and keep-clear checks. Geometry that cannot be represented accurately must be labelled approximate in the UI and output.

Dimensions and recipe quantities use bounded, typed fields. A group can change values and choose from supported rules; arbitrary user scripts, custom executable geometry, and user-defined calculation expressions are outside the first release.

### Placement contract

Each placement stores its own ID, definition ID, definition revision, resolved planning snapshot, label, position, rotation, supporting surface, permitted overrides, and optional physical assignment. Copying, undo, groups, selection, snapping, 2D, 3D, warnings, and exports must all operate on it. A placement whose definition is archived must still load, edit, and export. Missing or incompatible stock produces an actionable warning and does not erase the placement.

The group catalog is a starting point, not a live master of all stage layouts. A published definition edit creates a new revision. Existing placements retain their previous definition values until an explicit update with a preview of changed geometry and requirements. Issued documents always retain their frozen values.

### Stock and requirements

Reusable physical items have a permanent label, definition/compatibility data, availability, and notes. Counted stock has a name, unit, and available quantity. A recipe lists demanded quantities per placement or per explicitly modelled assembly; the UI displays which rule was used. The current brace choices (no, one, or heavy ballast) can initially map to recipes for slabs and straps without changing their established counts.

Requirements are calculated at three visible scopes: one Bühnenbild, one venue adaptation or visit across selected Bühnenbilder, and a chosen issued package. The calculation must preserve both total appearances and distinct reusable physical items. An unassigned placement contributes demand but cannot be shown as a confirmed item to pack.

### Venue checks and documents

Every supported element kind contributes a measured footprint and height to destination-venue checks. Warnings remain reviewable and can be saved; they appear in issued construction output. A new kind is not complete when it only renders in 3D: it must appear in selection, preview, copying, stock/recipe summaries, warnings, and the frozen PDF/SVG path relevant to that element.

## Interface and performance requirements

- Use one searchable insertion surface for group elements. In **Bestand**, separate definitions, physical items, and counted materials with plain labels and concise explanations.
- In the inspector, show **definition**, **placement values**, **assigned real item**, and **issues** as separate concepts. State when a catalog revision differs from the placement's snapshot.
- Before cross-venue copying or issuing, summarize cleared assignments, unmapped support, shortages, and spatial warnings, with links that focus the affected placement.
- Keep the 2D canvas and selection usable on narrow screens; the properties sheet must not obscure the only route to the selected object or save status.
- Do not load all full layout and venue JSON solely to show a production gallery. A list response should use bounded summaries/previews and fetch full records on opening.
- Recompute geometry diagnostics from a stable layout/venue state, not separately for each UI render. Use a representative dense layout and a lower-powered laptop to set actual load and interaction budgets before claiming performance targets.
- Keyboard users must be able to insert an element, edit numeric properties, inspect warnings, and issue a document without dragging. Tabs and dialogs must follow their declared interaction patterns.

## Compatibility and migration

Existing saved walls, braces, physical panels, ballast stock, templates, venue adaptations, and issued revisions must continue to load. Migration should be additive first: introduce the new definition/placement path, map existing walls and braces into it where semantics match, and keep legacy readers until every dependent workflow has moved. Preserve panel labels, finish assignment snapshots, assembly numbers, rigging setup IDs, and opening geometry.

Do not silently replace an existing wall or brace with an approximate generic object. A migration test should compare geometry, stock demand, warnings, and frozen output before and after conversion. The current `schemaVersion: 1` layout and frozen document schemas require explicit versioning or compatible decoding for any persisted shape change.

## Implementation slices and acceptance

1. **Catalog and one new kind.** Add group-owned definitions and a simple kind that is genuinely different from a wall or brace. Create it in Bestand, place it from Einfügen, and reload it. A group can use two dimension variants without code changes.
2. **Complete planning path.** Support select, transform, copy, group where applicable, supporting surfaces, 2D/3D, overlap, overhead, and keep-clear checks for that kind. Editing a definition leaves existing placements stable until explicit update.
3. **Stock and requirements.** Add compatible physical items and counted materials. Show planned demand, assigned items, shortage, and the scope of counts across successive Bühnenbilder. Preserve current panel and ballast behaviour.
4. **Venue adaptation and output.** Transfer the new kind to a second venue, report support/clearance issues, clear cross-venue physical assignments under the current rule, and include the object and its requirements in a frozen package. Re-download after editing the source and confirm the issued file is unchanged.
5. **Scale and usability.** Replace full-document gallery reads with summaries, remove duplicate diagnostic work, measure a multi-production workspace and dense Bühnenbild, and run the complete journey with at least two groups that use materially different element systems.

Each slice needs domain tests for geometry/counting, integration tests for ownership and persisted revisions, and a browser journey crossing catalog → placement → venue adaptation → document. A generic element feature is incomplete if any part of that journey silently drops it.

## Open decisions for the next discussion

1. **First non-wall kind:** Which real object from another travelling group should prove the model: a reusable platform module, a rolling scenic unit, a freestanding set piece, or something else? We need its actual dimensions, footprint, height, assembly, and stock rules.
2. **Definition versus one-off:** Should a designer be able to create a one-off definition inside a Bühnenbild and later promote it to the group catalog, as wall types can today?
3. **Cross-venue assignments:** Should the current rule always clear physical assignments, or should a user be offered a reviewed carry-over when the same group is transporting the same objects?
4. **Counted materials:** Which stock is tracked as reusable units, which as consumable quantities, and what constitutes one venue visit for requirements?
5. **Assemblies and connections:** Which new elements require explicit joins or nested assemblies, beyond today's wall connections and groups?
6. **Catalog revision UI:** Who may publish a revised definition, and how should the app present a placement whose catalog revision has changed?
7. **Installation model:** Is the target separate self-hosted workspaces for groups, a managed multi-group platform, or both? This affects onboarding and operations, not the ownership rules above.

## Current code seams

The relevant current modules are [`src/shared/assets.ts`](../src/shared/assets.ts) (wall/brace/model templates), [`src/shared/layout.ts`](../src/shared/layout.ts) (separate wall and brace placements), [`src/shared/inventory.ts`](../src/shared/inventory.ts) and [`src/shared/ballast.ts`](../src/shared/ballast.ts) (stock and requirements), [`src/shared/scenes.ts`](../src/shared/scenes.ts) (copy/adaptation rules), and [`src/shared/package.ts`](../src/shared/package.ts) (frozen parts lists). The product flow lives mainly in [`src/client/editor/AssetLibrary.tsx`](../src/client/editor/AssetLibrary.tsx), [`Bestand.tsx`](../src/client/editor/Bestand.tsx), and [`Editor.tsx`](../src/client/editor/Editor.tsx).

This spec builds on [ADR 0001](adr/0001-explicit-venue-adaptations.md) and [ADR 0005](adr/0005-bestand-workspace.md). A later ADR is warranted only after the definition revision and migration choices are decided, because those choices are costly to reverse.
