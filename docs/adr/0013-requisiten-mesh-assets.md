# Requisiten are mesh assets, not Bauteile

A Requisite is a workspace GLB (`inventory_asset` kind `model`, source `upload`) placed on a placeholder. The same asset can sit on the Spielstätte (`venue.placeholders`) and on the Bühnenbild (`layout.placeholders`). It is not a parametric Bauteil, it is not stocked, and it does not take part in joints.

Poly Haven is the free catalog for CC0 textures and models. Imports copy the file from `dl.polyhaven.org` into the workspace so a later reload does not depend on Poly Haven. The Poly Haven API terms are separate from the CC0 asset license. Other catalogs can be added behind the same search/import seam; they are not part of this decision.


## Extension: mesh elements in Bauteile

The same immutable uploaded model asset can also be referenced by a `mesh` body inside a Bauteil. This does not turn standalone props into Bauteile. Mesh bodies share position, rotation, physical bounding dimensions, visibility and copies with direct modelling; their embedded materials remain unchanged. Their bounding box supplies selection and dimension handles, while rendering loads the GLB. Construction weight and purchased hardware remain explicit.

Library JSON preserves asset IDs, but does not embed binary assets. Import into a workspace missing those assets reports the dependency and rejects the affected part. Workspace storage retains binaries across reloads. Asset removal checks all saved part revisions, including inline groups; archived models continue to render existing placements.
