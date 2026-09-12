# Keep an owned millimetre layout editor

The Pascal integration restriction is revised by [ADR 0004](0004-integrate-pascal-through-theatre-nodes.md); the independent millimetre layout remains authoritative.

Pascal Editor was considered as the core plan/3D UI. Stay with the application-owned top-down editor and shared layout document: scenery walls are independent inventory panels (including 28 mm thickness, free hinge angles, and openings as wall types), not a joined building envelope, and PostgreSQL remains the source of truth for schema-versioned layouts, session-only undo, and frozen construction exports. Revisit Pascal only if a later lighting or materials workstream needs a visualiser that still reads this layout model rather than replacing it.
