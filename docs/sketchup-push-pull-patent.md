# SketchUp Push/Pull patent notes

Question: Can this planner use a SketchUp-like push/pull interaction to set **Podest** elevation and **Überbauung** height/thickness?

## Primary source

- **US6628279B1** — *System and method for three-dimensional modeling* (@Last Software / Brad Schell et al.), filed 2000-11-22, granted 2003-09-30.
- USPTO / Google Patents legal status: **Expired — Lifetime**, adjusted expiration **2021-05-06**.
- Source: [Google Patents US6628279B1](https://patents.google.com/patent/US6628279B1/en) (status line: “Expired - Lifetime, expires 2021-05-06”).

Claims cover receiving planar closed faces and extruding / “pushing or pulling” those faces into 3D (among other SketchUp modelling behaviours).

## Practical takeaway (not legal advice)

| Topic | Status |
|---|---|
| US6628279 Push/Pull patent | Expired (May 2021) — no longer a US patent barrier for that invention |
| Other jurisdictions / follow-ons | Not exhaustively searched here; worth a quick patent counsel check before shipping a marketing claim of “SketchUp Push/Pull” |
| “SketchUp” trademark | Still owned by Trimble — do **not** brand the feature as SketchUp; describe it in German product language (e.g. **Höhe ziehen**, **Extrudieren**) |
| Fit for Podest / Überbauung | Interaction is a good UX match: select top face → drag to change elevation / bottomHeight / thickness with live millimetre feedback |

## Product mapping

- **Podest**: push/pull vertical = `platform.elevation` (and optionally outline footprint edits later).
- **Überbauung**: push/pull vertical = `bottomHeight` and/or `thickness`; plan rotate is separate (pose).

This note records research for agents; it is not a freedom-to-operate opinion.
