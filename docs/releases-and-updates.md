# Releases and updates

How NebulaHome is versioned, how a release is cut and published, and how a house updates itself.
Read this before touching versions, the release script, the Maintenance page or the update code;
change this file in the same commit as the behaviour it describes.

Status (2026-10-27, round 3): built and unit-tested; not yet exercised live (a real release, a real update
of a running container, a restart). Round 3 added the restart and update screens every page shows
(below, "What every page shows") and the channels section of the page. Section 6 lists what was
left out.

## 1. Versions

**CalVer is for Nebula Home alone. Everything else - packages, integrations, the SDKs, the package
API level - is SemVer.**

| What                                        | Scheme                                                       | Where it lives                                                                                     | Who raises it                                           |
| ------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| The product, Nebula Home                    | **CalVer** `YYYY.M.N`, beta `-beta.K`, dev `-alpha.K`        | `version` of the root `package.json` and of every private workspace; `NEBULA_VERSION` in the image | `pnpm release:dev` / `release:beta` / `release:stable`  |
| Packages (`pkg-*` repositories)             | **SemVer** `1.5.0`, beta `1.5.0-beta.K`, dev `1.5.0-alpha.K` | the package's `package.json`, its GitHub release (imported by the Community Hub)                   | Each repository, by hand (no shared script yet, see §5) |
| Integrations (`integration-*` repositories) | **SemVer** `1.5.0`, beta `1.5.0-beta.K`, dev `1.5.0-alpha.K` | the integration's `package.json`, its GitHub release (imported by the Community Hub)               | Each repository, by hand (no shared script yet, see §5) |
| The package API level                       | SemVer, `1.0.0` today                                        | `NEBULA_PLATFORM_VERSION` (packet-manager, hub, package-host)                                      | By hand, only with a change packages can see            |
| `@nebulahome/package-sdk`                   | SemVer                                                       | its own `package.json` + `CHANGELOG.md`                                                            | By hand, tag `package-sdk@X` (RULES.md §17.4)           |
| `@nebulahome/integration-sdk`               | SemVer                                                       | its own `package.json` + `CHANGELOG.md`                                                            | By hand, tag `integration-sdk@X`                        |

- **Channels**: stable ⊂ beta ⊂ dev. A beta is `-beta.K`; a development build is `-alpha.K`
  (SemVer orders alpha < beta < release, which `-dev` would not: it sorts above `beta`). The dev
  channel takes everything, the beta channel betas and stables, the stable channel stables only.
- **CalVer**: the month has no leading zero (SemVer forbids one): `2026.11.0`, `2026.11.1`,
  `2026.12.0`. `N` starts at 0 each month. A CalVer string is still a valid SemVer string, so the
  shared `compareVersions` (`packages/contracts`) orders them, an alpha below a beta below its
  release.
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

- `dev`: everyday work, and where dev builds and betas are tagged.
- `main`: only stable releases. A stable release merges `dev` into `main` with a merge commit
  (`--no-ff`, RULES.md §17.3); the tag sits on that merge commit. `main` is created from `dev` by
  the first stable release.
- Tags: `vX` (`v2026.11.0`, `v2026.11.0-beta.1`, `v2026.11.0-alpha.3`). They never clash with the
  SDK tags (`package-sdk@…`, `integration-sdk@…`). An SDK tag makes no GitHub release - the
  SDKs are published on npm - so the platform's releases page lists Nebula Home alone.
- **A beta is a version with a `-beta.K` suffix, a dev build one with `-alpha.K`, and only that.**
  Their GitHub releases are marked prerelease; a stable one is marked latest. Flag and suffix must
  always agree.

## 3. Cutting a release (Nebula Home)

```bash
pnpm release:dev
pnpm release:beta
pnpm release:stable
```

All accept `--dry-run`, which prints the version, the files it would change and every command,
and does nothing. The script is `scripts/release.ts`; `nextVersion` is pure and tested
(`scripts/release-version.ts`, `release-version.test.ts`). It releases the platform only.

