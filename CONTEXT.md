# Community Theatre Stage Planning

The theatre group travels with its set and stock to different venues, each with its own physical constraints.

## Language

**Theatre group**:
A company that creates productions and travels with its own set elements and stock to venues. Its workspace owns the reusable catalog and physical inventory.
_Avoid_: Theatre as a synonym for venue

**Site branding**:
The product name, tagline, footer text and optional logo shown on the sign-in page and masthead for a self-hosted installation. Administrators set branding for the workspace; it is not per-production.
_Avoid_: Theme, skin

**Production**:
A theatre show whose set design can include multiple stage layouts and adaptations for different venues.

**Stage layout**:
The arrangement of set elements (walls, props, braces) for one set picture within a production. Different stage layouts can reuse and reposition the same physical wall elements. Code and API may still say `scene`; product language prefers stage layout / Bühnenbild.
_Avoid_: Scene (alone), State, Light scene
_Was_: Scene layout

**Play scene**:
A dramatic unit in the script (for example II/3). Vocabulary only until made first-class; it is not the editable set document. Several **light looks** may apply while one play scene and one stage layout stay fixed.
_Avoid_: Using “Szene” for the set document

**Base design**:
The reusable set design of a production from which venue adaptations are created.

**Stage layout template**:
A named, read-only snapshot of a stage layout used as a starting point for independent editable copies.
_Was_: Scene template
_Avoid_: Szenenvorlage as the only name once UI migrates

**Venue adaptation**:
A version of a production's set design arranged for a particular venue and its constraints.

**Construction plan revision**:
A named, frozen record of a design and its venue information corresponding to an exported construction plan.

**Venue**:
A location where the theatre group stages a performance, with its own physical layout and constraints; it does not own the group's set elements or stock.
_Avoid_: Location

**Report template**:
A reusable construction-sheet layout (plan crops and camera views on paper) that belongs to a **venue**. Every play adapted to that venue shares the same templates; only the stage design content changes per stage layout.
_Avoid_: Stage layout template (that is a set-design starting point)

**Venue version**:
A saved record of a venue's layout and constraints that an adaptation uses until explicitly updated to a newer version.

**Stage centreline**:
A reference line defined for a venue that marks the stage's lateral centre and serves as an alignment and symmetry reference.

**Explicit group**:
A user-defined set of set pieces that move and rotate together around the centroid of member centres. Panel connections are not groups.
_Avoid_: Auto-group

**Bauteil** (part):
A group-defined parametric stage element definition, authored in the **Bühnentechnik-Designer**. It is built from bodies of stock material and child parts, and declares parameters, variants, connectors and traits. Every stage element a group places is a placement of a Bauteil.
_Avoid_: Asset, Element definition (alone)

**Bauteil revision**:
An immutable saved revision of a Bauteil. Placements reference the part id and revision, so later edits to the part do not change existing Bühnenbilder until the crew updates them explicitly.

**Variante** (variant):
A named set of parameter values that the group actually owns, for example a 2 × 1 m deck or a 1 × 1 m deck. Dimensions the group does not own are not offered as variants.

**Parameter scope**:
Who sets a parameter of a Bauteil: the variant, the placement, or the Bühnenbild state (for example door open or curtain open).

**Verbinder** (connector):
A typed attachment point on a Bauteil, such as a hinge edge, brace mount, deck edge or leg socket. A connector mates only with the same kind or a listed partner kind.

**Joint**:
A connection between two connectors of two placed objects. It is the general mechanism for hinges, brace alignment and deck legs.
_Was_: Panel connection (as the general term)

**Trait**:
A composable capability of a Bauteil, such as walkable surface, finishable faces or stock tracking. A part can combine several traits.

**Stock material**:
A profile, sheet or hardware item with a weight, named by the bodies of a Bauteil so that cut lists and weight derive from the geometry. Only hardware and ballast are listed by hand.
_Avoid_: Material (alone)

**Wall element**:
A Bauteil that forms a wall face, such as the group's 1.20 × 2.40 metre panel. Openings are holes in its sheet, a Tür is a child part, and hinge-edge connectors let neighbouring wall elements join.
_Was_: Physical panel (the physical piece is now a Bestandsstück)

