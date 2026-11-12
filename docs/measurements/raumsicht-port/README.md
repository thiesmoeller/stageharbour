# Raumsicht port: visual and performance comparison

This records the B2+B3 switch from Pascal's viewer to StageHarbour's owned `StageCanvas`.
Both screenshot sets were captured at 1280 × 800 in Playwright Chromium 156 with the same
`scripts/capture-raumsicht.ts` scenarios. Raw performance data is in
[`../stage-canvas-baseline.json`](../stage-canvas-baseline.json) and
[`../stage-canvas-after-port.json`](../stage-canvas-after-port.json).

## Result

The owned renderer retains the scene geometry, camera presets, object orientation, texture
direction and catalogue-model transforms. The comparison found no missing objects, black
materials, reversed models, wrongly rotated textures or missing theatre-light pools. The dense
scene now batches equal chairs, deck modules and legs: draw calls fell from 2,072 to 58 and the
software-rendered orbit median fell from 149.9 ms to 66.6 ms.

The measurements were taken on the same Cloud VM and are comparative, not hardware benchmarks.
The after JSON records `1fa5ec3` with `dirty: true` because the port was measured before its
logical commits; the measured working tree is the tree documented here.

| Metric | Pascal baseline | Owned canvas |
|---|---:|---:|
| JS total, minified / gzip | 4,966.7 / 1,436.0 KiB | 3,478.0 / 916.8 KiB |
| Initial JS/CSS load, gzip | 1,290.9 KiB | 410.7 KiB |
| Largest JS chunk, minified / gzip | 3,199.1 / 911.5 KiB | 1,221.2 / 339.7 KiB |
| Pascal and Pascal-only JS | 1,583.1 KiB | 0 KiB |
| `three.webgpu` + `three.tsl` JS | 674.4 KiB | 0 KiB |
| JS fetched when opening Raumsicht | 71.8 KiB | 749.1 KiB |
| Open → first WebGL draw, median of 5 | 790.7 ms | 430.8 ms |
| Open → scene drawn, median of 5 | 1,306.4 ms | 621.8 ms |
| Dense open → first draw / scene drawn | 830.5 / 1,691.9 ms | 487.9 / 706.2 ms |
| Dense orbit frame time, median / p95 | 149.9 / 150.1 ms | 66.6 / 83.3 ms |
| Dense draw calls per frame, median | 2,072 | 58 |

The larger lazy Raumsicht transfer is the owned `StageCanvas`, three.js, loaders and the vendored
material data moving out of the initial bundle. Total and initial bundle sizes still fall sharply.
Package counts do not fall in B2+B3 because the Pascal dependencies remain installed until B4,
although no application source imports them.

## Visible differences

- The owned canvas uses each theme's flat clear colour directly: Studio is white, Warm is ivory
  and Abend is peach. Pascal's captures made all three backgrounds look more similarly grey.
- Standard three.js materials under ACES tone mapping are not pixel-identical to Pascal's node
  materials. Colours and highlights differ slightly, while the saved RAL and library finishes
  remain recognisable.
- The theatre floor's configured wood finish now appears in orbit, audience, top and split views.
  It was nearly flat/blank in the Pascal captures. The wall-type preview likewise shows the
  intended brown Finewood strip instead of the previous green-white image.
- The selected-wall outline is a little thinner. Camera framing, openings, stairs, deck legs,
  placeholder silhouettes, curtains, trusses and catalogue/uploaded models retain their position
  and orientation.
- Pascal's high-quality post-processing edge/ambient treatment was deliberately not reproduced.
  **Hohe Renderqualität** now selects the owned `high` quality: soft key-light shadows and a higher
  device-pixel-ratio cap. At the capture device pixel ratio of 1 its extra sharpness is not visible,
  and the wall-only scene makes the shadow change subtle.
- The stage-light views retain warm/cold pools and shadows. Their falloff and the ambient brightness
  differ slightly because they now run through the owned WebGL renderer and standard materials.

Tuning covered colour space, ACES exposure, material fallback colours, physical texture tiling and
quarter-turn grain, model transforms, floor materials, light-pool direction and shadow bounds. It
did not attempt pixel matching of Pascal's node shaders or post-processing. It also did not mirror
or re-license remote assets.