1. **Preflight**: on `dev`, clean tree, `git fetch`, `dev` equal to `origin/dev`, `gh` signed in,
   Docker reachable.
2. **Version** from the existing `v*` tags and today's date:
   - next `X` = `YYYY.M.(N+1)` if this month already has a version, else `YYYY.M.0`;
   - newest tag an open `X-alpha.K` (no `vX` yet): dev → `X-alpha.(K+1)`, beta → `X-beta.1`,
     stable → `X`;
   - newest tag an open `X-beta.K`: beta → `X-beta.(K+1)`, stable → `X`, dev → the next
     version's `-alpha.1` (an alpha of `X` would sort below its beta);
   - nothing open: the next `X`, with `-alpha.1`, `-beta.1` or nothing.
3. **Bump** the versions (section 1).
4. **Gates**: `pnpm lint`, `pnpm typecheck`, `pnpm test --concurrency=4`, judged by their exit
   codes. Four test suites at a time: turbo's default twenty, each with a vitest worker per core,
   push timing-bound tests past their timeouts.
5. **Image**: `docker build --build-arg NEBULA_VERSION=X`, amd64 only, tagged
   `nebulahome/platform:X` plus the moving tags: a dev build moves `dev`; a beta moves `beta` and
   `dev`; a stable moves `stable`, `latest`, `beta` and `dev` (each channel has the newest of what
   it takes).
6. **Commit** `chore(repo): release X` on `dev` and an annotated tag `vX`. A stable release then
   switches to `main`, merges `dev` with `--no-ff`, puts the tag on the merge commit, and switches
   back to `dev`.
7. **Publish**: push `dev` (and `main`) and the tag, `docker push` every image tag, then
   `gh release create vX --generate-notes` (`--prerelease` for a dev build or a beta, `--latest`
   for a stable).
8. If a step after the push fails, the script prints the commands still to run by hand; nothing
   before the push is public, so an earlier failure leaves only local changes to undo.

**Which image tag a house runs** (`NEBULA_IMAGE_TAG` in `infra/.env`): `latest` or `stable` for
the stable channel, `beta` for the beta channel, `dev` for the dev channel. A beta or dev house
must not run `docker compose pull` on `latest`: that would go back to an older stable on a
database the newer build already migrated, which the migrator refuses
(`packages/db/src/migrate.ts`).

## 4. How a house updates

Settings › System › Maintenance (board `N-Settings-System`).

### What is checked

| Kind         | Source                                                                                      | Channel                                             |
| ------------ | ------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Nebula Home  | GitHub Releases of `nebulahome/platform`, read by the supervisor every 6 h and on Check now | `updates.channel.core`: Stable, Beta or Dev         |
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

The page shows them as the board does: a section "Channels and automatic updates" with one row each
for Nebula Home, Packages and Integrations - the channel (Stable / Beta / Dev) and an Auto switch.
Nebula Home's Auto switch is shown off and disabled; Beta and Dev of packages and integrations are
disabled option by option until the Hub publishes them (section 5). "How updates run" keeps When and
Back up first.

### The quietest time

`sensor.system_quiet_time` on the System device: the start, `HH:MM` in the house's time zone, of
the quietest hour of a typical day, learned from the **house's activity** over the last 28 days
(`apps/core/src/persistence/activity-load.ts`, `domain/quietest.ts`). Core learns it at start and
just after midnight; it needs 3 days, and says 03:00 until then.

- **Activity**, one point each: a command from the page or the API, a scene applied, a light,
  switch, cover, lock, climate, media player, vacuum or mower changed by hand (no command behind
  it), a motion, occupancy, presence, door, opening, window or garage-door sensor turning on, an
  automation run that did something. Never: readings (`sensor`), images, the platform's own
  entities and containers, the changes an automation made (its run counts once).
- **Left out**: runs of the **quiet trigger** and the runs those started directly. A run started
  further down that chain is counted - the engine keeps chains in memory only. Automations with a
  time, sun or cron trigger do count.
