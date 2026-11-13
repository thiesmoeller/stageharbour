# Author sheet openings in a face sketcher; keep SolidCraft as a future importer

Theatre techs without CAD should add window and door pockets on a wall sheet by drawing on the face, not by editing hole formulas. The Bühnentechnik-Designer gains a **face / elevation sketcher** on the selected sheet. Drawn openings still resolve as today’s sheet holes; the sketcher writes and maintains **per-hole parameter groups**. A later SolidCraft.io plugin may export optimized assemblies into the part library — StageHarbour does not load native `.sc` designs as editable Bauteile.

This refines [ADR 0009](0009-parametric-parts-one-object-model.md): formulas and beam/sheet/box bodies stay the storage and resolve model. Sketching is an authoring surface over holes and parameters, not a B-rep or constraint kernel.

## Decisions

- **Openings before frames.** v1 is face openings (holes). Edge→beam frame sketching (e.g. Stützdreieck) is a later slice.
- **Audience.** Primary author is a theatre tech who does not know CAD. Complex shapes remain available; they are not the onboarding path.
- **Where.** Draw in an elevation / face view of the **selected sheet body**, not by painting on the 3D mesh and not in a separate full-screen CAD mode.
- **What is stored.** Each drawn opening becomes a sheet `holes[]` entry. The sketcher creates or updates a **parameter group per hole** (e.g. left, sill, width, height — or the fields that shape needs) and binds the hole formulas to those parameters. The formula inspector stays available; it is not required for the happy path.
- **Shapes.** All hole shapes the kernel already supports (**rect, arch, polygon**) can be drawn. Main toolbar leads with **rectangle** and **arch**; **polygon** sits under „Weitere Form“ so non-CAD users are not forced through vertex editing first.
- **Tools in v1.** Create, select, move, resize, delete. No sketch constraints solver.
- **Sliding windows.** A Schiebeflügel starter comes **after** the sketcher ships; hinged door already exists as a child part pattern.
- **Success.** A non-CAD person duplicates a wall part and adds a window pocket without reading formulas (manual check on the browser demo, plus e2e coverage of the draw→save path).
- **SolidCraft later.** Keep the workspace **library JSON / revision import** as the only import seam. Do not embed a SolidCraft runtime or treat `.sc` as an editable definition format. When their plugin API exists, a plugin can emit an optimized StageHarbour library package (definitions, materials, optional mesh extras). A short note here is enough until that API is real — no interchange schema yet.

## Considered and rejected

- **Native `.sc` / SolidCraft kernel inside StageHarbour.** Wrong product boundary; cut lists, stock and frozen PDFs need our resolve pipeline.
- **Drafting a full SolidCraft interchange schema before plugins exist.** Premature; the library file is the contract.
- **B-rep / CSG / constraint sketcher as storage.** Already rejected in ADR 0009; unchanged.
- **One shared `opening*` parameter set for every hole.** Blocks multiple pockets on one sheet.
- **Literal millimetres in holes with no parameters.** Fights placement/variant workflows and the “tweak without the sketcher” path.
- **Shipping edge→beam frames in the same slice as openings.** Scope risk; starters cover braces for now.

## Consequences

- Designer UI grows a face canvas bound to the selected sheet; PartViews SVG / 3D preview keep showing the resolved result.
- Starter **Wandelement** should move toward one parameter group per hole so multiple openings match the sketcher model (migration or new revision of the starter).
- Frames (edges → beams) and a SolidCraft plugin exporter remain explicit follow-ups, not silent scope.