Material textures and previews still load at runtime from `https://editor.pascal.app`. Catalogue
models and previews still load from
`https://byrpxoiotywskoojsrzd.supabase.co/storage/v1/object/public/items`. Their licence review and
any self-hosting are deferred; the hosts are centralized in `src/shared/assetHosts.ts`.

## Screenshot pairs

| Scenario | Before (Pascal) | After (owned canvas) |
|---|---|---|
| Walls · orbit · Studio | ![Before: walls in Studio](before/01-walls-orbit-studio.png) | ![After: walls in Studio](after/01-walls-orbit-studio.png) |
| Walls · front | ![Before: walls from front](before/02-walls-front.png) | ![After: walls from front](after/02-walls-front.png) |
| Walls · top | ![Before: walls from top](before/03-walls-top.png) | ![After: walls from top](after/03-walls-top.png) |
| Walls · Warm | ![Before: walls in Warm](before/04-walls-orbit-paper.png) | ![After: walls in Warm](after/04-walls-orbit-paper.png) |
| Walls · Abend | ![Before: walls in Abend](before/05-walls-orbit-sunset.png) | ![After: walls in Abend](after/05-walls-orbit-sunset.png) |
| Walls · high quality | ![Before: walls at high quality](before/06-walls-orbit-high-quality.png) | ![After: walls at high quality](after/06-walls-orbit-high-quality.png) |
| Walls · simple display | ![Before: walls in simple display](before/07-walls-orbit-simple.png) | ![After: walls in simple display](after/07-walls-orbit-simple.png) |
| Walls · selected | ![Before: selected wall](before/08-walls-orbit-selected.png) | ![After: selected wall](after/08-walls-orbit-selected.png) |
| Selected wall · close | ![Before: selected wall close](before/08b-wall-selected-close.png) | ![After: selected wall close](after/08b-wall-selected-close.png) |
| Platforms · orbit | ![Before: platforms in orbit](before/09-platforms-orbit.png) | ![After: platforms in orbit](after/09-platforms-orbit.png) |
| Platforms · top | ![Before: platforms from top](before/10-platforms-top.png) | ![After: platforms from top](after/10-platforms-top.png) |
| Platforms · side | ![Before: platforms from side](before/11-platforms-side.png) | ![After: platforms from side](after/11-platforms-side.png) |
| Theatre · orbit | ![Before: theatre in orbit](before/12-theatre-orbit.png) | ![After: theatre in orbit](after/12-theatre-orbit.png) |
| Theatre · audience | ![Before: theatre from audience](before/13-theatre-audience.png) | ![After: theatre from audience](after/13-theatre-audience.png) |
| Theatre · orbit · stage lights | ![Before: lit theatre in orbit](before/14-theatre-orbit-lit.png) | ![After: lit theatre in orbit](after/14-theatre-orbit-lit.png) |
| Theatre · audience · stage lights | ![Before: lit theatre from audience](before/15-theatre-audience-lit.png) | ![After: lit theatre from audience](after/15-theatre-audience-lit.png) |
| Theatre · top · stage lights | ![Before: lit theatre from top](before/16-theatre-top-lit.png) | ![After: lit theatre from top](after/16-theatre-top-lit.png) |
| Venue editor · orbit | ![Before: venue editor orbit](before/17-venue-editor-orbit.png) | ![After: venue editor orbit](after/17-venue-editor-orbit.png) |
| Venue editor · split | ![Before: venue editor split](before/18-venue-editor-split.png) | ![After: venue editor split](after/18-venue-editor-split.png) |
| Model catalogue | ![Before: model catalogue](before/19-model-catalogue.png) | ![After: model catalogue](after/19-model-catalogue.png) |
| Wall-type preview | ![Before: wall-type preview](before/20-wall-type-preview.png) | ![After: wall-type preview](after/20-wall-type-preview.png) |
| Surface editor | ![Before: surface editor](before/21-surface-editor.png) | ![After: surface editor](after/21-surface-editor.png) |