**Surface finish**:
How a face is clad in the Raumsicht: matte RAL paint, or a surface from the app-owned material library (wood, fabric, stone, …) with optional scale and grain direction. Not a Three.js material object.
_Avoid_: Material (alone)

**Face surfacing**:
The finish assignment for one wall face (audience front, back/Rahmen, or thickness edge). A face may be whole or split into a lower and upper band at a height from the panel floor. By default all three faces share one finish; crews may switch to per-face assignment when sides differ or bands are needed.
_Avoid_: Texture slot

**Grain direction**:
The rotation of a patterned library surface on a face (0° / 90° / 180° / 270°), used so wood planks and similar patterns run the intended way.

**Wall element type**:
A Bauteil variant or child part that gives a wall element its distinguishing features, such as a window opening or a Tür.
_Was_: Separate definition kind for wall elements

**Inventory template**:
A Bauteil as offered for insertion; placing one creates an independent stage-layout object referencing a Bauteil revision. The template is not itself a Bestandsstück label or a count of available pieces.
_Was_: Reusable definition of a wall element, weighted rear brace or scenic object

**Bestand**:
The workspace home for the group's Bauteile, Bestandsstücke and stock counts. Crews design stage layouts first and assign Bestandsstücke later; one-off parts may still exist only on a stage layout. The actual paint or wallpaper on a Bestandsstück is recorded here, separately from stage-layout designs.
_Avoid_: Materialien, Inventar (alone), Bibliothek

**Bestandsstück** (stock item):
One labelled physical piece of one Bauteil variant, kept across productions, venues and stage layouts.
_Was_: Physical panel

**Stock count**:
Counted, unlabelled stock such as ballast plates or Steckfüße, with a unit and an available quantity.
_Was_: Ballast stock

**Bühnentechnik-Designer**:
The workspace page at `#/designer` where a group authors its Bauteile: bodies, child parts, parameters, variants, connectors and traits, with live cut list and weight.

**Stage canvas**:
The app-owned 3D view used by the Raumsicht and the Bühnentechnik-Designer preview. It replaces the Pascal viewer.

**Scenic object**:
A prop or piece of scenery represented by a model with physical outside dimensions and a placement in a stage layout.

**Panel connection**:
A **joint** between hinge-edge connectors of neighbouring wall elements that contributes to keeping the assembled walls upright.
The group chooses nearly arbitrary connection angles by positioning and screwing on removable-pin scenery hinges during the initial rigging of a stage arrangement.

**Rigging setup**:
The mounted hinge configuration used across stage layouts within a venue adaptation. Remounting hinges establishes a separate rigging setup; removing and reinserting pins does not.

**Weighted rear brace**:
A Bauteil (Stützdreieck) placed behind a wall and weighted down, used by the group to stabilise longer straight runs of connected panels. It attaches through a brace-mount connector, and its ballast comes from stock counts.

**Panel label**:
A permanent identifier for a Bestandsstück of a wall element, retained across productions, venues, and stage layouts.
_Avoid_: Assembly number

**Assembly number**:
A number assigned from left to right during the initial assembly, used by the crew to establish panel order. It is distinct from a panel's permanent label.

**Venue constraint**:
A restriction on placement or use of space at a venue, such as a ceiling limit or an emergency exit path that must remain clear.

**Keep-clear zone**:
A designated polygonal area that must remain free of placed objects for a stated reason, such as an emergency exit route or access to equipment. Authors draw the polygon in the venue plan (click vertices, close near the first point) and can drag zone vertices.

**Connection point**:
A known power outlet or audio connection at a venue.

**Cable routing corridor**:
A part of a venue identified as suitable for routing the group's long cables.

**Cable run**:
An actual, scene-specific cable path from a labelled start to a labelled destination. It records purpose, cable type, quantity, route length, and handling slack. A cable run may follow a venue cable routing corridor, but the corridor remains guidance rather than a committed run.

**Raised platform**:
A stage floor area elevated above the venue's reference floor level. Platforms have a build style: floating (thin slab), solid (filled down to the next surface under the centroid), or Bühnenelement (a Bauteil whose variants are the stage-deck modules 2×1 / 2×0,5 / 1×1 / 1×0,5 m; each Steckfuß is a child part attached at a leg socket). Podiums may overlap in plan; Höhe über Fußboden stays absolute, and each Steckfuß lands on the next surface directly under that foot.

