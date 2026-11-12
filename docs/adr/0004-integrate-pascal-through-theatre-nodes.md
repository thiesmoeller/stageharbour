# Integrate Pascal through theatre nodes

Status: superseded by [ADR 0010](0010-owned-stage-canvas.md).

The requested inventory, model import, material catalogue and richer rendering justify revisiting [ADR 0003](0003-keep-owned-layout-editor.md). Use pinned Pascal core/viewer packages and the editor's standalone catalogue, with custom registered theatre nodes projected from the millimetre layout; retain the planner's validated commands, single undo history, leases and PostgreSQL saves because physical panels must not acquire architectural wall joining behaviour. Workspace asset definitions and uploaded GLB files belong to the application, while catalogue models remain linked to their providers; scene instances retain their dimensions and archived assets stay resolvable.

Pascal supplies scene dispatch, object registration, selection state, model loading, material presets and rendering. The full Next.js editor shell and its building/level-dependent placement tools are not mounted: adopting those requires a separate edit adapter and theatre capabilities, and must not introduce a second independently editable history. See [the feasibility research](../pascal-integration-research.md) for package/API evidence and this distinction.
