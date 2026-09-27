# infra

Everything needed to run NebulaHome that is not application code.

| Path                 | What it is                                                                  | Versioned |
| -------------------- | --------------------------------------------------------------------------- | --------- |
| `docker-compose.yml` | Everything Docker runs: the platform's container, and the development stack | yes       |
| `.env.example`       | Its settings - the network, the ports, the keys - to copy to `.env`         | yes       |
| `docker/`            | What the image runs: the s6 services and the scripts they start with        | yes       |
| `seed/dev.sql`       | Fake devices and history so the UI has something to render                  | yes       |
| `data/`              | The data directory in development: every file the services keep             | no        |

`data/` and `.env` are git-ignored: they are machine-local, and they hold private keys - the
proxy's certificates, the instance keys - that must never reach the repository.

**One compose file, one project** (`nebulahome`), with two ways to use it:

| Command          | Starts                                          | For                                         |
| ---------------- | ----------------------------------------------- | ------------------------------------------- |
| `pnpm docker:up` | `nebulahome`: the whole platform, one container | Running NebulaHome as it is installed       |
| `pnpm infra:up`  | `postgres`, `nats`, `mosquitto`                 | `pnpm dev`, the services run on the machine |

The two do not share anything - each has its own database - and can run side by side.

## The container

NebulaHome runs as **one container**: PostgreSQL 16 with TimescaleDB, NATS with JetStream, and
`core`, `hub`, `api`, `backup` and `proxy`, supervised by s6-overlay (ARCHITECTURE.md §14). It is
built from `../Dockerfile` and runs on Linux only; there is no Windows build of the runtime.

```bash
pnpm docker:up          # build the image and start it; waits until it is healthy
pnpm docker:logs        # follow every service's log
pnpm docker:ps          # is it running, is it healthy
pnpm docker:restart     # restart the container
pnpm docker:down        # stop it; the volumes stay
```

The page is on http://localhost:8080, and https://localhost:8443 with a self-signed
certificate. On first start there is no account: the page opens on the first-run screen that
creates the owner.

| Command                | What it does                                                                      |
| ---------------------- | --------------------------------------------------------------------------------- |
| `pnpm docker:build`    | Builds the image `nebulahome:local` without starting it                           |
| `pnpm docker:up`       | Builds and starts, and waits for the health check                                 |
| `pnpm docker:down`     | Stops and removes the container. The data, the database and the keys stay         |
| `pnpm docker:restart`  | Restarts it                                                                       |
| `pnpm docker:logs`     | Follows the logs                                                                  |
| `pnpm docker:ps`       | Shows its state and health                                                        |
| `pnpm docker:shell`    | A shell inside it                                                                 |
| `pnpm docker:psql`     | `psql` on its database, as the superuser                                          |
| `pnpm docker:db:reset` | Empties the database and migrates it again, the services stopped around it        |
| `pnpm docker:wipe`     | **Deletes every volume**: the database, the data directory, the keys, the backups |

`docker:db:reset` deletes the owner account with everything else: create it again from the
first-run screen. The data directory - the integrations, the keys, the backups - is kept.
`docker:wipe` keeps nothing: without the backup key, the archives written before it cannot be
opened, so download the key first (Settings → Backup).

### What it starts

In order, each once the one before is ready:

1. `init-dirs` - the data directory's folders, owned by the `nebula` user the services run as.
2. `init-secrets` - every secret that is missing, generated once into `/data/secrets/` (0600):
   the instance keys `NEBULA_SECRETS_KEY` and `API_TOTP_ENCRYPTION_KEY`, `API_JWT_SECRET`, the
   PostgreSQL and NATS passwords, one password per service role, and the proxy's self-signed
   certificate. A variable set in `infra/.env` wins over its file.
3. `postgres` - on `127.0.0.1:5433`, passwords required over TCP.
4. `init-db` - migrates the database and gives each service role its password. An upgrade is
   "build, start": the new migrations apply here.
5. `nats` - on `127.0.0.1:4223`, with a password; its monitor on `8223`.
6. `core`, `hub`, `api` (`127.0.0.1:4100`), `backup`, `proxy` (`8080`, `8443`). Each connects to
   the database as its own role (DATABASE.md §12); `backup` runs as root, for the mounts.

The ports are not the usual ones on purpose: on the host's network the container shares the
machine's ports, and must not collide with the development stack.

A service that exits with code 78 (bad configuration), 79 (schema mismatch) or 80 (bus version)
is not restarted: the container stops with that code, since starting again would fail the same
way. `docker:logs` says why.

### Volumes

| Volume            | Mounted at                 | Holds                                                          |
| ----------------- | -------------------------- | -------------------------------------------------------------- |
| `nebula-data`     | `/data`                    | The data directory: integrations, keys, backups, cache         |
| `nebula-postgres` | `/var/lib/postgresql/data` | The database                                                   |
| `nebula-nats`     | `/var/lib/nats`            | The bus's streams: events waiting for a consumer, nothing else |

### The network

