# CapRover deployment

Deploy Bühnenplaner to CapRover from the private GitHub repository. GitHub Actions builds the Docker image on every push to `main` and tells CapRover to run that image. CapRover never needs GitHub repository access.

Default names below use `stageplanner` (app) and `stageplanner-db` (Postgres). Change them if you prefer other CapRover app names; keep the GitHub `CAPROVER_APP` secret in sync.

## What you will create

| Piece | Where | Once or ongoing |
| --- | --- | --- |
| Postgres app | CapRover One-Click | Once |
| Web app + env + volume | CapRover | Once |
| App token + GitHub secrets | CapRover + GitHub | Once |
| GHCR registry login on CapRover | CapRover Cluster | Once (private packages) |
| Image build + deploy | GitHub Actions on `main` | Every push |
| Administrator bootstrap | CapRover container exec | Once |

## 1. Create Postgres

1. Open <https://captain.example.org>.
2. **Apps** → **One-Click Apps/Databases** → **PostgreSQL**.
3. App name: `stageplanner-db`.
4. Use Postgres **17** (or another 17.x tag from Docker Hub).
5. Set username, password, and database name (for example `stage_planner` for all three user/db fields, with a strong random password). Save the password somewhere safe.
6. Deploy and wait until the app is running.

Other apps reach it at `srv-captain--stageplanner-db:5432`.

## 2. Create the web app shell

1. **Apps** → **Create New App**.
2. Name: `stageplanner`.
3. Enable **Has Persistent Data**.
4. Create the app (do not deploy source yet).

### HTTP settings

1. Open `stageplanner` → **HTTP Settings**.
2. Container HTTP port: `3000`.
3. Enable HTTPS for `stageplanner.example.org` (or attach your custom domain and enable HTTPS there).
4. Optional: enable websocket support (not required for the current app).

### Persistent data

1. Open **App Configs** → persistent directories.
2. Map a CapRover volume to container path `/data/storage`.

### Environment variables

Set these under **App Configs** (values are examples — replace secrets and the workspace UUID):

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
STORAGE_DIR=/data/storage
APP_ORIGIN=https://stageplanner.example.org
BETTER_AUTH_SECRET=
WORKSPACE_ID=
WORKSPACE_NAME=Unsere Theatergruppe
DATABASE_URL=postgresql://stage_planner:replace-with-postgres-password@srv-captain--stageplanner-db:5432/stage_planner
```

Generate secrets locally:

```sh
openssl rand -base64 48   # BETTER_AUTH_SECRET
uuidgen                   # WORKSPACE_ID
```

`APP_ORIGIN` must be the public HTTPS origin with **no** path or trailing slash. Production refuses non-HTTPS origins.

**`DATABASE_URL` must match the Postgres CapRover app exactly.** Open the Postgres app → **App Configs** and copy:

| CapRover env on the DB app | Goes into `DATABASE_URL` as |
| --- | --- |
| `POSTGRES_USER` | username after `postgresql://` |
| `POSTGRES_PASSWORD` | password between `:` and `@` |
| `POSTGRES_DB` | database name after the final `/` |

Host is `srv-captain--` plus the **Postgres app name**, port `5432`. Example if the DB app is `stageplanner-db`, user and database are both `stage_planner`, password `s3cret`:

`postgresql://stage_planner:s3cret@srv-captain--stageplanner-db:5432/stage_planner`

Never leave placeholder words such as `USER`, `PASS`, `DB`, or `YOUR_DB_PASSWORD` in the URL. A log line `database "DB" does not exist` means the path after `/` is still a placeholder.

Leave Pocket ID and mail variables unset until you configure them. Do **not** put `BOOTSTRAP_ADMIN_*` here permanently.

Save and restart is fine; the first real container image arrives from GitHub Actions.

## 3. Enable CapRover app token

1. Open `stageplanner` → **Deployment**.
2. **Enable App Token**.
3. Copy the token. You will store it only in GitHub Actions secrets.

## 4. Allow CapRover to pull private GHCR images

The deploy workflow builds `linux/amd64` and `linux/arm64` on native runners (no QEMU), then publishes a multi-arch manifest to `ghcr.io/thiesmoeller/stage_planner`. Private repos create private packages by default. CapRover hosts that are ARM (for example many Hetzner CAX VMs) pull the `linux/arm64` slice of that manifest.

GitHub Packages / GHCR only accepts a **classic** PAT for registry login. A fine-grained token scoped to the repo will **not** show `read:packages` — that scope is not a repository permission, and fine-grained PATs are not supported for GHCR pulls.

1. GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)** → **Generate new token (classic)**.
2. Note: e.g. `caprover-ghcr-read`. Expiration: your choice.
3. Enable only **`read:packages`** (optionally also `repo` if GitHub asks you to link the package later; for a private package owned by your user, `read:packages` is enough once you can see the package).
4. Generate and copy the token once.
5. CapRover → **Cluster** → **Docker Registries** → add:
   - Registry: `ghcr.io`
   - Username: your GitHub username
   - Password: the classic PAT
6. After the first successful workflow run, confirm the package exists under the repo’s **Packages** sidebar (or your profile → Packages). Leave it private once CapRover can pull it.

Alternative if you prefer not to use a classic PAT: make the GHCR package **public** after the first publish (package settings → change visibility). CapRover can then pull without registry credentials. Only do this if publishing the image is acceptable.

## 5. GitHub Actions secrets

In <https://github.com/thiesmoeller/stage_planner> → **Settings** → **Secrets and variables** → **Actions**, add:

