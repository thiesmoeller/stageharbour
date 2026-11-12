# Stage canvas baseline (Pascal Viewer)

Baseline for the parametric-parts and canvas plan, slice B1. It records the Raumsicht as it ships
today, rendered by `@pascal-app/viewer` 1.0.6 on `WebGPURenderer({ forceWebGL: true })`, so slice B4
can print a before/after table from the same script.

Raw numbers: [`stage-canvas-baseline.json`](stage-canvas-baseline.json).

## Environment

These numbers are for before/after comparison on the same machine only. They say nothing about
user hardware.

| | |
|---|---|
| Machine | Cloud VM, 4 vCPU (Intel Xeon), 15.6 GiB RAM, Linux 6.12 |
| Browser | Playwright Chromium 156.0.8078.4, headless, viewport 1280 × 800 at device pixel ratio 1 |
| WebGL | Software rendering: ANGLE on SwiftShader (Vulkan 1.3, Subzero). No GPU. |
| Server | `tests/helpers/browser-server.ts` (production build from `dist/web`, PostgreSQL 17 on loopback). Assets are served uncompressed, so transfer size equals decoded size. |
| Node | v24.22.2 |
| App source | Identical to `main` at `af71a40`. The JSON records commit `80c2bc6`, which only added `scripts/measure-stage.ts`; `dirty: true` refers to the uncommitted script and the new `src/client/stage/` files, which nothing imported at the time. |

## Summary

| Metric | Baseline |
|---|---|
| JS total (minified / gzip) | 4966.7 KiB / 1436 KiB |
| CSS total (minified / gzip) | 92.3 KiB / 18.4 KiB |
| Initial load (index.html entry + preloads, gzip) | 1290.9 KiB |
| Largest JS chunk (minified / gzip) | index.js: 3199.1 KiB / 911.5 KiB |
| JS attributable to `@pascal-app/*` and Pascal-only deps | 1583.1 KiB (33.7 %), ≈ 478.8 KiB gzip |
| JS from three (all entry points) | 1376.2 KiB (29.3 %) |
| …of which three.webgpu.js + three.tsl.js | 674.4 KiB |
| JS fetched when opening the Raumsicht (median run, transfer) | 71.8 KiB |
| Raumsicht open → first WebGL draw (median of 5) | 790.7 ms |
| Raumsicht open → scene drawn (median of 5) | 1306.4 ms |
| Dense layout: open → first draw / scene drawn | 830.5 ms / 1691.9 ms |
| Dense layout orbit frame time median / p95 | 149.9 ms / 150.1 ms (44 frames in 6.17 s) |
| Dense layout draw calls per frame (median) | 2072 |
| Installed packages (`npm ls --all --parseable`, unique paths; without dev) | 380; 366 |
| Lockfile packages (all / non-dev / installed on this machine) | 541 / 481 / 380 |
| Lockfile packages only reachable through `@pascal-app/*` (all / installed) | 166 / 134 |
| Full e2e suite duration | 76 tests in 6.7 min (Playwright); 6 min 49 s wall time including `npm run build` |

### Bundle detail

| Chunk | Minified | gzip | Loaded |
|---|---|---|---|
| `index.js` | 3,275,835 B | 933,373 B | initial |
| `dist.js` (mostly `@pascal-app/core`, preloaded with the entry) | 1,247,308 B | 369,265 B | initial |
| `pdf.js` | 430,162 B | 128,129 B | on demand |
| `PascalStageCanvas.js` | 73,574 B | 23,543 B | when the Raumsicht opens |
| `basis_transcoder.js` + `.wasm` (KTX2) | 57,529 B + 527,333 B | 15,169 B + 247,619 B | on demand |

