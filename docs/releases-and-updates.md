# Releases and updates

How NebulaHome is versioned, how a release is cut and published, and how a house updates itself.
Read this before touching versions, the release script, the Maintenance page or the update code;
change this file in the same commit as the behaviour it describes.

Status (2026-10-25): built and unit-tested; not yet exercised live (a real release, a real update
of a running container, a restart). Section 6 lists what was left out.

## 1. Versions

| What                          | Scheme                                    | Where it lives                                                                                     | Who raises it                                 |
| ----------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| The product, Nebula Home      | CalVer `YYYY.M.N`, beta `YYYY.M.N-beta.K` | `version` of the root `package.json` and of every private workspace; `NEBULA_VERSION` in the image | `pnpm release:beta` / `pnpm release:stable`   |
| The package API level         | SemVer, `1.0.0` today                     | `NEBULA_PLATFORM_VERSION` (packet-manager, hub, package-host)                                      | By hand, only with a change packages can see  |
| `@nebulahome/package-sdk`     | SemVer                                    | its own `package.json` + `CHANGELOG.md`                                                            | By hand, tag `package-sdk@X` (RULES.md §17.4) |
| `@nebulahome/integration-sdk` | SemVer                                    | its own `package.json` + `CHANGELOG.md`                                                            | By hand, tag `integration-sdk@X`              |

- **CalVer**: the month has no leading zero (SemVer forbids one): `2026.11.0`, `2026.11.1`,
  `2026.12.0`. `N` starts at 0 each month. A CalVer string is still a valid SemVer string, so the
  shared `compareVersions` (`packages/contracts`) orders them, a beta below its release.
- **Why two platform versions**: packages declare `"platform": "^1.0.0"` and the packet-manager
  checks that range against `NEBULA_PLATFORM_VERSION`. A CalVer product version would fail every
  such range, so the product version (`NEBULA_VERSION`) is for people, update checks, logs and
  backups, and `NEBULA_PLATFORM_VERSION` stays the API level packages target.
- **What the bump touches**: the root `package.json` and every workspace marked `"private": true`.
  The two published SDKs are never bumped by the release script.
- **At runtime**: the image is built with `--build-arg NEBULA_VERSION=X`; the Dockerfile turns it
  into `ENV NEBULA_VERSION` and the label `org.opencontainers.image.version`. Each service reads
  it through its config schema (default `0.0.0-dev` outside a release build); `/healthz` reports it.

## 2. Branches and tags

- `dev`: everyday work, and where betas are tagged.
- `main`: only stable releases. A stable release merges `dev` into `main` with a merge commit
  (`--no-ff`, RULES.md §17.3); the tag sits on that merge commit. `main` is created from `dev` by
  the first stable release.
- Tags: `vX` (`v2026.11.0`, `v2026.11.0-beta.1`). They never clash with the SDK tags
  (`package-sdk@…`, `integration-sdk@…`).
- **A beta is a version with a `-beta.K` suffix, and only that.** Its GitHub release is marked
  prerelease; a stable one is marked latest. The two must always agree.

## 3. Cutting a release

```bash
pnpm release:beta
pnpm release:stable
```

Both accept `--dry-run`, which prints the version, the files it would change and every command,
and does nothing. The script is `scripts/release.ts`; `nextVersion` in it is pure and tested
(`scripts/release.test.ts`).

1. **Preflight**: on `dev`, clean tree, `git fetch`, `dev` equal to `origin/dev`, `gh` signed in,
   Docker reachable.
2. **Version** from the existing `v*` tags and today's date:
   - next stable `X` = `YYYY.M.(N+1)` if this month already has one, else `YYYY.M.0`;
   - `release:beta`: an open beta of `X` (`X-beta.K`, no `vX` yet) → `X-beta.(K+1)`; otherwise
     the next `X` → `X-beta.1`;
   - `release:stable`: an open beta of `X` → `X` (promotion); otherwise the next `X`.
3. **Bump** the versions (section 1).
4. **Gates**: `pnpm lint`, `pnpm typecheck`, `pnpm test`, judged by their exit codes.
5. **Image**: `docker build --build-arg NEBULA_VERSION=X`, amd64 only, tagged
   `nebulahome/platform:X` plus the moving tags: a beta moves `beta`; a stable moves `stable`,
   `latest` and `beta` (the beta channel always has the newest of the two).
6. **Commit** `chore(repo): release X` on `dev` and an annotated tag `vX`. A stable release then
   switches to `main`, merges `dev` with `--no-ff`, puts the tag on the merge commit, and switches
   back to `dev`.
7. **Publish**: push `dev` (and `main`) and the tag, `docker push` every image tag, then
   `gh release create vX --generate-notes` (`--prerelease` for a beta, `--latest` for a stable).
8. If a step after the push fails, the script prints the commands still to run by hand; nothing
   before the push is public, so an earlier failure leaves only local changes to undo.

**Which image tag a house runs** (`NEBULA_IMAGE_TAG` in `infra/.env`): `latest` or `stable` for
the stable channel, `beta` for the beta channel. A beta house must not run `docker compose pull`
on `latest`: that would go back to an older stable on a database the beta already migrated, which
the migrator refuses (`packages/db/src/migrate.ts`).