| Name | Value |
| --- | --- |
| `CAPROVER_SERVER` | `https://captain.example.org` |
| `CAPROVER_APP` | `stageplanner` |
| `CAPROVER_APP_TOKEN` | token from step 3 |

`GITHUB_TOKEN` is provided automatically for pushing to GHCR.

## 6. Ship the deploy files and push `main`

Merge/push the repository files that enable CapRover:

- `captain-definition`
- deploy job in `.github/workflows/test.yml`
- production bootstrap at `node dist/server/cli/bootstrap.js`

After push to `main`:

1. GitHub → **Actions** → **Planner checks** must go green (tests, then deploy).
2. CapRover → `stageplanner` → **Deployment** should show a new version from the image tag.
3. Confirm <https://stageplanner.example.org/api/health> returns `{"status":"ok"}`.

Migrations run automatically on container start (`Dockerfile` CMD).

## 7. Bootstrap the first administrator (once)

1. Temporarily add to CapRover app env:

```env
BOOTSTRAP_ADMIN_EMAIL=you@example.org
BOOTSTRAP_ADMIN_NAME=Admin
BOOTSTRAP_ADMIN_PASSWORD=choose-a-long-password
```

2. Save and ensure the container is running with those variables.
3. CapRover → `stageplanner` → **Deployment** (or App details) → open a one-off shell / exec into the container, then:

```sh
node dist/server/cli/bootstrap.js
```

4. You should see `Administrator und Arbeitsbereich angelegt.` (or the already-initialized message on repeat).
5. **Remove** the three `BOOTSTRAP_ADMIN_*` variables from CapRover, save, and restart.
6. Sign in at your `APP_ORIGIN`.

There is no public registration and no bootstrap HTTP endpoint.

## Ongoing updates

Every push to `main` that passes checks rebuilds the image and deploys it. Postgres data, CapRover env vars, and `/data/storage` are not reset by deploys.

Rollback: CapRover **Deployment** → revert to a previous image version. Env and volume config are not reverted.

## Backup notes

- **Database**: back up the CapRover Postgres volume / use `pg_dump` against `stageplanner-db`.
- **Files**: back up the persistent directory mapped to `/data/storage` (uploads and frozen PDFs).
- Restore means restoring both; then run the app so migrations can apply to retained data.

## Optional later

- Custom domain: add it under HTTP Settings, set `APP_ORIGIN` to that HTTPS origin, enable HTTPS, redeploy/restart.
- Pocket ID: set the optional OIDC variables from `.env.example` after the base install works.

## Optional: Brevo mail (invites and password reset)

Stageplanner sends invitation and password-reset mail through SMTP. Use the same Brevo SMTP credentials as other CapRover apps (WordPress, etc.) — **not** the Brevo HTTP API key.

1. In Brevo → **SMTP & API** → **SMTP**, copy the SMTP login and generate/copy an SMTP key. Confirm a verified sender address.
2. CapRover → `stageplanner` → **App Configs** → add:

```env
MAIL_HOST=smtp-relay.brevo.com
MAIL_PORT=587
MAIL_USER=<smtp-login-from-brevo>
MAIL_PASS=<smtp-key-from-brevo>
MAIL_FROM=<verified-sender@your-domain>
```

Port `587` uses STARTTLS (recommended). Port `465` uses SSL/TLS if you prefer.

3. Save and **restart** the app.
4. Sign in as **Administration**, open the workspace home, scroll to **Mitglieder**, and invite a test address.
5. Open the link in the mail (`/#/einladung/…`), set a password (at least 12 characters), and sign in.

If invite returns a mail error, check CapRover logs: wrong SMTP key (not API key), unverified `MAIL_FROM`, or incomplete `MAIL_HOST` / `MAIL_USER` / `MAIL_PASS`.

`BREVO_API_KEY` remains supported as a fallback when SMTP is unset. Do not put an SMTP key in `BREVO_API_KEY`.

## Optional: user feedback by email

After configuring SMTP or the Brevo HTTP API above, set this in **App Configs** and restart:

```env
FEEDBACK_TO_EMAIL=maintainer@example.org
```

Signed-in members (including viewers) then see **Feedback** in the header and editor Help menu. The recipient stays server-side; mail uses `MAIL_FROM`, with the reporting member as Reply-To. If the recipient or mail delivery is unset, the entry is hidden. No database migration or extra service is needed.

Users choose a problem or feature request and write one short message. They can preview/remove work details, recent activity, and screenshots before sending. In editors, the visible work panes are captured automatically; elsewhere users can paste or upload a screenshot. A separate, unchecked option attaches the current design, including unsaved model changes but excluding unapplied form inputs and binary assets. Capturing feedback does not save or change the design.

Reports include the app version, canonical page link, browser/viewport, sender, and workspace. Recent activity contains at most 30 named actions/status codes from five minutes in memory, with no typed text, raw URLs, console logs, or request bodies. Activity is selected initially for problems and unselected for feature requests. Two PNG/JPEG images (2 MiB each) and a diagnostic design snapshot (2 MiB) are supported. JSON attachments use `.json.txt` names for Brevo attachment compatibility. The design snapshot is diagnostic data, not an import/restore package.

Successful submission means the mail provider accepted the message, not that it reached the inbox. Delivery failures retain the draft for retry; a draft also survives closing the dialog, but not logout or a page reload. Feedback is not stored in the app database or filesystem. The mail provider and recipient mailbox retain their copies. Each user is limited to five submission attempts per minute per running app instance; this in-memory limit resets on restart. There is no delivery queue or retry worker.

For a deployment check, submit one report, reply to its sender, and check the screenshot and diagnostic attachments in the maintainer inbox.