- **Rule**: a quarter hour is quiet within 5% of the day's range above the quietest one; the
  longest stretch of quiet quarter hours, going round midnight, is the house asleep; the time is
  the 60-minute window centred in it. The time in use is kept while its window lies inside the
  stretch. A day without activity keeps 03:00. The entity's attributes carry the stretch
  (`quietFrom`, `quietTo`) and the profile.

Backups and updates in "Quietest" mode read it. Automations use it two ways:

- the **quiet trigger** (`{type: 'quiet', offsetMinutes?}`, "Quietest" under At in the editor):
  once a house day at the quietest time, before or after it, armed again when it moves; what such
  an automation does is left out of the learning;
- a time trigger whose time comes from an entity (`at: {kind: 'entity', entityId}`), which counts
  as activity like any other.

### Updating, and commands that wait

While a package or an integration is updated its entities keep their last value and say
**Updating** (the dashboard card's line, the state summary), and a command to one of them - from an
automation, a scene or the page - **waits** for the update to end instead of failing in the gap.

- The packet-manager announces a package's update around the stop and start of its process; `hub`
  announces an integration's from the swap of its bundle until every instance runs again
  (`nebula.v1.event.update`, `{sources, phase}`; sources are what core routes by: the package id,
  the integration's instance ids).
- Core (`services/updating-sources.ts`, `command-dispatch.ts`) waits at most `CORE_UPDATE_WAIT_MS`
  (120 s) and honours a cancelled run; after that the command fails as for an unreachable device.
  A source whose end never comes is let go after 10 minutes.
- An automation run waiting on a command waits with it, within its own timeout.

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
   like the old one (`apps/supervisor/src/domain/recreate.ts`), without the old `NEBULA_VERSION`.
   Before starting it, it checks that the new container says `NEBULA_VERSION=<new version>`; one
   still of the old version is an update that did not happen, and is undone like a failure.
4. It waits up to 5 minutes for Docker's health check to say healthy. On success it removes the
   old container and the copies. On failure it removes the new container, copies the volumes back,
   retags the old image and starts the old container again.
5. The outcome is written to `/data/updates/last.json` - with the updater's steps and, when the new
   version did not start, its last 50 log lines (`log`), and how long putting the old one back took
   (`restoredInMs`); the page shows a failed one. While it works the updater keeps a marker,
   `/data/updates/current.json` (`{fromVersion, toVersion, startedAt}`), which the outcome removes:
   the version that comes up reads it and says the update is being checked. When the updater
   cannot even read the platform's container, nothing is touched and it writes a `failed` outcome.
6. An updater that exits while the supervisor still runs gave up before stopping it (one of a new
   version that wants what this one does not pass it exits at once). The supervisor then writes a
   `failed` outcome unless the updater wrote one, stops refusing updates, and tells the pages the
   update is over, so the screen goes and Maintenance shows why. The round's row for Nebula Home
   says "Update started", never "Updated": a row still there means it did not restart.

Checked live on 2026-10-29 with a throwaway container: alpha.14 updated to alpha.15 by alpha.15's
updater came up as alpha.15 (image, `NEBULA_VERSION`, every service's `/healthz`). A house built
from source with `docker compose up --build` (`pnpm docker:up`) rebuilds `latest` and goes back
to the version in the working tree, whatever it was updated to.

Without the Docker socket, or outside the container (`pnpm dev`), Update is refused with the
reason.

### Restart and shut down

- **Restart**: `docker restart` of the platform's own container, done by the Docker daemon, so it
  completes even though the caller stops. Without the socket: s6's `halt`, and the
  `unless-stopped` policy starts the container again.
- **Shut down**: `docker stop` of its own container; it stays down until started again. Not
  possible without the socket (refused with the reason).

### What every page shows

A restart or an update of Nebula Home takes over **every signed-in page**, whoever started it
(boards N-Restart, N-Update, N-Update-Failed, N-Transition-Flow, N-Back-Online;
`apps/web-ui/src/components/platform-overlay.tsx`).

- **What the server says.** The supervisor keeps the operation under way and publishes it on
  `nebula.v1.event.platform` (`{operation}`, `platformOperationSchema`): a restart `stopping`
  before `docker restart`; an update `backingUp` while the round's backup runs (the packet-manager
  asks for it, `announce_platform_update`, before the backup and again with its size, and takes it
  back if the round never reaches Nebula Home), `downloading` with the pull's percentage and size
  (`PullProgressTracker`, at most once a second), then `installing` as the updater starts; null when
  it gave up. The percentage never goes back: Docker says a layer's size only once it starts
  downloading it, so a layer still waiting counts as one of average size. `api` forwards it as `platform_event` on the WebSocket topic `system`, to every socket
  without a permission. `GET /api/v1/system/platform` (any signed-in user) answers
  `{version, machine, operation, lastUpdate}` from the supervisor's `platform_state`; the page reads it
  each time the live channel connects, so one opened mid-way still shows the screen. The packet-manager
  passes the size of the backup the round took or reused (`backupBytes`).
- **What the page sees for itself** (`system/platform-store.ts`, `platform-progress.ts`): the server
  not answering (`/api/versions`, every 1.5 s, or the live channel dropping), answering again, then
  for an update the outcome in `lastUpdate` (success, or rolled back / failed) and for a restart the
  live channel back. The steps and their durations are those moments: restart - automations paused,
  state saved (server gone), services starting (server back), devices reconnecting (live channel);
  update - backing up / backed up (size), downloaded (size), installing, restarting the services,
  checking every service. The update's bar is 5 % while the backup runs, the download's share
  (10-60 %), then a step at a time.
- **The transition.** The page behind blurs, dims and shrinks (`.app-stage-back`), the mark
  appears in the middle out of a blur, turns slowly and its core breathes while the server is away. A
  restart's screen fades out and the page reads everything again; an update reloads the page (the
  interface is new) and says "Updated to X" for six seconds. Less motion (the preference or the
  system's) stops the animations.
- **Rolled back.** "The update didn't finish": the steps, the error, Download the log (the updater's
  log as a file), Try again (with `system:update`) and Back to Nebula.

### Permissions

`system:update` runs updates; `system:power` restarts and shuts down. Changing the update settings
is `settings:write`.

## 5. Decisions still open

For packages and integrations:

- **How betas and dev builds reach a house.** The Hub imports prereleases but leaves them out of
  the indexes (`listIndexableVersions`, `NOT v.is_prerelease`). Either each version in the index
  carries its channel (from the `-beta`/`-alpha` suffix), or the Hub serves an index per channel.
  The packet-manager would then take `-beta` on the beta channel and `-alpha` too on the dev
  channel. Until then the two channel options stay disabled.
- **Import validation.** Whether the Hub refuses a GitHub prerelease without a `-beta`/`-alpha`
  suffix (or a suffixed version not marked prerelease), so the flag and the version always agree.
- **Release script for `pkg-*` and `integration-*` repositories.** Reuse `scripts/release.ts` or one
  per repository; they stay **SemVer** (`1.5.0`, `-beta.K`, `-alpha.K`), never CalVer.
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
- "Updating" reaches the page over the live channel only: a page opened during an update shows the
  entity as usual until the next change.
- A page loaded while the platform's container is down cannot load at all (the proxy is in the same
  container); it shows the screen once the server answers and the update is being checked.
- Shutting down has no screen of its own: only the page that asked says so; other pages lose the
  server.
- The restart's first duration (automations paused) compares the server's clock with the page's; it
  is left out when they disagree.
- The quiet trigger's once-a-day guard lives in the engine's memory: a core restart after it fired
  can fire it again the same day if the quietest time is still ahead.
- A command sent on the bus without a cause looks like a change by hand and counts as activity.
- The updater does not check free disk space before copying the volumes.
- Settings, seeds and grants were added to `0001_initial_schema.sql`: the dev and container
  databases need `db:reset`.
