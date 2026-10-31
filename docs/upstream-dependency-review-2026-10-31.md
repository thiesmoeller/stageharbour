# Upstream dependency review — 2026-10-31

Reviewed working tree based on commit `286a288`. Scope: all direct npm dependencies, lockfile security advisories including transitives, Node/PostgreSQL images, CI actions, and functionality opportunities. The assessment baseline is retained below; follow-up dependency changes are recorded in the implementation section. No deployment was triggered. Trek findings are in [the companion review](trek-export-designer-review.md).

## Implemented updates after review

The dependency updates were authorized and applied after the assessment below. **PostgreSQL stays at 17.6**, including Compose and every CI mirror reference, as requested. The original findings and inventory below describe the pre-update state.

- Updated all outdated direct npm dependencies to their reviewed latest versions, except compatibility constraints: Three.js **0.186.1** matches Pascal **1.0.6**, and Node types **24.19.2** match Node major 24. React/DOM and their types were updated together. TypeScript is now **7.0.2**.
- Refreshed transitive dependencies and regenerated the lockfile. Full and production-only `npm audit` both report **zero vulnerabilities**. `npm outdated` lists only the deliberate Three.js and Node-type constraints.
- Added narrowly scoped overrides: `@fastify/static` → `glob` **14.0.3** and `@esbuild-kit/core-utils` → `esbuild` **0.25.12**. The first removes the vulnerable glob/minimatch branch; the second uses the patched esbuild line already required by current Drizzle Kit. Revisit/remove these overrides when the parent packages adopt patched versions themselves.
- Adapted the existing WebGL fallback to Pascal's `initializeGpuRenderer` path. Postinstall now fails when the expected initialization changes, rather than silently losing the fallback. A clean install applies the patch successfully and rerunning it is harmless.
- Updated CI actions to the versions in the original release table. Verified that the configured CapRover v2 and artifact/build inputs still exist in their published action definitions. No deployment was triggered.
- Updated both Docker stages and CI Node to **24.22.2**. Container builds now pull referenced base images. PostgreSQL configuration was not changed.

Validation completed against the final clean install:

- `npm ci`, production build/typechecking, and `npm ls --depth=0`: pass.
- Unit suite: **51 passed**. Integration suite against isolated PostgreSQL **17.6**: **115 passed**. Full Playwright suite: **74 passed**, including Pascal 3D gestures, capture, surfaces, lighting and PDF preview/issuance (7.3 minutes).
- Full and production-only npm audits: **zero vulnerabilities**.
- Scoped-override probes: static serving with `wildcard` on/off, missing-file behavior, legacy synchronous/asynchronous TypeScript transforms, and Drizzle schema generation all pass. Temporary migration generation and static-serving probes write only under `/tmp`; no project migrations or user data were changed.
- Local x64 production Docker image builds with Node **24.22.2**. Runtime smoke verifies non-root execution, embedded PDF fonts and generated PDF parsing, WebGL patch application, and built static-file serving.
- Workflow YAML parses; updated action inputs were checked against upstream definitions. Compose matches its pre-update content byte-for-byte, and all CI PostgreSQL 17.6 mirror references are unchanged.

The local host still uses Node 24.22.1; the updated image was explicitly tested on 24.22.2. Hosted GitHub Actions, arm64 checks and deployment were not executed locally. The existing large-bundle build warning remains. Existing unrelated domain-document changes were preserved.

## Findings and priority

