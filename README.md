# Bühnenplaner

German-language stage planner for a single theatre group's private workspace.

Implemented: [slice 01](docs/issue-breakdown.md#01-enter-a-private-workspace-with-password-sign-in), [slice 02](docs/issue-breakdown.md#02-create-and-edit-a-saved-rectangular-stage-layout), [slice 03](docs/issue-breakdown.md#03-inspect-the-saved-layout-in-linked-threejs-views), [slice 04](docs/issue-breakdown.md#04-export-a-frozen-a4-overhead-construction-plan), [slice 05](docs/issue-breakdown.md#05-define-rectangular-door-and-window-wall-types), [slice 26](docs/issue-breakdown.md#26-sign-in-through-pocket-id-and-manage-linked-accounts), [slice 27](docs/issue-breakdown.md#27-invite-members-and-recover-passwords-through-brevo), and [slice 28](docs/issue-breakdown.md#28-protect-editing-with-exclusive-leases-and-stale-write-checks). After sign-in, editors can create a production with a rectangular venue, a venue adaptation and a scene, place 1200 × 2400 × 28 mm walls in a millimetre top-down plan, inspect the same layout in a linked Three.js view, undo or redo session edits, reload the autosaved layout, and export a named frozen A4 construction plan at a fixed 1:50 scale. Scenes can define reusable wall types with rectangular openings that agree in the plan, 3D view, and frozen PDFs. Later layout edits do not change a frozen revision; viewers can download existing PDFs but cannot freeze new ones. Opening a plan for editing takes an exclusive lease. Optional Pocket ID OIDC sits beside password sign-in. Administrators invite members with roles; local-password users can recover access.

## Local setup

Requires Node.js 24 LTS, npm and Docker Compose. Commands run from the repository root.

1. `npm ci`
2. `cp .env.example .env`
3. Generate a signing secret with `openssl rand -base64 48` and put it in `BETTER_AUTH_SECRET` in `.env`. Set the workspace name and the three `BOOTSTRAP_ADMIN_*` values. Use a 12–128 character password. Keep `.env` private; it is ignored by Git.
4. `docker compose up -d --wait db`
5. `npm run db:migrate`
6. `npm run admin:bootstrap`
7. Remove the three bootstrap values from `.env`, then run `npm run dev`.
8. Open <http://localhost:5173> and sign in with the administrator account.

Bootstrap runs only as an explicit command. It atomically creates an identity, password account, workspace and administrator membership. Repeating the command for the existing administrator changes nothing, including the password. Once a workspace exists, bootstrap refuses to add or promote other users. There is no public registration or bootstrap HTTP endpoint.

The Compose file is for local development only. Its database binds to loopback and persists in a named Docker volume. `docker compose stop` stops it without deleting data. Actual deployment and CapRover configuration remain later work.

## Verification

```sh
npm run typecheck
npm test
npm run test:integration
npm run build
npx playwright install chromium
npm run test:e2e
```

Integration/browser tests use local PostgreSQL at port 55432 by default; override `TEST_DATABASE_URL` for a dedicated test server. The test database user needs permission to create databases. Each run creates a uniquely named database, applies migrations twice, and removes that database afterwards. Tests do not reset the application database. Browser tests serve the built application and use a disposable example administrator.

Tests cover concurrent/idempotent bootstrap, login, CSRF origin rejection, closed registration, cross-workspace access, non-members, viewer/editor role restrictions, immediate membership revocation, expired sessions, logout, reload, mobile layout and network-error recovery. Layout tests cover millimetre wall geometry and session undo/redo, revision-checked competing saves, pinned venue versions, malformed documents, viewer write denial, serialized autosave including retry after failure, exclusive editing leases with competing clients, and the browser workflow that creates a layout, moves a wall, undoes the move and reloads the saved result without restoring undo history. Export tests cover a 1200 mm wall measuring 24 mm on the A4 page at 1:50, frozen snapshots that ignore later source edits, retry from the same frozen input after a failed render, viewer freeze denial, and downloading a named revision from the editor.

`npm audit` currently reports four moderate findings through Drizzle Kit's legacy esbuild loader. They also appear with `--omit=dev` because Better Auth declares Drizzle Kit as an optional peer. This application uses the loader for migration tooling and does not run the affected esbuild development server. The findings remain unresolved; do not use an automatic downgrade of Drizzle Kit as an audit fix.

## Structure and choices

- `src/client`: React 19 with Vite 8, German UI, same-origin API access. React is a small browser shell here; layout documents, millimetre geometry and the command stack live in `src/shared` so they stay independent of rendering. Coordinates are millimetres with a centre-anchored wall, origin at the audience-left front of the venue, +x audience-right, +y away from the audience, and positive rotation counterclockwise. Vite's supported React integration and Node requirements are documented in the [official Vite guide](https://vite.dev/guide/).
- `src/client/editor` and `src/server/productions`: top-down SVG editing with a 500 ms revision-checked autosave. Pending, saved, failed and conflict states stay visible; a 409 or 423 leaves the local draft intact. Undo history is session-only. Exclusive editing leases live in `src/server/productions/leases.ts`. The browser sends a heartbeat every 15 seconds; the server expires an abandoned lease after 45 seconds (three missed heartbeats). The same lease module covers scene plans and future venue-record writes; inventory is not implemented yet. Concurrent collaborative editing is out of scope.
- `src/server/exports`: named frozen construction-plan revisions. PDFKit draws a vector A4 overhead at a documented 1:50 scale from the frozen snapshot (design, resolved wall corners, and venue information). Generated files live behind a local-filesystem storage interface; PDF bytes are not stored in JSONB. Rendering runs in a child process so it stays off the API event loop. Failure can be retried from the same snapshot.
- `src/server/identity`: Better Auth identity/session integration, private bootstrap, and application-owned workspace authorization. See the [Fastify integration](https://better-auth.com/docs/integrations/fastify) and [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle) documentation.
- `src/server/db` and `drizzle`: PostgreSQL/Drizzle schema and checked-in migrations. Auth identities and workspace memberships are separate relational records; sessions use the database.
- `src/shared/contracts.ts`: Zod REST schemas shared with the browser. Authenticated members can inspect generated OpenAPI at `/api/openapi.json`; Better Auth routes are handled separately.

Dependencies are exact-pinned in `package.json` and `package-lock.json`, with TypeScript 5.9.3. `npm run build` checks all TypeScript, builds browser assets into `dist/web`, and compiles the backend into `dist/server`.

For the built server, set `NODE_ENV=production`, an HTTPS `APP_ORIGIN`, and run `npm start` with `.env` configured. The server then serves the built UI and API together. The application currently trusts only the socket peer for authentication throttling. Trusted reverse-proxy configuration, persistent/shared rate-limit storage, deployment packaging and HTTPS termination must be addressed in the installation slice. Authentication cookies are HttpOnly, SameSite=Lax and Secure when the configured origin uses HTTPS. Membership is read afresh on every protected request.

Next: slice 05 — reusable wall types with rectangular door and window openings.
