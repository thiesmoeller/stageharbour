# Replace Pascal with an owned three.js stage canvas

This supersedes [ADR 0004](0004-integrate-pascal-through-theatre-nodes.md). The `@pascal-app` packages are removed and replaced by an owned three.js stage canvas (`src/client/stage/StageCanvas.tsx`) on the standard WebGL renderer. Renderer and material code sit behind one seam so a later renderer switch touches two files.

## Finding

What Pascal still does for the app: it creates the canvas and renderer, supplies three light themes, material factories with a library of about 130 materials, a 14-line GLB loader hook and a list of 111 catalog models. Its scene store is fed as a read-only mirror with history paused, and its one registered node type renders the app's own meshes.

What it costs:

- 134 of the 380 installed packages (166 of 541 lockfile entries) exist only for Pascal, including Next.js, sharp, manifold-3d, web-ifc and esbuild-wasm.
- About a third of the shipped JavaScript (1583 KiB of 4967 KiB minified) is Pascal and its Pascal-only dependencies, most of it in the initial bundle.
- A postinstall script patches Pascal's dist to force WebGL.
- three.js is pinned at 0.186 while Pascal 1.1.1 needs 0.187.
- Workarounds for its WebGPU renderer sit in six components.
- Its global stores allow only one canvas.
- Textures and models load from Pascal's servers at runtime.

The baseline on the Pascal build is recorded in [docs/measurements/stage-canvas-baseline.md](../measurements/stage-canvas-baseline.md); the same script is re-run after the removal.

## Renderer choice

three.js documents its WebGPU renderer as experimental at r187 and recommends the WebGL renderer for WebGL 2 applications, so the owned canvas uses the WebGL renderer.

## Kept and not kept

- Saved `library:` finishes and catalog models keep resolving through vendored metadata (material library and model catalog become app-owned data). The MIT notice is kept.
- The "Hohe Renderqualität" post-processing is not ported in the first pass.
- Standard materials will not match Pascal's node materials pixel for pixel. A screenshot comparison against the current build decides whether tuning is needed before switching.

## Open risk

The licence of each Pascal-hosted texture and model is unknown. Assets keep loading from the same servers until a licence check; mirroring them needs that check first.