1. **Update security-sensitive direct dependencies first:** Better Auth 1.7.3 → 1.7.14, Zod 4.5.4 → 4.6.7, Fastify 5.12.3 → 5.12.7, Nodemailer 10.0.10 → 10.3.1, Vite 8.2.2 → 8.3.5. These are same-major releases; test behavior rather than assume compatibility. The live npm audit flags all five (details below).
2. **Update PostgreSQL 17.6 → 17.11** in both [Compose](../compose.yaml:26) and the [CI mirror](../.github/workflows/test.yml:24), including its tag and both source registries. 17.11 includes security and correctness fixes. This stays within major 17; read intervening minor-release notes, back up, and check extension/configuration follow-up requirements. The running production DB version was not inspected. Sources: [upstream policy](https://www.postgresql.org/support/versioning/), [17.11 release notes](https://www.postgresql.org/docs/release/17.11/).
3. **Refresh transitive dependencies as well as direct versions.** Lockfile has vulnerable DOMPurify, Next.js, Sharp, brace-expansion, fast-uri and source-map-js. Updating package.json alone will not necessarily update these. Fastify Static and Drizzle Kit retain vulnerable branches even at their current latest releases; do not blindly accept audit's downgrade proposals.
4. **Plan Pascal 1.0.6 as a separate feature migration.** It brings relevant viewer/export improvements, but its Three.js peer range makes a blanket latest-version update invalid. Preserve the current WebGL fallback until tested.
5. **Refresh runtime images and CI actions.** Local Node is 24.22.1; upstream 24.22.2 is available. Docker uses mutable `node:24-bookworm-slim` in both stages; rebuild with a freshly pulled base, then inspect actual deployed Node/OS versions. Merely rerunning a cached build does not prove the deployed base has changed. Sources: [Node 24.22.2](https://nodejs.org/en/blog/release/v24.22.2), [October security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases).

## Security: audit result versus reachable behavior

Live registry checks: `npm audit --json`, `npm audit --omit=dev --json`, `npm outdated --json`; npm public metadata and official release/security sources. The audit used the checked-in lockfile. Full result: **19 affected packages: 3 critical, 5 high, 10 moderate, 1 low**. Production-only result: **18: 3 critical, 4 high, 10 moderate, 1 low**. These are affected package counts, not independent vulnerabilities or confirmed exploit paths. Optional/peer dependencies contribute to the count. No exploit reproduction or container OS scan was performed.

| Finding | Project-specific exposure and action |
| --- | --- |
| Better Auth: critical OAuth-state/Magic Link issue; high OAuth Proxy issue; low PostgreSQL rate-limit race | [Auth setup](../src/server/identity/auth.ts:10) enables password and optional Generic OAuth, **no Magic Link or OAuth Proxy plugin**. Therefore the two takeover paths' documented plugin preconditions are absent in inspected code. Rate limiting does not explicitly select database storage, so a PostgreSQL adapter alone does not prove the rate-limit race is reachable. Upgrade auth and its resolved adapters together; restart pending OAuth flows. [Maintainer critical advisory](https://github.com/better-auth/better-auth/security/advisories/GHSA-965c-763c-88jm), [proxy advisory](https://github.com/advisories/GHSA-r4xp-prcw-77qf), [rate-limit advisory](https://github.com/advisories/GHSA-44jh-23m7-hpcf). |
| Zod: high collection-validation resource exhaustion | Used for shared API schemas, including bounded frame/page arrays in [exportDocument](../src/shared/exportDocument.ts:139). Export POST routes allow 24 MiB, versus the general 16 KiB body limit; schema maxima are not sufficient evidence that old validation avoids per-element work. Upgrade to 4.6.7. [Upstream fix checks collection bounds before parsing elements](https://github.com/colinhacks/zod/commit/a0ebf970f2d752e5f58527cd2942ff48be4f46bd). |
| Fastify: moderate HTTP/2 trailer crash and low header-name validation bypass | [Server](../src/server/app.ts:42) does not enable HTTP/2. No header `propertyNames` constraint was found in the inspected setup. These particular exploit paths are not demonstrated, but update to 5.12.7. [Maintainer header advisory](https://github.com/fastify/fastify/security/advisories/GHSA-389g-gv7q-r4x8). |
| Nodemailer: moderate recipient parsing and SMTP AUTH regex issues | [Feedback mail](../src/server/feedback/routes.ts:59) uses a configured recipient and user email as reply-to. Arbitrary recipient input was not established; SMTP response parsing still belongs to the outbound transport. Upgrade the locked 10.0.10 to 10.3.1; current caret permits it. [Address parser advisory](https://github.com/advisories/GHSA-8c8m-p3m8-cjg8), [AUTH advisory](https://github.com/advisories/GHSA-4ffr-jq9g-5ffx). |
| Vite: high/moderate dev-server editor invocation and file disclosure advisories | Development tooling: production serves built files through Fastify. Some issues are Windows-only, others affect non-Windows hosts. Binding to loopback does not establish immunity to browser-origin attacks. Update to 8.3.5. [Non-Windows file disclosure advisory](https://github.com/advisories/GHSA-rq7h-c2jc-7f22). |
| DOMPurify 3.4.15: critical/high sanitization bypasses | Arrives through Pascal editor → jsPDF optional dependency. No direct DOMPurify or jsPDF import found in application source; actual vulnerable DOM modes/hooks were not demonstrated. Refresh to 3.4.17, or verify its removal after Pascal 1.0 migration (latest editor no longer lists jsPDF). [Critical advisory](https://github.com/advisories/GHSA-cg2g-xh64-v4q7). |
| Next.js 16.3.5 critical; Sharp 0.35.4 high | Pascal editor requires a Next peer, resolved into this Vite app; Next optionally brings Sharp. No Next server, image optimizer or Server Actions runtime is configured here. Treat as installed vulnerable dependencies, not evidence this Fastify server has Next RCE. Refresh to patched releases or reduce the dependency footprint after investigating catalog-only import options. [Next advisory](https://github.com/advisories/GHSA-2464-fhr4-w9xw), [Sharp advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w). |
| fast-uri 3.1.7 / 4.1.4, brace-expansion 5.0.9, source-map-js 1.2.1 | Refresh all nested copies: fast-uri ≥3.1.9 on v3 and ≥4.2.3 on v4, brace-expansion ≥5.0.12, source-map-js ≥1.2.2. Used through Fastify schema tooling, static globbing, PostCSS/Next. Version presence alone does not demonstrate attacker control of URI/glob/source-map inputs. See complete inventory below for advisories. |
| glob 13.0.6 + minimatch 10.2.6, via Fastify Static | Current latest Static 10.1.8 still declares glob ^13.0.0; latest glob 14.0.3 / minimatch 11.0.3 cross major boundaries. Prefer upstream-compatible remediation or a separately tested scoped override; upgrade Static for its other fixes, but do not claim this alone clears these advisories. [glob advisory](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), [minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249). |
| Drizzle Kit → esm-loader → core-utils → esbuild 0.18.20 | Dev-only legacy branch; latest Kit 0.31.11 still declares esm-loader ^2.5.5. The advisory concerns esbuild's development server, not every invocation of esbuild's transform/build APIs. Do not downgrade to audit's suggested Kit 0.18.1; investigate removing the legacy branch upstream or accept a documented dev-only residual pending a safe fix. [esbuild advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99). |

`npm audit fix --force` suggests Static 6.12.0 and Kit 0.18.1: these are backwards major changes, not an appropriate upgrade plan for this project.

## Functionality and compatibility

**Pascal is the strongest feature candidate.** The 1.0 release adds capture entrypoints, authored camera poses and public floorplan PDF exports; 1.0.3 fixes export timeouts, hidden-site export behavior and container visibility. Our app has custom stage nodes, materials, cameras and capture; evaluate which upstream APIs actually handle those before replacing any local code. The capture protocol concerns capture/scan integration too, so it is not automatically a replacement for [StageCapture](../src/client/editor/StageCapture.ts:188). [Official releases](https://github.com/pascalorg/editor/releases).

All three Pascal packages must move together to **1.0.6**, with **Three.js 0.186.x**, because published peers are `^0.186`. The old 0.9.2 packages require `^0.185`. **Do not update Three independently to latest 0.187.0.** Latest core/editor also constrain Zod to `>=4.6.7 <4.7`. Audit [the postinstall patch](../scripts/patch-pascal-webgl.mjs:12) and [Vite fallback](../vite.config.ts:10): both depend on an exact upstream constructor string and silently skip when it changes. Verify 3D rendering, materials, lights, model loading, selection and capture on actual supported GPUs after migration. Published [core](https://registry.npmjs.org/@pascal-app%2fcore/1.0.6), [editor](https://registry.npmjs.org/@pascal-app%2feditor/1.0.6), [viewer](https://registry.npmjs.org/@pascal-app%2fviewer/1.0.6) metadata establishes these constraints.

React/DOM 19.3.1 and matching types are a separate coordinated update; their new functionality is not needed to make the current export designer reusable. PDF.js 6.4.299 is worth testing for imported venue PDFs and export preview compatibility, including its worker bundle; no advisory was returned for current 6.3.289. PDFKit 0.20.2 and pdf-lib 1.17.1 are already npm latest, so changing PDF generation libraries is not necessary for this review.

TypeScript 5.9.3 → 7.0.2 is a dedicated compiler migration, not routine patch maintenance. Validate both Bundler/noEmit and NodeNext/server emission configurations, error differences, and native compiler availability in Linux x64/arm64 CI. Keep Node runtime at supported major 24; use @types/node 24.19.2 rather than npm latest 26.6.6. Version/repository facts below come directly from npm registry metadata; compatibility of these upgrades has not been tested.

## Complete direct npm inventory

“Latest” is the public npm latest tag at review time, not an automatic recommendation. Current comes from package-lock.json, not package.json ranges. Most dependencies are exact-pinned: npm update will not advance them. Types/React/Pascal/Three versions need the coordination described above.

| Package | Scope | Locked | npm latest | Recommendation |
| --- | --- | --- | --- | --- |
| [@fastify/static](https://registry.npmjs.org/%40fastify%2Fstatic) | runtime | 10.1.3 | 10.1.8 | Update and verify |
| [@fastify/swagger](https://registry.npmjs.org/%40fastify%2Fswagger) | runtime | 9.8.1 | 9.9.2 | Update and verify |
| [@pascal-app/core](https://registry.npmjs.org/%40pascal-app%2Fcore) | runtime | 0.9.2 | 1.0.6 | Together with editor/viewer + Three |
| [@pascal-app/editor](https://registry.npmjs.org/%40pascal-app%2Feditor) | runtime | 0.9.2 | 1.0.6 | Together with core/viewer + Three |
| [@pascal-app/viewer](https://registry.npmjs.org/%40pascal-app%2Fviewer) | runtime | 0.9.2 | 1.0.6 | Together with core/editor + Three |
| [@react-three/drei](https://registry.npmjs.org/%40react-three%2Fdrei) | runtime | 10.7.8 | 10.7.9 | Update and verify |
| [@react-three/fiber](https://registry.npmjs.org/%40react-three%2Ffiber) | runtime | 9.7.0 | 9.8.2 | Update and verify |
| [better-auth](https://registry.npmjs.org/better-auth) | runtime | 1.7.3 | 1.7.14 | Update and verify |
| [drizzle-orm](https://registry.npmjs.org/drizzle-orm) | runtime | 0.45.2 | 0.45.4 | Update and verify |
| [fastify](https://registry.npmjs.org/fastify) | runtime | 5.12.3 | 5.12.7 | Update and verify |
| [fastify-type-provider-zod](https://registry.npmjs.org/fastify-type-provider-zod) | runtime | 7.0.0 | 7.0.0 | Current latest |
| [nodemailer](https://registry.npmjs.org/nodemailer) | runtime | 10.0.10 | 10.3.1 | Update and verify |
| [pdf-lib](https://registry.npmjs.org/pdf-lib) | runtime | 1.17.1 | 1.17.1 | Current latest |
| [pdfjs-dist](https://registry.npmjs.org/pdfjs-dist) | runtime | 6.3.289 | 6.4.299 | Update and verify |
| [pdfkit](https://registry.npmjs.org/pdfkit) | runtime | 0.20.2 | 0.20.2 | Current latest |
| [pg](https://registry.npmjs.org/pg) | runtime | 8.23.0 | 8.23.1 | Update and verify |
| [react](https://registry.npmjs.org/react) | runtime | 19.2.8 | 19.3.1 | Together with react-dom and types |
| [react-dom](https://registry.npmjs.org/react-dom) | runtime | 19.2.8 | 19.3.1 | Together with react and types |
| [three](https://registry.npmjs.org/three) | runtime | 0.185.1 | 0.187.0 | 0.186.x only with Pascal 1.0.6 |
| [zod](https://registry.npmjs.org/zod) | runtime | 4.5.4 | 4.6.7 | Update and verify |
| [@playwright/test](https://registry.npmjs.org/%40playwright%2Ftest) | dev | 1.63.0 | 1.64.1 | Update and verify |
| [@types/node](https://registry.npmjs.org/%40types%2Fnode) | dev | 24.13.3 | 26.6.6 | 24.19.2 within Node 24 |
| [@types/nodemailer](https://registry.npmjs.org/%40types%2Fnodemailer) | dev | 8.0.2 | 8.0.2 | Current latest |
| [@types/pdfkit](https://registry.npmjs.org/%40types%2Fpdfkit) | dev | 0.17.6 | 0.17.7 | Update and verify |
| [@types/pg](https://registry.npmjs.org/%40types%2Fpg) | dev | 8.23.1 | 8.23.1 | Current latest |
| [@types/react](https://registry.npmjs.org/%40types%2Freact) | dev | 19.2.18 | 19.3.0 | Together with React/DOM |
| [@types/react-dom](https://registry.npmjs.org/%40types%2Freact-dom) | dev | 19.2.7 | 19.3.0 | Together with React/DOM |
| [@vitejs/plugin-react](https://registry.npmjs.org/%40vitejs%2Fplugin-react) | dev | 6.1.1 | 6.1.2 | Update and verify |
| [drizzle-kit](https://registry.npmjs.org/drizzle-kit) | dev | 0.31.10 | 0.31.11 | Update and verify |
| [tsx](https://registry.npmjs.org/tsx) | dev | 4.23.13 | 4.23.15 | Update and verify |
| [typescript](https://registry.npmjs.org/typescript) | dev | 5.9.3 | 7.0.2 | Separate compiler migration |
| [vite](https://registry.npmjs.org/vite) | dev | 8.2.2 | 8.3.5 | Update and verify |

## CI action releases

Source: official repositories' GitHub Releases API, checked 2026-10-31. These are update candidates; a newer release alone is not evidence of a security issue. Review major-version behavior and runner requirements before changing deployment automation.

| Action | Configured | Latest |
| --- | --- | --- |
| actions/checkout | v4 | [v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1) |
| actions/setup-node | v4 | [v7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0) |
| actions/upload-artifact | v4 | [v7.0.2](https://github.com/actions/upload-artifact/releases/tag/v7.0.2) |
| docker/setup-buildx-action | v3 | [v4.4.1](https://github.com/docker/setup-buildx-action/releases/tag/v4.4.1) |
| docker/login-action | v3 | [v4.7.0](https://github.com/docker/login-action/releases/tag/v4.7.0) |
| docker/build-push-action | v6 | [v7.4.0](https://github.com/docker/build-push-action/releases/tag/v7.4.0) |
| caprover/deploy-from-github | v1.1.2 | [v2.0.0](https://github.com/caprover/deploy-from-github/releases/tag/v2.0.0) |

## Complete audit package inventory

This table preserves all affected package entries from the live full audit, including inherited severity entries; one advisory can affect multiple entries.

| Package | Audit severity | Locked version(s) | Direct advisory sources (or inherited dependency) |
| --- | --- | --- | --- |
| @better-auth/drizzle-adapter | low | 1.7.3 | [GHSA-44jh-23m7-hpcf](https://github.com/advisories/GHSA-44jh-23m7-hpcf) |
| @esbuild-kit/core-utils | moderate | 3.3.2 | esbuild |
| @esbuild-kit/esm-loader | moderate | 2.6.5 | @esbuild-kit/core-utils |
| @fastify/static | moderate | 10.1.3 | glob |
| better-auth | critical | 1.7.3 | @better-auth/drizzle-adapter, [GHSA-44jh-23m7-hpcf](https://github.com/advisories/GHSA-44jh-23m7-hpcf), [GHSA-r4xp-prcw-77qf](https://github.com/advisories/GHSA-r4xp-prcw-77qf), [GHSA-965c-763c-88jm](https://github.com/advisories/GHSA-965c-763c-88jm) |
| brace-expansion | high | 5.0.9 | [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr), [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7), [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) |
| dompurify | critical | 3.4.15 | [GHSA-p98j-92pf-mc4p](https://github.com/advisories/GHSA-p98j-92pf-mc4p), [GHSA-6688-9rhm-gjv2](https://github.com/advisories/GHSA-6688-9rhm-gjv2), [GHSA-cg2g-xh64-v4q7](https://github.com/advisories/GHSA-cg2g-xh64-v4q7), [GHSA-mrv2-3pqr-j5jr](https://github.com/advisories/GHSA-mrv2-3pqr-j5jr), [GHSA-c6gr-qvv4-5v3f](https://github.com/advisories/GHSA-c6gr-qvv4-5v3f) |
| drizzle-kit | moderate | 0.31.10 | @esbuild-kit/esm-loader |
| esbuild | moderate | 0.18.20 | [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) |
| fast-uri | moderate | 3.1.7, 4.1.4 | [GHSA-hrr3-gc8f-f4qj](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj), [GHSA-jvvf-x445-j334](https://github.com/advisories/GHSA-jvvf-x445-j334), [GHSA-w74x-v6f9-j3xg](https://github.com/advisories/GHSA-w74x-v6f9-j3xg), [GHSA-xhq7-xmqj-769h](https://github.com/advisories/GHSA-xhq7-xmqj-769h), [GHSA-wjr9-j795-jxcr](https://github.com/advisories/GHSA-wjr9-j795-jxcr), [GHSA-333x-w4r6-6crp](https://github.com/advisories/GHSA-333x-w4r6-6crp) |
| fastify | moderate | 5.12.3 | [GHSA-4mh8-r7rc-xpvc](https://github.com/advisories/GHSA-4mh8-r7rc-xpvc), [GHSA-389g-gv7q-r4x8](https://github.com/advisories/GHSA-389g-gv7q-r4x8) |
| glob | moderate | 13.0.6 | [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), minimatch |
| minimatch | moderate | 10.2.6 | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) |
| next | critical | 16.3.5 | [GHSA-vcvr-r3jv-pc5j](https://github.com/advisories/GHSA-vcvr-r3jv-pc5j), [GHSA-3w37-wq28-93x7](https://github.com/advisories/GHSA-3w37-wq28-93x7), [GHSA-4jqv-mc3x-m676](https://github.com/advisories/GHSA-4jqv-mc3x-m676), [GHSA-39w2-rjm5-chcv](https://github.com/advisories/GHSA-39w2-rjm5-chcv), [GHSA-f87g-xv8r-7p7x](https://github.com/advisories/GHSA-f87g-xv8r-7p7x), [GHSA-mcj8-r9mp-w47p](https://github.com/advisories/GHSA-mcj8-r9mp-w47p), [GHSA-cjq9-62q9-8jv4](https://github.com/advisories/GHSA-cjq9-62q9-8jv4), [GHSA-2464-fhr4-w9xw](https://github.com/advisories/GHSA-2464-fhr4-w9xw), [GHSA-p3m5-59mp-jv5r](https://github.com/advisories/GHSA-p3m5-59mp-jv5r), [GHSA-h694-7cp9-m8p3](https://github.com/advisories/GHSA-h694-7cp9-m8p3), [GHSA-673q-mjm6-r5xr](https://github.com/advisories/GHSA-673q-mjm6-r5xr) |
| nodemailer | moderate | 10.0.10 | [GHSA-8c8m-p3m8-cjg8](https://github.com/advisories/GHSA-8c8m-p3m8-cjg8), [GHSA-m943-m63m-w62w](https://github.com/advisories/GHSA-m943-m63m-w62w), [GHSA-85x2-q946-cp5h](https://github.com/advisories/GHSA-85x2-q946-cp5h), [GHSA-4ffr-jq9g-5ffx](https://github.com/advisories/GHSA-4ffr-jq9g-5ffx), [GHSA-g73g-hqqh-jr95](https://github.com/advisories/GHSA-g73g-hqqh-jr95) |
| sharp | high | 0.35.4 | [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) |
| source-map-js | high | 1.2.1 | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) |
| vite | high | 8.2.2 | [GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv), [GHSA-r825-w8mm-5pxw](https://github.com/advisories/GHSA-r825-w8mm-5pxw), [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm), [GHSA-9jrq-w75r-8gcw](https://github.com/advisories/GHSA-9jrq-w75r-8gcw), [GHSA-rq7h-c2jc-7f22](https://github.com/advisories/GHSA-rq7h-c2jc-7f22), [GHSA-vfpm-58rq-9qcg](https://github.com/advisories/GHSA-vfpm-58rq-9qcg) |
| zod | high | 4.5.4 | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) |

## Suggested delivery order and validation

1. Security maintenance: direct auth/API/mail/Vite fixes, compatible transitive refresh, PostgreSQL minor update and freshly pulled Node base. Re-audit both full and production lockfiles; explicitly list remaining Static/Kit findings rather than promising zero automatically. Add automated dependency/security update visibility (none currently configured in CI).
2. Pascal migration: coordinated package and Three update, adapt any changed node/capture/material APIs, then reevaluate WebGL patch and unused Next/jsPDF dependencies.
3. Optional platform updates: React, PDF.js, compiler and CI action majors in reviewable batches. Do not combine deployment-action changes with unrelated editor work.
4. Export designer: use the [Trek review](trek-export-designer-review.md) to adapt useful interactions while preserving measured document geometry, preview/issue identity and venue-owned report templates.

After updates run npm ci, typecheck/build, unit and integration tests, and existing Playwright export/workspace/3D coverage on x64 and arm64. Exercise password/OIDC flows, invitations/mail, PDF import, PDF output physical scale and stale preview issuance. Container-check Node, fonts and image dependencies. These acceptance gates were proposed during the initial assessment; follow-up implementation and validation are recorded near the top of this document. Existing unrelated CONTEXT.md and travelling-group spec changes were preserved.
