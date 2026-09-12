# Pascal integration feasibility

Investigated 2026-09-10 against npm tarballs, registry metadata, and upstream source. Upstream main inspected at commit `20cbb20e17bd331ce7c98ac1b82c1095de3614b3`. This records feasibility and integration boundaries; implementation progress belongs in the change description.

## Decision

Integration is feasible. Pascal is the [pascalorg/editor project](https://github.com/pascalorg/editor), a React Three Fiber architectural editor with published runtime, editor, and node packages. Its rendering stack matches this application. Adopt its scene registry, asset metadata, material/catalog facilities, and viewer through an adapter that preserves the planner's independent inventory panels, millimetre document, venue transforms, and PostgreSQL persistence. Custom theatre node definitions are a better fit than converting scenery panels to Pascal architectural walls, which carry building-envelope and junction behavior. This is an architectural recommendation based on the APIs below and [our earlier domain decision](adr/0003-keep-owned-layout-editor.md).

The user clarified that the desired scope includes reusable theatre inventory, GLB import/placement, Pascal catalogs, and Pascal's underlying logic concepts. Merely placing existing meshes inside a new canvas would address only rendering.

## Published packages and compatibility

Live `npm view` checks and downloaded package manifests gave:

| Package | Published version inspected | Relevant dependencies and fit |
| --- | --- | --- |
| `@pascal-app/core` | 0.9.2 | React 18/19, Three `^0.185`, R3F `^9`, Drei `^10`; Zod 4, Zustand 5, Zundo, idb-keyval |
| `@pascal-app/viewer` | 0.9.2 | Same rendering peers; core `^0.9.2`; Three BVH/CSG helpers |
| `@pascal-app/editor` | 0.9.2 | Core/viewer plus **Next >=15**, React DOM and a substantial Radix/motion/UI dependency set |
| `@pascal-app/nodes` | 0.1.1 | Core/viewer/editor peers, Zustand 5 and Lucide 1 |

The planner's React 19.2.8, Three 0.185.1, R3F 9.7.0, and Drei 10.7.8 meet runtime peers. Its Vite host is the main difference from Pascal's full editor shell. Sources: versioned registry metadata for [core](https://registry.npmjs.org/@pascal-app/core/0.9.2), [viewer](https://registry.npmjs.org/@pascal-app/viewer/0.9.2), [editor](https://registry.npmjs.org/@pascal-app/editor/0.9.2), and [nodes](https://registry.npmjs.org/@pascal-app/nodes/0.1.1).

Pin versions: these are pre-1.0 APIs, and the repository describes an ongoing registry migration. Upstream README examples and published artifacts are not interchangeable. In particular, the README describes persisted core state, but the inspected 0.9.2 core scene store uses memory-based Zustand/Zundo; persistence belongs to the editor's host callbacks. Sources: [published core tarball](https://registry.npmjs.org/@pascal-app/core/-/core-0.9.2.tgz), [published editor tarball](https://registry.npmjs.org/@pascal-app/editor/-/editor-0.9.2.tgz).

## Useful integration surfaces

### Rendering

`Viewer` owns the R3F canvas and accepts children, custom selection management, render shading, BVH configuration, scene-ready callbacks, and `disablePostFx`. It initializes Three's `WebGPURenderer`; the runtime accommodates a fallback backend and reports an unavailable viewer if neither WebGPU nor WebGL can initialize. SSGI/denoising/outline processing is materially heavier than the current plain canvas and must be validated on actual target browsers. Runtime options and initialization were inspected in `dist/components/viewer/index.{js,d.ts}` from the [published viewer package](https://registry.npmjs.org/@pascal-app/viewer/-/viewer-0.9.2.tgz).

Custom node renderers can participate in Pascal's registry-based `SceneRenderer`; arbitrary children also work but alone do not gain node selection, capabilities, or placement. `useViewer` exposes selection and render settings. The published core material catalog plus viewer material factories provide a reusable finish system. The [viewer quick start](https://github.com/pascalorg/editor/blob/20cbb20e17bd331ce7c98ac1b82c1095de3614b3/packages/viewer/README.md) documents the built-in plugin route and viewer controls.

The viewer contains a module-level `process.env.NEXT_PUBLIC_ASSETS_CDN_URL` expression. Vite needs an explicit definition for that expression. Its actual 0.9.2 fallback is `https://editor.pascal.app`; an older README example names a different CDN. Use explicit host asset URLs. KTX2 decoding also uses a jsDelivr Basis transcoder URL. Source: `dist/lib/asset-url.js` and `dist/lib/ktx2-loader.js` in the [published viewer tarball](https://registry.npmjs.org/@pascal-app/viewer/-/viewer-0.9.2.tgz).

### Scene logic and theatre nodes

Core publicly exports `registerNode`, `loadPlugin`, `nodeRegistry`, `useScene`, `sceneRegistry`, and `useRegistry`. A plugin declares `id`, `apiVersion: 1`, and node definitions. Each definition can supply a Zod schema/version, defaults, renderer or geometry builder, relations, capabilities, parameter controls, and selection/move/rotate/snap behavior. The scene store provides `setScene`, node creation/update operations, and history controls. This supports theatre-specific definitions without teaching the building-wall system to behave like loose inventory. Sources: `dist/registry/types.d.ts`, `dist/registry/registry.d.ts`, `dist/store/use-scene.d.ts` in the [published core package](https://registry.npmjs.org/@pascal-app/core/-/core-0.9.2.tgz).

Recommended model: a theatre asset definition contains reusable model/finish metadata; a placed instance contains its identity, asset reference, position, rotation, and dimensions. Convert millimetres to metres at the Pascal boundary. Link node metadata to planner instance IDs. Preserve the distinction between inventory availability and scenic placements. Route user edits through the planner's validated commands, or explicitly bridge Pascal mutations back to those commands; avoid two independently editable copies with competing undo histories.

### Catalog and GLB assets

The editor package has a **separate public `@pascal-app/editor/catalog` export** containing `CATALOG_ITEMS`. The inspected release includes 111 entries with identifiers, names, tags, categories, GLB/thumbnail URLs, dimensions, offsets, rotation and scale; some include attachment/surface metadata. This entry point imports only a core type, so consumers can use catalog data without importing the full editor UI barrel. Sources: [editor package manifest](https://registry.npmjs.org/@pascal-app/editor/0.9.2) and `src/components/ui/item-catalog/catalog-items.tsx` in the [published editor tarball](https://registry.npmjs.org/@pascal-app/editor/-/editor-0.9.2.tgz).

The catalog's supplied URLs point to remote hosted objects. Preserve metadata transforms when placing them; dimensions are not a substitute for origin offsets and asset orientation. Core `AssetInput` is the relevant common contract. Host-side browsing and filtering can combine these entries with theatre inventory. Pascal's internal `ItemCatalog` itself selects an asset, switches the editor into build mode and arms the corresponding placement tool; it is coupled to editor/viewer stores. Source: [upstream ItemCatalog](https://github.com/pascalorg/editor/blob/20cbb20e17bd331ce7c98ac1b82c1095de3614b3/packages/editor/src/components/ui/item-catalog/item-catalog.tsx).

Core `saveAsset(File)` returns an `asset://` URL backed by browser IndexedDB. `loadAssetUrl` resolves it to a cached object URL. This is a useful local facility, **not shared asset management**: no server persistence, authorization, inventory records, or deletion API is provided there. Production theatre uploads need host-owned storage and durable URLs. Viewer `useGLTFKTX2` supplies GLTF loading with Draco, Meshopt and KTX2 support; `useAssetUrl` resolves local assets. Sources: `dist/lib/asset-storage.js` in the [core package](https://registry.npmjs.org/@pascal-app/core/-/core-0.9.2.tgz), and `dist/hooks/use-gltf-ktx2.js` in the [viewer package](https://registry.npmjs.org/@pascal-app/viewer/-/viewer-0.9.2.tgz).

### Full editor and headless tools

The SDK exports `Editor`, `Grid`, `ToolManager`, `NodeArrowHandles`, `MoveTool`, `Inspector`, `usePlacementCoordinator`, and selection/placement hooks. Headless tools read Pascal scene/editor/viewer stores; placement expects selected building and level IDs. `Grid` emits the pointer events driving build tools. Full `Editor` accepts `onLoad`, `onSave`, dirty/save-status callbacks, project IDs and UI slots, making a host database integration possible. Source: `src/index.tsx` and `src/components/editor/index.tsx` in the [published editor package](https://registry.npmjs.org/@pascal-app/editor/-/editor-0.9.2.tgz).

However, that package ships raw TS/TSX and imports real `next/image` and `next/link` throughout its shell. The complete component also expects its utility styling. Importing its entire barrel into Vite is a larger compatibility task than using the standalone catalog plus core/viewer. Full generic architectural tools should not be enabled until theatre node capabilities, edit synchronization, undo, and persistence are designed and tested.

## Licensing and acceptance checks

Upstream software is MIT licensed, requiring its copyright and permission notice in copies/substantial portions. See the [upstream license](https://github.com/pascalorg/editor/blob/20cbb20e17bd331ce7c98ac1b82c1095de3614b3/LICENSE). The editor tarball inspected lacks its own LICENSE file and manifest license field, although it comes from this repository. Remote catalog metadata has no per-item license fields; repository code licensing alone does not establish redistribution rights for every remote model. A catalog connection is technically feasible; downloaded/rehosted third-party models need provenance rather than a blanket claim that all are MIT.

Acceptance should cover: an existing theatre plan round-trips without millimetre changes; independent panels never auto-join; GLB assets retain offsets/orientation; an uploaded asset survives another authorized browser/session; catalog failures are recoverable; selection and move commits preserve inventory references; undo has one authoritative history; existing exports retain their construction semantics; and the viewer renders on supported GPU and fallback browsers. These are implementation criteria inferred from the planner's domain and the integration surfaces above.
