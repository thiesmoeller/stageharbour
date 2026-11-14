# Requisiten are mesh assets, not Bauteile

A Requisite is a workspace GLB (`inventory_asset` kind `model`, source `upload`) placed on a placeholder. The same asset can sit on the Spielstätte (`venue.placeholders`) and on the Bühnenbild (`layout.placeholders`). It is not a parametric Bauteil, it is not stocked, and it does not take part in joints.

Poly Haven is the free catalog for CC0 textures and models. Imports copy the file from `dl.polyhaven.org` into the workspace so a later reload does not depend on Poly Haven. The Poly Haven API terms are separate from the CC0 asset license. Other catalogs can be added behind the same search/import seam; they are not part of this decision.