**Performance area**:
The space used for acting and set placement, which can span the audience floor, stairs, and raised stage surfaces.

**Stair unit**:
A set of steps connecting performance surfaces at different heights.

**Overhead obstruction**:
A physical structure above the stage area, such as a ventilation duct, that locally limits usable space and height.

**Traverse / hang bar**:
A venue lighting hang bar with plan length, section, and underside height. Optional hang points along the bar are the attachment seam for the hang plan ([ADR 0007](docs/adr/0007-stage-layout-and-light-looks.md)).

**Hang point**:
A reserved position along a Traverse centreline where a lighting fixture may be hung.

**Hang plan**:
The venue-owned assignment of lighting fixtures to hang points (what is hung where), including **default focus** (Grundausrichtung toward stage centre, pan/tilt, beam, Flügelblenden). Positions are usually fixed; technicians mainly adjust aim and barn doors. Full rehang is rare. Distinct from mood lighting and from light looks.

**Lighting fixture**:
A controllable stage light hung on a hang point (Scheinwerfer). Not a curtain, door, or placeholder.
_Avoid_: Fixture (alone) in UI — that word is overloaded with venue soft-goods/door selection in code

**Fixture type**:
A library definition of a lighting fixture (attributes, beam, physical size). Built-in first: Fresnel, Flood, Wash. GDTF interchange is optional later.

**Barn doors / Flügelblenden**:
Four hinged flaps on a Fresnel or flood that shape the beam. Attachment and flap angles belong to the **hang plan** focus (ladder work). Not profile shutters.

**Light board (session)**:
Raumsicht preview panel under the 3D view: Master, Grundlicht master, Blackout, and per-fixture on/level/colour. Session only until “In Look speichern”. Not a console or cue playback.
_Avoid_: Cue, Sequence, Executor, Playback, grandMA programmer

**Light look**:
A named snapshot of per-fixture **intensity and colour** for preview with a stage layout. Aim/focus lives on the hang. Looks are not cues or desk playback.
_Avoid_: Light scene, Cue, Sequence, Executor, grandMA programmer

**Mood lighting / Grundlicht**:
Coarse house or rehearsal fill (front/back/ambient) used in Raumsicht. Session board can scale it with one master. Not the hang plan or a light look. Session toggles can hide Traversen and Scheinwerfer in plan/3D so ground modelling stays clear.

**Molton curtain**:
A venue soft-goods track (theatre molton) with plan length, drop height, and a parametric opening (traveler from centre, or stack to one side). In the ground plan it uses the USITT wavy soft-goods symbol; in 3D it renders as matte black molton with vertical folds that gather when open.

**Placeholder**:
A labelled, resizable stand-in for furniture, a person figure, a speaker, or a generic box. Placeholders carry example millimetre dimensions, sit on an explicit supporting surface, and are not measured inventory or CAD models. Placeholders and venue furniture such as chairs are Bauteile in the starter library.
_Avoid_: Lighting fixture, CAD furniture

**Venue trace / underlay**:
An optional image or PDF page behind the venue plan. Authors import via file picker, drag-and-drop onto the underlay dropzone, or the “Aus Zwischenablage” button (not Ctrl+V — that pastes venue objects). Clipboard and non-PNG/JPEG rasters are converted to PNG client-side before upload. Scale and rotation are set inside the import dialog on a zoomable/pannable preview with a known-length measure line (Sweet Home 3D style), then applied to the main plan. Session display toggles can hide the underlay, object names, dimensions, or annotation texts without changing the saved venue.

**Person figure**:
A simple standing-person placeholder used to mark where someone would be on the set.

**Front elevation**:
An orthogonal construction-plan view of one wall facing from a selected explicit group, showing panel heights and opening dimensions at the issued scale. Angled groups produce one labelled face per distinct facing rather than a flattened overview of a corner.
_Avoid_: Flattened elevation

**Physical finish**:
The paint, wallpaper or cladding currently on a real panel, recorded after the work has been carried out. It can differ from the intended finish of a stage-layout wall.

**Finish assignment**:
The intended finish captured when a physical panel is assigned to a stage-layout wall. Later stage-layout edits do not change that record; the crew separately confirms when the work is complete.

**Technical cutout**:
A measured outlet or cable opening specific to one physical panel. It is a stock characteristic, distinct from a scenic door or window opening defined by the wall type.
