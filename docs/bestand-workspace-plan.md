# Bestand workspace — implementation plan

Settled 2026-09-26 (grilling session). ADR: [0005-bestand-workspace.md](./adr/0005-bestand-workspace.md).

## Goal

Give the group a **Bestand** workspace to manage **Platten** (physical panels) and **Wandtypen** (stocked types, including Tür/Fenster) without opening a scene. Stage design stays scene-first; panel assignment stays in the scene; finishes stay on the wall inspector. Master→venue live sync is out of scope.

## First slice (v1)

1. **Nav + shell** — `#/bestand` with tabs Platten | Wandtypen; editor role + inventory lease.
2. **Platten tab** — list / create / edit / availability for workspace panels (reuse inventory API).
3. **Wandtypen tab** — list / create / edit stocked types in inventory wall types (hybrid: scene one-offs remain).
4. **Help** — document scene-first design, later assignment, clone-and-own (no live master sync).

## Explicit non-goals (this phase)

- Group-owned surface-finish library
- Requiring a Bestand panel before placing walls
- Moving panel assignment into Bestand
- Pushing master layout changes into venue scene instances
- Removing Objektbibliothek placement flows

## Later (not scheduled)

- Deep-link / slim Objektbibliothek inventory tabs toward Bestand
- Optional “Änderungen übernehmen” from a master arrangement (geometry/types only)
