# Designer integration brief (from explore)

Companion to [openings-face-sketcher.md](./openings-face-sketcher.md). For P1+P2 implementers.

## Selection

- `DesignerSelection` in `src/client/designer/draft.ts`: body | child | connector | hardware. **No hole-level** global selection — keep selected hole inside the sketcher.
- `Designer.tsx` owns `selection` / `setSelection` and `change(next, select?)`.
- Show sketcher when:

```ts
const body = selection?.kind === 'body'
  ? definition.bodies.find(b => b.key === selection.key)
  : undefined;
const showSketcher = body?.kind === 'sheet';
```

## 2D views today

- `PartViewsSvg` + `views.ts` `solidLoops`: facing sheets draw outline + hole loops with `fillRule="evenodd"`. No per-hole hit targets.
- Face sketcher is **sheet-local u/v**, not a rewrite of `PartViewsSvg`. Prefer resolved sheet solid: `resolved.solids.find(s => s.body === bodyKey && s.kind === 'sheet')`.

## Mount

- Centre column in `Designer.tsx` after `PartPreview3D` (beside/instead of one SVG slot when sheet selected).
- New files: `FaceOpeningsSketcher.tsx`, optional `faceSketchView.ts`, CSS under `.designer-face-sketcher`.
- Props: `definition`, `bodyKey`, `resolved`, `materials`, `disabled`, `onChange` (same as BodyList/PartEditor).
- Keep `HoleEditor` in `ElementEditor` as formula inspector; sketcher writes holes + P0 params.

## Dirty / save

- Only write via Designer `change` → updates `draft` → dirty via `canonicalJson` compare.
- Persist param defaults + hole formulas; preview column only for transient drag if needed.
- `disabled={readOnly}` when `!can(..., 'parts')`.

## E2E

- Extend `tests/browser/designer.spec.ts`: `copyStarter(page, 'Wandelement')` → select sheet → draw → save → reload.
- Add `data-testid`s: `designer-face-sketcher`, toolbar, etc. early.
