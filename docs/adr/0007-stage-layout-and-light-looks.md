# Straighten stage language; add hang plan and light looks (not a console)

The product used **scene** for the editable set document, which collides with a **play scene** (script) and with casual “light scene” talk. Lighting on Traversen needs room for several looks on one set, including mid–play-scene changes. Rename existing concepts now so hang planning stays future-proof, and add a **hang-and-look planner** aligned with entertainment lighting vocabulary — without becoming a lighting console.

## Terminology (product language)

| Concept | Adopt (EN / DE UI) | Retire / avoid | Notes |
|---|---|---|---|
| Editable set document | **Stage layout** / **Bühnenbild** | bare “scene” / “Szene” as the only name | Today’s `Scene` / scene layout; walls, props, braces |
| Read-only set snapshot | **Stage layout template** / **Bühnenbildvorlage** | Scene template / Szenenvorlage | Same role as today’s template |
| Script unit | **Play scene** / **Stückszene** | using “Szene” for the set doc | Dramatic unit (e.g. II/3); optional first-class later |
| Hang bar | **Truss** / **Traverse** | — | Unchanged venue geometry |
| Reserved point on a truss | **Hang point** / **Aufhängepunkt** | — | Attachment seam for fixtures |
| Controllable light on the hang | **Lighting fixture** / **Scheinwerfer** | “fixture” alone (collides with curtain/door venue fixtures) | Industry term (grandMA, Vectorworks, Capture) |
| Library definition of a light | **Fixture type** / **Gerätetyp** | — | Attributes, beam, physical size; GDTF later optional |
| What is hung where in the venue | **Hang plan** / **Hängeplan** | — | Fixture instances on hang points; venue-owned |
| Named lighting snapshot | **Light look** / **Lichtlook** | light scene, cue, sequence | Many per stage layout; not playback |
| Coarse house/rehearsal fill | **Mood lighting** / **Grundlicht** (or keep panel label *Lichtstimmung*) | treating mood fills as the hang plan | Existing front/back/ambient; not fixture-based |

**Explicitly out of product language (console / show control):** cue, sequence, executor, programmer, playback, DMX patch as a live control surface, Art-Net/sACN show drive. Those belong to desks (e.g. grandMA). Optional later: export-only interchange (patch list, MVR) under a separate ADR.

**Play scene** may start as vocabulary and naming hygiene only. Promoting it to a first-class entity (layout + ordered light looks for rehearsal notes) is allowed later without renaming the set document again.

## Feature decision

- **Venue** owns Traversen, hang points, and the **hang plan** (fixture instances).
- **Stage layout** owns set geometry and a list of **light looks** (0..n): intensity, colour, aim/focus, beam (and later attributes as needed). Looks can change while the set stays fixed.
- **Raumsicht** previews the active look from fixture positions (not only mood fills). Mood lighting remains a coarse fill beside the hang plan.
- **No** cue lists, fades-as-show-control, timelines, or live desk integration in this decision.
- The millimetre layout stays authoritative ([ADR 0003](0003-keep-owned-layout-editor.md)); visualisation reads hang + look from that model.

This narrows “phase two lighting” in [planner decisions](../planner-decisions.md): hang + looks yes; console no.

## Renames (accepted)

UI, help, and CONTEXT.md adopt the table above. Code and API may migrate gradually (`scenes` → `stage-layouts` or keep internal `scene` with UI “Bühnenbild”), but **user-visible** strings and domain docs must stop calling the set document only “Szene” without qualifier. Curtain/door selection stays **venue soft-goods / door fixtures** in code comments if needed; never call Scheinwerfer merely “fixture” in UI.

## Considered options

- **Keep “Szene” for the set doc; add “light scene”** — rejected: triple collision (script, set, light).
- **1:1 lighting blob per stage layout** — rejected: cannot express several looks inside one play scene / one set.
- **Full Capture/Vectorworks + grandMA-class control** — rejected: out of scope for a community-theatre set planner.
- **Rename now + hang-and-look planner** — accepted: SOTA-aligned words (fixture, hang, look) without console semantics.

## Consequences

- Update CONTEXT.md language entries; adjust Help (`Szene (Bühnenbild)` → **Bühnenbild** as primary).
- Nav and copy (“Produktionen & Szenen”) become productions & stage layouts (German: Produktionen & Bühnenbilder), with **Stückszene** introduced when/if play scenes are first-class.
- Existing scene mood `lighting` on layout/venue stays as **Grundlicht** until fixture looks replace or sit beside it.
- Paperwork (instrument-style hang lists) may follow later; not required to accept this ADR.
