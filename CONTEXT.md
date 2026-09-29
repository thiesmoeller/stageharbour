# Community Theatre Stage Planning

The group plans stage arrangements made from reusable wall elements for different venues, each with its own physical constraints.

## Language

**Site branding**:
The product name, tagline, footer text and optional logo shown on the sign-in page and masthead for a self-hosted installation. Administrators set branding for the workspace; it is not per-production.
_Avoid_: Theme, skin

**Production**:
A theatre show whose set design can include multiple scene layouts and adaptations for different venues.

**Scene layout**:
The arrangement of set elements for a particular scene or state within a production. Different scene layouts can reuse and reposition the same physical wall elements.
_Avoid_: State

**Base design**:
The reusable set design of a production from which venue adaptations are created.

**Scene template**:
A named, read-only snapshot of a scene arrangement used as a starting point for independent editable copies.

**Venue adaptation**:
A version of a production's set design arranged for a particular venue and its constraints.

**Construction plan revision**:
A named, frozen record of a design and its venue information corresponding to an exported construction plan.

**Venue**:
A location where the group stages a performance, with its own physical layout and constraints.
_Avoid_: Location

**Report template**:
A reusable construction-sheet layout (plan crops and camera views on paper) that belongs to a **venue**. Every play adapted to that venue shares the same templates; only the stage design content changes per scene.
_Avoid_: Scene template (that is a set-design starting point)

**Venue version**:
A saved record of a venue's layout and constraints that an adaptation uses until explicitly updated to a newer version.

**Stage centreline**:
A reference line defined for a venue that marks the stage's lateral centre and serves as an alignment and symmetry reference.

**Explicit group**:
A user-defined set of set pieces that move and rotate together around the centroid of member centres. Panel connections are not groups.
_Avoid_: Auto-group

**Wall element**:
A physical panel used to construct a stage arrangement. The group's existing wall elements measure 1.20 × 2.40 metres.

**Surface finish**:
How a wall face is clad in the Raumsicht: matte RAL paint, or a Pascal library surface (wood, fabric, stone, …) with optional scale and grain direction. Not a Three.js material object.
_Avoid_: Material (alone)

**Face surfacing**:
The finish assignment for one wall face (audience front, back/Rahmen, or thickness edge). A face may be whole or split into a lower and upper band at a height from the panel floor. By default all three faces share one finish; crews may switch to per-face assignment when sides differ or bands are needed.
_Avoid_: Texture slot

**Grain direction**:
The rotation of a patterned library surface on a face (0° / 90° / 180° / 270°), used so wood planks and similar patterns run the intended way.

**Wall element type**:
A definition of a kind of wall element, including distinguishing features such as a window opening.

**Inventory template**:
A reusable definition of a wall element, weighted rear brace or scenic object. Placing a template creates an independent scene instance; the template is not itself a physical panel label or a count of available pieces.

**Bestand**:
The workspace home for physical panel stock and stocked wall-element types (including doors and windows as types). Crews design scenes first and assign panels later; one-off wall types may still exist only on a scene. The actual paint or wallpaper on physical panels is recorded here, separately from scene designs.
_Avoid_: Materialien, Inventar (alone), Bibliothek

**Scenic object**:
A prop or piece of scenery represented by a model with physical outside dimensions and a placement in a scene layout.

**Panel connection**:
A physical join between neighbouring wall elements that contributes to keeping the assembled walls upright.
The group chooses nearly arbitrary connection angles by positioning and screwing on removable-pin scenery hinges during the initial rigging of a stage arrangement.

**Rigging setup**:
The mounted hinge configuration used across scene layouts within a venue adaptation. Remounting hinges establishes a separate rigging setup; removing and reinserting pins does not.

**Weighted rear brace**:
A large triangular support placed behind a wall and weighted down, used by the group to stabilise longer straight runs of connected panels.

**Panel label**:
A permanent identifier for a physical wall element in the group's inventory, retained across productions, venues, and scene layouts.
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

**Raised platform**:
A stage floor area elevated above the venue's reference floor level. Platforms have a build style: floating (thin slab), solid (filled down to the next surface under the centroid), or Bühnenelement (catalog stage-deck modules 2×1 / 2×0,5 / 1×1 / 1×0,5 m with legs; size and height snap to that grid). Podiums may overlap in plan; Höhe über Fußboden stays absolute, and each Steckfuß lands on the next surface directly under that foot.

**Performance area**:
The space used for acting and set placement, which can span the audience floor, stairs, and raised stage surfaces.

**Stair unit**:
A set of steps connecting performance surfaces at different heights.

**Overhead obstruction**:
A physical structure above the stage area, such as a ventilation duct, that locally limits usable space and height.

**Traverse / hang bar**:
A venue lighting hang bar with plan length, section, and underside height. Optional hang points along the bar are reserved for later fixture placement; they do not place lights in this version.

**Molton curtain**:
A venue soft-goods track (theatre molton) with plan length, drop height, and a parametric opening (traveler from centre, or stack to one side). In the ground plan it uses the USITT wavy soft-goods symbol; in 3D it renders as matte black molton with vertical folds that gather when open.

**Placeholder**:
A labelled, resizable stand-in for furniture, a person figure, a speaker, or a generic box. Placeholders carry example millimetre dimensions, sit on an explicit supporting surface, and are not measured inventory or CAD models. Venue chairs use a built-in low-poly chair form.
_Avoid_: Fixture, CAD furniture

**Venue trace / underlay**:
An optional image or PDF page behind the venue plan. Authors import via file picker, drag-and-drop onto the underlay dropzone, or the “Aus Zwischenablage” button (not Ctrl+V — that pastes venue objects). Clipboard and non-PNG/JPEG rasters are converted to PNG client-side before upload. Scale and rotation are set inside the import dialog on a zoomable/pannable preview with a known-length measure line (Sweet Home 3D style), then applied to the main plan. Session display toggles can hide the underlay, object names, dimensions, or annotation texts without changing the saved venue.

**Person figure**:
A simple standing-person placeholder used to mark where someone would be on the set.

**Front elevation**:
An orthogonal construction-plan view of one wall facing from a selected explicit group, showing panel heights and opening dimensions at the issued scale. Angled groups produce one labelled face per distinct facing rather than a flattened overview of a corner.
_Avoid_: Flattened elevation

**Physical finish**:
The paint, wallpaper or cladding currently on a real panel, recorded after the work has been carried out. It can differ from the intended finish of a scene wall.

**Finish assignment**:
The intended finish captured when a physical panel is assigned to a scene wall. Later scene edits do not change that record; the crew separately confirms when the work is complete.

**Technical cutout**:
A measured outlet or cable opening specific to one physical panel. It is a stock characteristic, distinct from a scenic door or window opening defined by the wall type.
