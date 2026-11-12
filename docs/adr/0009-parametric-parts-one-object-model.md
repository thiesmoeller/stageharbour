# Model stage elements as parametric parts on one object model

Each group builds different set elements, and a developer cannot add a coded kind for every one. Stage elements become group-defined parametric parts (**Bauteile**) authored in the **Bühnentechnik-Designer**. A Bühnenbild (layout schema v2) is one list of objects, each a placement of an immutable part revision, plus joints between typed connectors. Walls, braces, platforms, stairs and placeholders stop being separate kinds with their own code paths. This amends [ADR 0005](0005-bestand-workspace.md) and [ADR 0006](0006-physical-panel-finishes.md), see below.

## Decisions

- **Formulas, not scripts.** Parameter values and derived values are formulas: numbers, parameter names, `+ - * /`, brackets, the comparisons `< <= > >= == !=` (1 or 0, so that `if` can test a size), and the functions `min max abs round floor ceil sqrt if`. A hand-written parser evaluates them; there is no `eval`. This overrides the exclusion of calculation expressions in the [elements spec](../travelling-group-elements-spec.md).
- **Parameter scopes.** Each parameter is set by the variant, by the placement, or by the Bühnenbild state (door open, curtain open). A part also carries a table of named variants, so a group owns 2 × 1 m and 1 × 1 m decks instead of free-range 1.37 m ones.
- **Bodies name a stock material.** A part is built from simple bodies (beam, sheet, box). Each body names a stock material (for example Latte 40 × 40, Sperrholz 12 mm), so the cut list and weight derive from the geometry and cannot drift from the shape. Only hardware and ballast are listed by hand.
- **Child parts.** A part can contain other parts. A Podest is deck modules plus Steckfüße, each counted and stocked.
- **Typed connectors and composable traits.** Parts declare connectors (hinge edge, brace mount, deck edge, leg socket) and traits (walkable surface, finishable faces, stock tracking). Hinge connections, brace alignment and deck legs are one mechanism: joints between connectors. In the first pass a connector kind mates only with the same kind or one listed partner kind; there is no further rule engine.
- **Immutable revisions.** Saving a part creates a new revision. Placements reference id + revision, so ten Bühnenbilder of one production cannot drift apart. Frozen documents inline the definitions they used.
- **Stock.** Stock items (one labelled piece of one part variant) replace inventory panels. Stock counts replace inventory ballast and also cover Steckfüße and similar unlabelled stock.
- **One-time conversion.** A script converts saved Bühnenbilder, templates and the demo seed to schema v2. Issued revisions keep their stored PDF and are not re-rendered. If existing data can be discarded, the script is dropped. Before any per-kind code is deleted, golden outputs from the current code (footprints, solids, warnings, parts lists, plan PDF) become the regression net.
- **The venue shell stays coded.** Outline, fixed walls, fixed stage platforms, keep-clear zones and trusses describe the room, not the group's kit. Venue furniture such as chairs becomes parts.
- **Exchange.** One workspace per installation stays. Groups exchange part libraries as files validated by a published JSON Schema. A resolved Bühnenbild exports as glTF and as MVR (DIN SPEC 15801) so lighting and visualiser tools can load the set.

## Amends earlier ADRs

- **[ADR 0005](0005-bestand-workspace.md) (Bestand):** Bestand no longer manages "physical panels" and "wall types". It manages part libraries, stock items and stock counts. Wall types, including doors and windows, become parts. The Bestand route and the rule that crews design first and assign stock later stay.
- **[ADR 0006](0006-physical-panel-finishes.md) (physical panel finishes):** the finish assignment and physical finish mechanism stays, but attaches to a stock item and the finishable faces of its part instead of to a physical wall panel. Per-panel technical cutouts become a stock-item detail.

## Considered and rejected

- **B-rep or CSG kernel, sketch constraints, node graphs, user scripts.** General CAD power the crew's decisions do not need. Sheets with holes and beams cover flats, frames and decks.
- **USD as storage, AAS or DTDL twin schemas.** Built for large pipelines and live telemetry, which this twin does not have. glTF and MVR cover exchange.
- **Five kinds plus parts behind codecs.** The first draft kept `walls`, `braces`, `platforms`, `stairs` and `placeholders`, added `parts`, and migrated kind by kind. One object list is simpler and nothing has to stay compatible.
- **One behaviour per part.** It cannot describe a wagon that is both a walking surface and carries flats; traits and connectors can.
- **Definition copies embedded in every Bühnenbild.** Copies let ten Bühnenbilder of one production drift apart. Revisions referenced by id plus inlining in frozen documents avoid that.
- **Free ranges only for dimensions.** Groups own specific sizes, so variants are first-class.
- **A separate formula list for the cut list.** It could drift from the shape; deriving from bodies cannot.
- **Real-time co-editing.** Exclusive leases fit small volunteer crews.

## Consequences

- Layout schema v2 and the per-kind modules change most of `src/shared` and the editor core. Existing per-kind tests cannot serve as the net once their modules go; the golden outputs and browser journeys do.
- Connector rules can grow into a rule engine; the first-pass limit above is deliberate.