By default the container is on a **bridge network** with the page's ports published. That works
everywhere, Docker Desktop included, and needs nothing set.

A bridge does not carry multicast, and multicast is how devices are found: the hub asks the mDNS
group `224.0.0.251`, Govee lights answer a scan sent to `239.255.255.250`, Bambu Lab printers and
Shelly Gen1 devices announce themselves to their groups. Publishing a port forwards what is sent
to one address, never a group. So on the bridge **discovery is off** and devices are added by
their address, which works: the hub reaches them as any client would. Two things are slower or
missing there - a Shelly Gen1's pushed changes (it is read on its timer instead) and a Govee
light's replies, which the light sends to port 4002 of the asker.

On a **Linux server**, put the container on the host's network in `infra/.env`:

```bash
NEBULA_NETWORK=host
HUB_DISCOVERY_ENABLED=true
```

There it is on the machine's own network: discovery works, and nothing needs publishing - the
page is on the machine's ports 8080 and 8443.

**Docker Desktop** (Windows, macOS) is different: its "host" network is its own virtual
machine's, which reaches no device on the LAN, and its page is not even reachable from Windows.
Keep the bridge there. Checked on 2026-09-27 with the same mDNS question from three places: the
Windows machine heard the Shelly devices answer, the container on the bridge and the one on
Docker Desktop's host network heard nothing but themselves.

### Backups to a disk or a share

Backups always land in the container's `/data/backups` (the system location, which can be
turned off). For more:

- **A disk of the host:** uncomment the bind mount in `docker-compose.yml`
  (`- /mnt/backups:/mnt/backups`), start again, and add a **local folder** location, choosing
  the folder with Browse.
- **An SMB share or an NFS export:** add it as a location; the backup service mounts it for each
  run. That is why the container has `SYS_ADMIN` and `DAC_READ_SEARCH` and no AppArmor profile.
  Without them, mount the share on the host and use it as a disk, above.
- **FTP or FTPS:** add it as a location; nothing to mount.

### Settings

Copy `.env.example` to `.env`, here in `infra/`, and uncomment what you change: the network,
the ports, the time zone, the log level. Everything has a default; the file is optional. Compose
reads it twice: to fill in `docker-compose.yml`, and as the container's environment.

To bring an existing installation's keys into a new container, set `NEBULA_SECRETS_KEY` and
`API_TOTP_ENCRYPTION_KEY` there - or restore a backup, which carries them.

## The data directory

Every file a service keeps - everything but the database - lives under one directory,
`NEBULA_DATA_DIR`. Unset, it is this `infra/data`; in the container it is the volume mounted at
`/data`. Its layout is defined in `@nebula-home/config` (`data-layout.ts`) and described in
ARCHITECTURE.md §14:

```
data/
├── hub/integrations/<vendor>/   integration bundles installed into the hub
├── proxy/tls/                   the proxy's certificates
├── packages/<id>/               one per installed feature package              (not yet)
├── secrets/                     the instance keys and the backup key
├── cache/                       what can be fetched again; never backed up
│   └── maps/<z>/<x>/<y>.png     the map around the house
└── backups/                     the archives of the system location; never backed up itself
    └── .staging/                a backup or a restore in progress
```

Deleting `cache/` is always safe. The bundles in `apps/hub/bundles` are not here: they are the
integrations under development, which the hub reads beside `hub/integrations` until the
integrations catalogue exists - the image carries them too.

## Development

The services run on the machine with `pnpm dev`; only the database, the bus and the MQTT
broker are containers - the `postgres`, `nats` and `mosquitto` services of the same compose file,
started by name:

```bash
pnpm infra:up           # PostgreSQL, NATS and Mosquitto; waits until they are healthy
pnpm db:migrate         # once, and after every new migration
pnpm infra:logs         # follow their logs
pnpm infra:down         # stop them, keep the data
pnpm db:reset           # empty the database and migrate it again
pnpm db:psql            # psql on it
```

Why not the platform's container: natively, a change reloads in a second instead of an image
build, a debugger attaches, and the hub is on the LAN - on Windows, the only way it can find
devices (above).

The containers give you an empty PostgreSQL. Nothing in it exists until `pnpm db:migrate` has
run - not the tables, not the roles, not the view every service reads at startup to check it is
talking to the schema it was built for. A service started before that refuses with
``run `pnpm db:migrate` and start again`` and exits with code 79; that is the check working, not
the service broken. `db:reset` does the migrate step itself. It deletes the owner account with
everything else: create it again from the first-run screen.

The backup service starts with the others, but takes and restores backups only in the
container: it needs `pg_dump` 16, `mount`, s6 and Linux. Try backups there.

## Secrets

`api` and `hub` both read `NEBULA_SECRETS_KEY` from `.env`: what an owner types into an
integration's password field is sealed with it before it is stored, and opened with it when the
instance connects. The two services must hold the **same** key, and a second machine working on
the same database needs a copy of it - a value sealed on one PC cannot be opened on another
without it. Generate it once:

```bash
openssl rand -hex 32
```

The container generates its own (above), and never needs this.
