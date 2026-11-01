# StageHarbour

**One production. Many stages.**

Scenery planning for touring theatre — keep the set, the stock, and each venue adaptation in one place, then hand the crew a plan they can build from.

<p align="center">
  <img src="assets/branding/stageharbour/hamburg-daylight-stage-hero.png" alt="StageHarbour — scenic flats framing a harbour skyline" width="100%" />
</p>

## Try it now

**[Open the live demo →](https://thiesmoeller.github.io/stageharbour/)**

No account. No Docker. No install. The demo runs entirely in your browser with a seeded Beispiel-Theatergruppe workspace.

| You can | How |
| --- | --- |
| Explore a production and open a Bühnenbild | Start from **Produktionen & Bühnenbilder** |
| Edit the millimetre plan and linked 3D view | Open **Bühnenbild 1** |
| Walk a Spielstätte, Bestand, and Hilfe | Use the workspace navigation |
| Keep your edits | **Arbeitsbereich speichern…** writes a file on your device |

The UI is German. Clearing site data loses the browser copy unless you saved a file. The demo skips PDF export, uploads, and cloud sync — those belong to a self-hosted group install.

Prefer running locally without Postgres? `npm run dev:local` builds the same browser-local mode.

---

## Why StageHarbour

Touring theatre groups rebuild the same production in different rooms. Spreadsheets, SketchUp files, and WhatsApp threads do not survive that journey well.

StageHarbour is the harbour for that work:

1. **Carry your scenery system** — reusable walls, braces, panels, and stock stay the group’s property across productions.
2. **Adapt with context** — each venue has its own geometry; adaptations and warnings stay visible.
3. **Give crews a stable plan** — issued revisions keep labels, requirements, and warnings when you freeze them in a private install.

Built for set designers, technical leads, stage managers, and volunteer crews who share those jobs under time pressure.

## What you can do

- **Plan in millimetres** — place walls, openings, braces, platforms, stairs, and placeholders on a measured top-down plan with a linked 3D view.
- **Model real venues** — draw irregular outlines, calibrate a floor-plan trace, mark keep-clear zones, power/audio pins, and clearance warnings.
- **Track physical stock** — assign panels from Bestand, catch duplicate or unavailable assignments, record intended vs actual finishes.
- **Reuse across houses** — duplicate scenes, copy into another Spielstätte, and keep Szenenvorlagen as read-only starting points.
- **Issue construction documents** *(self-hosted)* — document studio for Regie / Probe, Darstellende, and Aufbau / Technik presets; frozen PDF revisions with scale, elevations, and cable lists.

## Self-hosted workspace

The full product is a private group install: sign-in, roles, exclusive editing leases, uploads, inventory, and PDF/package pipelines backed by PostgreSQL.

CapRover deploy from `main` is documented in **[docs/caprover.md](docs/caprover.md)**.

### Quick local development

Requires Node.js 24 LTS, npm, and Docker Compose.

```sh
npm ci
cp .env.example .env
# Set BETTER_AUTH_SECRET, workspace name, and BOOTSTRAP_ADMIN_* in .env
docker compose up -d --wait db
npm run db:migrate
npm run admin:bootstrap
# Remove BOOTSTRAP_ADMIN_* from .env, then:
npm run dev
```

Open http://localhost:5173 and sign in with the administrator account.

Browser-local demo (no database): `npm run dev:local`  
Same check suite as CI: `npm run check:ci` (Postgres + Chromium required)

## Project status

StageHarbour is under active development for a real theatre group. The German UI and millimetre editor are usable today; some catalogue and pilot work continues in [docs/issue-breakdown.md](docs/issue-breakdown.md) and [docs/pascal-editor-status.md](docs/pascal-editor-status.md).

Brand direction lives in [assets/branding/stageharbour/BRAND.md](assets/branding/stageharbour/BRAND.md). Architecture decisions are recorded under [docs/adr/](docs/adr/).

## Contributing

Issues and pull requests are welcome. Please run the full gate before pushing to a branch you want merged:

```sh
npm test
npm run test:integration
npm run test:e2e
```

`main` is protected: changes go through a PR, and the `test` check must pass.