## 4. How a house updates

Settings › System › Maintenance (board `N-Settings-System`).

### What is checked

| Kind         | Source                                                                                      | Channel                                             |
| ------------ | ------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Nebula Home  | GitHub Releases of `nebulahome/platform`, read by the supervisor every 6 h and on Check now | `updates.channel.core`: Stable or Beta              |
| Packages     | The Community Hub's package index, read by the packet-manager                               | `updates.channel.packages`, Stable only for now     |
| Integrations | The Community Hub's integration index                                                       | `updates.channel.integrations`, Stable only for now |

The repository is private for now; until it is public the Nebula Home check fails and the row
says so. The platform's own container is left out of the Docker Hub digest check, so the two never
disagree.

### Settings

`updates.auto.packages`, `updates.auto.integrations` (off by default), `updates.window`
(`{mode: 'quietest' | 'fixed', time}`), `updates.backup_first` (on), `updates.channel.core`,
`updates.channel.packages`, `updates.channel.integrations`. **Nebula Home never updates by
itself**: only its Update button does.

### The quietest time

`sensor.system_quiet_time` on the System device: the start, `HH:MM` in the house's time zone, of
the quietest hour of a typical day, learned from `sensor.system_cpu_usage` over the last 28 days
(backup windows left out). Core learns it at start and just after midnight. Backups and updates in
"Quietest" mode read it; automations can use it through a time trigger whose time comes from an
entity (`at: {kind: 'entity', entityId}`).

### A round of updates

One round at a time, run by the packet-manager (`run_updates`), whether started by Update, Update
all or the schedule:

1. **Back up first** (when on): skipped if the last backup succeeded, finished less than
   5 minutes ago and took every part a backup takes now (`backup.sections`); otherwise a backup is
   run and waited for - one already running is waited for instead. A failed backup stops the
   round (`apps/packet-manager/src/domain/backup-first.ts`, `services/update-runner.ts`).
2. Packages, then integrations.
3. Nebula Home last, if it is in the round: it restarts everything.

### Updating Nebula Home

The supervisor runs inside the platform's container and cannot replace it, so:

1. The supervisor pulls `nebulahome/platform:<version>` and checks its version label.
2. It starts a throwaway updater container from the **new** image, with the Docker socket.
3. The updater (`apps/supervisor/src/updater.ts`, `services/platform-updater.ts`) retags the new
   image with the reference the old container uses (so compose sees no change), stops the old
   container (45 s grace), copies the `/data` and PostgreSQL mounts (volume or host folder) into
   the volumes `nebulahome-pre-<old version>-data` and `-postgres`, and creates the new container
   like the old one (`apps/supervisor/src/domain/recreate.ts`).
4. It waits up to 5 minutes for Docker's health check to say healthy. On success it removes the
   old container and the copies. On failure it removes the new container, copies the volumes back,
   retags the old image and starts the old container again.
5. The outcome is written to `/data/updates/last.json`; the page shows a failed one.

Without the Docker socket, or outside the container (`pnpm dev`), Update is refused with the
reason.

### Restart and shut down

- **Restart**: `docker restart` of the platform's own container, done by the Docker daemon, so it
  completes even though the caller stops. Without the socket: s6's `halt`, and the
  `unless-stopped` policy starts the container again.
- **Shut down**: `docker stop` of its own container; it stays down until started again. Not
  possible without the socket (refused with the reason).

### Permissions

`system:update` runs updates; `system:power` restarts and shuts down. Changing the update settings
is `settings:write`.

## 5. Decisions still open

For packages and integrations:

- **How betas reach a house.** The Hub imports prereleases but leaves them out of the indexes
  (`listIndexableVersions`, `NOT v.is_prerelease`). Either each version in the index carries a
  `prerelease` flag, or the Hub serves a separate beta index. The packet-manager would then take
  prereleases only on the beta channel. Until then the two channel options stay disabled.
- **Import validation.** Whether the Hub refuses a GitHub prerelease without a `-beta` suffix (or a
  suffixed version not marked prerelease), so the flag and the version always agree.
- **Release script for `pkg-*` and `integration-*` repositories.** Reuse `scripts/release.ts` or one
  per repository; they stay SemVer.
- **Automatic updates across a major version**, or minor and patch only.
- **Automatic rollback** of a package or integration that fails after an update (the packet-manager
  already keeps a `rollbackTo` window).

For the platform:

- Automatic updates of Nebula Home (deferred; the setting `updates.auto.core` does not exist).
- An arm64 image (amd64 only for now).
- Restarting or shutting down the host machine (out of reach of the container).
- Checking free disk space before the volume copies of an update.

## 6. Left out, and how it behaves today

- **Check now** asks GitHub again; the package and integration indexes are re-read on their own
  cache time, not forced.
- Notes of Nebula Home are shown as plain text (the web UI has no Markdown renderer); a package's
  or an integration's notes are a link.
- The settings tree has no badge with the number of updates, and the rows carry no Failed /
  Degraded pills: the board's, not built.
- A round lives in the packet-manager's memory: its restart forgets the last round.
- The updater does not check free disk space before copying the volumes.
- Settings, seeds and grants were added to `0001_initial_schema.sql`: the dev and container
  databases need `db:reset`.
