# Add a Bestand workspace for stock and wall types

Crews need to manage physical panels and stocked wall types (including doors and windows as types) without opening a scene, while still designing a stage freely and assigning panels later. Finishes stay on the wall inspector. Introduce a top-level **Bestand** workspace (`#/bestand`) with Platten and Wandtypen tabs; keep wall types hybrid (catalog for stocked types, scene-local one-offs allowed); editors use the existing inventory lease. Scene-first design, in-scene panel assignment, and clone-and-own copies (clear panel IDs across venues) remain; live master→instance sync is deferred. This trades a second nav destination for a clear stock office without blocking design or inventing layout push-sync before Bestand exists.

## Considered options

- **Materials under Verwaltung** — rejected: stock is crew work, not site admin.
- **Canonical inventory-only wall types (no scene one-offs)** — rejected: crews invent openings when building new.
- **Live linked master layout** — deferred: conflicts with frozen plans and current Vorlage/copy semantics.

## Consequences

- Objektbibliothek stays the place to *place* and design; Bestand is where stock and catalog types are *managed*.
- Surface finishes remain instance-level (Pascal/RAL), not a Bestand catalog in this phase.