Pascal share by package (minified bytes from source maps): `@pascal-app/core` 1,143,064,
`@pascal-app/viewer` 141,935, `@pascal-app/lingo` 132,488, `@pascal-app/editor` 67,534,
`three-bvh-csg` 56,551, `three-mesh-bvh` 47,816 (Pascal's copy; drei has its own), `polygon-clipping`
27,354, and under 3 KB each for `dedent`, `zundo`, `nanoid` and `mitt`.

Most of the Pascal code sits in the initial load, not in the lazy Raumsicht chunk. Modules outside
that chunk import Pascal statically: `surfaceMaterials.ts`, `WallSurfaceEditor.tsx`,
`MaterialPicker.tsx`, `WallTypePreview.tsx` and `PascalCatalog.tsx`. `three.webgpu.js`
(663.7 KiB) is in the bundle only because of Pascal's renderer.

### Packages only there because of Pascal

The 166 lockfile entries (134 installed on Linux x64) include the Next.js runtime (`next`,
`@next/env`, `@next/swc-*`), `sharp` and `@img/*`, `esbuild-wasm`, `manifold-3d`, `web-ifc`,
`@gltf-transform/*`, Radix UI, `framer-motion`, `@dnd-kit/*`, `@iconify/react` and
`@pascal-app/geometry-script` and `@pascal-app/ifc-converter`. The full list is in
`packages.pascalOnly.names` and `packages.pascalOnly.paths` in the JSON.

The plan quoted "131 of 368 packages". These numbers differ because they are counted differently:
lockfile reachability with optional peers excluded, and installed paths deduplicated across the
`node_modules` symlink.

## Method

Run with the e2e lock held, because the script uses port 4173:

```sh
flock /tmp/stageharbour-e2e.lock node --import tsx scripts/measure-stage.ts measure --out after.json --label after
node --import tsx scripts/measure-stage.ts compare docs/measurements/stage-canvas-baseline.json after.json
```

Without `--skip-build` it runs `npm run build` first. `--only` limits the sections, for example
`--only orbit`.

- **Bundle**: every file in `dist/web/assets`, gzip at zlib's default level. "Initial" means the
  files `index.html` references (the entry, its modulepreloads and CSS).
- **Attribution**: a second `vite build --sourcemap hidden` into a temporary directory. Each
  minified character is charged to the installed package path of its original source. A package
  counts as Pascal when it is `@pascal-app/*` or appears only among the Pascal-only lockfile paths
  below. The gzip share is estimated in proportion to minified bytes.
- **Packages**: a dependency graph from `package-lock.json` (dependencies, optional dependencies,
  and peers not marked optional). Pascal-only = reachable from all roots minus reachable from the
  roots without `@pascal-app/*`. Installed counts check that the package exists in `node_modules`.
- **First frame**: an administrator creates a production through the UI. A layout with the object
  kinds `stage-view.spec.ts` uses (2 walls, 1 brace, 1 table, 1 stage-deck platform and 1 stair) is
  then saved through the layout API. Each of the 5 runs uses a fresh browser context, so the HTTP
  cache is cold. The run opens the scene, switches to Grundriss, then clicks Raumansicht. An init
  script counts WebGL draw calls per animation frame on canvases inside
  `[data-testid="stage-view"]`.
  - "First draw" is the first frame with any draw call.
  - "Scene drawn" is the first frame that reaches 90 % of the steady draw count, which is taken
    after the counts have been stable for 3 s.
- **Orbit**: a dense layout is opened the same way: 20 × 16 m, 250 chairs (the schema maximum per
  Bühnenbild), 40 stage-deck modules 2 × 1 m at 400 mm with legs, and 10 walls. The run drags in a
  circle with the middle mouse button (the editor's orbit button) for 6 s and records the time
  between frames that issued draw calls.
  - The script fails if canvas screenshots before and after the drag are identical.
  - An orbit-only rerun on the same build gave 150.0 ms median and 166.6 ms p95. The p95 varies by
    about one vsync interval between runs.

## Reading the numbers

- Frame times are quantised. SwiftShader needs about 140 ms for 2072 draw calls, and Chromium
  presents on the next 16.7 ms tick, so most frames take 9 ticks (150 ms). On a real GPU the same
  scene would be much faster. Use the numbers to compare renderers on this VM: draw calls per frame
  and the frame median are the comparable figures.
- Pascal's Viewer uses `frameloop="never"` with its own 50 fps limiter, so it draws every frame
  even when nothing changes. A demand-driven canvas only draws while something moves. The orbit
  measurement keeps the camera moving for the whole interval, so both cases are compared under load.
- Pascal theme lights are effectively switched off in the Raumsicht today: `StageLighting.tsx`
  suppresses every light outside its own rig each frame. Shadows only render while the Lichtpult
  is open with Bühnenlicht on. So the theme visibly changes only the clear colour and the exposure.
