# Browser-local adapter (not offline sync)

StageHarbour needs a tryable demo that runs without Docker, Postgres, CapRover, or accounts. That is a **second adapter at the client transport seam** (`ApiTransport`), not offline editing of a hosted workspace. When `VITE_LOCAL_MODE=1`, the SPA installs `LocalTransport` over an IndexedDB working store and optional disk snapshot backup (SolidCraft-style Speichern/Laden). There is no cloud sync and no import path into a private CapRover install. Host the demo as a **separate static site**; do not advertise it as a CTA on the private login.

The private install keeps the HTTP transport, PostgreSQL, identity, uploads, and PDF/package pipelines. Local mode disables those capabilities (`pdf`, `uploads`, `identity`, `members`, `polyHaven`, `brandingAdmin`, `packages`) and seeds a single-browser demo workspace. Data lives in that browser’s IndexedDB until the user writes or reloads a disk snapshot; clearing site data loses the working copy unless a file backup exists.

## Considered options

- **PGlite / embedded Postgres in the browser** — rejected: heavy runtime for a demo; the seam already abstracts persistence via transport.
- **Offline editing of CapRover workspaces with later sync** — rejected: reopens the deferred connectivity decision; conflicts with leases, frozen revisions, and multi-user membership.
- **Import local snapshots into a private install** — rejected: bypasses inventory/identity boundaries and invites silent overwrite of crew data.
- **Demo CTA on the private CapRover login** — rejected: confuses demo data with the group’s workspace; keep a separate static host.
- **Second adapter + IndexedDB + disk backup on a separate demo host** — accepted.

## Consequences

- Build/serve local demo with `VITE_LOCAL_MODE=1` (`npm run dev:local`, `npm run build:local`). Private CapRover builds omit the flag.
- Shared editor and contracts stay the same; only the transport and capability matrix change.
- Non-goals remain: PGlite, sync into CapRover, hosted offline editing, and promoting the demo from the private login screen.
