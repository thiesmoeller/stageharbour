# Model Bauteile directly in the 3D view; numbers only where the author made them parametric

The Bühnentechnik-Designer was a formula form with a preview. Crews without CAD looked at a desert of number fields to make a box taller. The Designer becomes a **direct modelling workspace**: the 3D view is where geometry is drawn and changed, and the author decides which dimensions become **Attribute** (a formula on a field) and which become **Optionen** (a parameter as the person placing the part sees it). Model first, then make chosen dimensions parametric.

This amends [ADR 0011](0011-face-openings-sketcher.md): its decision to draw openings „not by painting on the 3D mesh“ stays for openings (the face sketcher keeps that job), but bodies themselves are now drawn, pushed, pulled, moved and rotated on the 3D mesh. It keeps [ADR 0009](0009-parametric-parts-one-object-model.md): no B-rep, no CSG, no constraint solver; box, beam and sheet bodies with formula fields stay the storage and resolve model.

## Decisions

- **Model first.** Tools (Auswählen, Verschieben, Drehen, Drücken/Ziehen, Rechteck, Vieleck, Latte, Maßband, Ausprobieren) write plain millimetres into body fields. A drag is one undo step.
- **The formula rule.** When a tool touches a field that holds a formula: a number is overwritten; a bare parameter name (`B`) changes that parameter (its variant value in variant scope, else its default), so linked dimensions drive the model; any other formula wins, the handle shows a lock with the formula and the drag is refused. A formula that already lands on the dragged value once the parameters have moved (a centre `H / 2` while the top pulls `H`) follows and is no lock. A parameter pushed outside its range or between its listed values refuses the drag too.
- **Tools never switch on the body kind.** Each body kind declares its handles (face offset, point, edge, rotation) with position, drag axis and the fields it writes (`src/shared/parts/handles.ts`). Pure edit operations live in `src/shared/parts/directEdit.ts` and are unit-tested without a browser. A later body kind adds handles, not tool code.
- **Attribute.** The Attribute panel lists only fields that hold a formula, plus „Attribut hinzufügen“ (Position, Größe, Drehung, Material, Verborgen, Kopien). Clicking a dimension label on the canvas adds that attribute and offers „Als Option freigeben“, which creates a parameter and binds the field to it. The former formula inspector stays reachable as „Alle Felder“.
- **Optionen.** The Optionen panel renders parameters as a placer sees them, with the variant strip on top. Two additive optional parameter fields carry the presentation: `display` (`input`, `list`, `readonly`, `hidden`) and `valueLabels` (labels for listed values). Existing libraries stay valid.
- **Ausprobieren.** Clicking the part with the Ausprobieren tool toggles or steps its state-scope parameters (door open).
- **A Gruppe is an inline child; only a Komponente is a library Bauteil.** „Gruppe“ (G) stores the selection as `child.group`, a part definition on the parent with no library id. Move, rotate, Hidden and Kopien apply to that child, so a handle drawn inside a door follows the door. Groups nest. Double-click edits the inline definition in place and leaving writes it back without a library revision. „In die Bibliothek“ is the former library action: selected bodies become a new library part (revision 1) and one child; formulas that read parent names become parameters of the new part, passed through the child's `values`. Leaving a Komponente still saves a new revision and re-points this parent. „Auflösen“ explodes either kind into body copies.
- **Visible hardware.** A hardware box counts as one piece per resolved solid, so drawn ballast replaces the separate hardware line. Bodies that only illustrate a bought piece carry the additive body flag `displayOnly` („nur Darstellung“): they are drawn but neither counted nor weighed; the hardware line keeps the count.
- **Kernel gap A in this slice.** Profiles may declare a `round` or `tube` section (drawn as a cylinder; cut list unchanged by length). A `fabric` stock material kind has weight per m² and a hem allowance that the cut list adds to the cut size. A finish may `fit` the face instead of tiling. All additive and optional.

## Considered and rejected

- **A B-rep or mesh-editing kernel.** Rejected in ADR 0009; direct modelling here is a UI over formula fields.
- **Writing numbers over every formula a drag touches.** Destroys parametric parts silently; the lock keeps authored intent.
- **Tools that switch on box/beam/sheet.** Every new body kind (bent pipe, fabric, model) would touch every tool.
- **Making every group a library revision.** A door handle that only has to swing with the door is not a stocked Bauteil. The inline Gruppe keeps that rigid motion; the library action stays for parts that are reused.
- **Counting strap bodies as hardware.** One strap drawn as several straight pieces would count several times.

## Consequences

- The Designer layout becomes a full-height canvas with a tool rail, a value box („Maße“) and right-hand tabs Optionen, Attribute, Gliederung, Zuschnitt, Prüfung.
- Browser tests position the pointer from a `data-` readout of projected handle points, as the stage canvas harness does.
- **Gap B starts with circle outlines.** A sheet `outline` may be `{ shape: 'circle', cx, cy, r, segments? }` (formula fields). Resolve tessellates to a polygon loop; handles expose centre and radius, not every chord vertex. Full arcs / partial sweeps remain a later gap-B slice. Bent beam paths (gap C) and model bodies (gap D) remain separate slices; each adds handles, not tools.
