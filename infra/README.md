# infra

Everything needed to run NebulaHome that is not application code.

| Path                 | What it is                                                                  | Versioned |
| -------------------- | --------------------------------------------------------------------------- | --------- |
| `docker-compose.yml` | Everything Docker runs: the platform's container, and the development stack | yes       |
| `production/`        | What to copy to a machine of its own: the published image, no build         | yes       |
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
| `pnpm infra:up`  | `postgres`, `nats`                              | `pnpm dev`, the services run on the machine |

The two do not share anything - each has its own database - and can run side by side.

## The container

NebulaHome runs as **one container**: PostgreSQL 16 with TimescaleDB, NATS with JetStream, and
`core`, `hub`, `api`, `backup`, `supervisor`, `proxy` and `packet-manager` - which installs and runs
the packages, the house's MQTT broker among them - supervised by s6-overlay
(ARCHITECTURE.md §14). It is built from `../Dockerfile` and runs on Linux only; there is no Windows
build of the runtime. Beside it run the containers an integration needs - zigbee2mqtt for Zigbee -
which the platform downloads and runs itself through Docker's socket (below).

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
| `pnpm docker:build`    | Builds the image `nebulahome/platform:latest` without starting it                 |
| `pnpm docker:push`     | Builds it and pushes it to Docker Hub, `nebulahome/platform`                      |
| `pnpm docker:up`       | Builds and starts, and waits for the health check                                 |
| `pnpm docker:down`     | Stops and removes the container. The data, the database and the keys stay         |
| `pnpm docker:restart`  | Restarts it                                                                       |
| `pnpm docker:logs`     | Follows the logs                                                                  |
| `pnpm docker:ps`       | Shows its state and health                                                        |
| `pnpm docker:shell`    | A shell inside it                                                                 |
| `pnpm docker:psql`     | `psql` on its database, as the superuser                                          |
| `pnpm docker:db:reset` | Empties the database and migrates it again, the services stopped around it        |
| `pnpm docker:wipe`     | **Deletes every volume**: the database, the data directory, the keys, the backups |

`docker:push` needs `docker login` first, as an account that can push to the `nebulahome`
organisation. It pushes the architecture of the machine that builds it.

`docker:db:reset` deletes the owner account with everything else: create it again from the
first-run screen. The data directory - the integrations, the keys, the backups - is kept.
`docker:wipe` keeps nothing: without the backup key, the archives written before it cannot be
opened, so download the key first (Settings → Backup).

### What it starts

In order, each once the one before is ready:

1. `init-dirs` - the data directory's folders, owned by who writes them: root keeps the
   directory itself, `secrets/`, `backups/`, `containers/` and `cache/`; the `nebula` user the
   services run as gets the rest, and makes the folders inside its own. So root never writes
   into a folder it does not own, which a host that gives the container no `CAP_DAC_OVERRIDE`
   forbids it - NATS's configuration is written the same way.
2. `init-secrets` - every secret that is missing, generated once into `/data/secrets/` (0600):
   the instance keys `NEBULA_SECRETS_KEY` and `API_TOTP_ENCRYPTION_KEY`, `API_JWT_SECRET`, the
   PostgreSQL and NATS passwords, one password per service role, and the proxy's
   self-signed certificate. A variable set in `infra/.env` wins over its file.
3. `postgres` - on `127.0.0.1:5433`, passwords required over TCP.
4. `init-db` - migrates the database and gives each service role its password. An upgrade is
   "build, start": the new migrations apply here.
5. `nats` - on `127.0.0.1:4223`, with a password; its monitor on `8223`.
6. `core`, `hub`, `api` (`127.0.0.1:4100`), `backup`, `supervisor`, `proxy` (`8080`, `8443`),
   `packet-manager`. Each connects to the database as its own role (DATABASE.md §12); `backup`
   runs as root, for the mounts, and `supervisor` as root, the one process given Docker's socket.
7. The packages, run by `packet-manager`. The house's MQTT broker is the hub's own: it listens on
   `1883` of every address of the container (`HUB_MQTT_PORT`): devices on the network connect to
   it with a username added on Brokers → MQTT, the containers an integration runs reach it as
   `nebulahome:1883` with one of their own, and the hub on loopback with its own. For now the image carries what the local folders,
   `infra/local-packages` and `infra/local-integrations`, held when it was built, at
   `/app/local-packages` and `/app/local-integrations`; under `pnpm docker:up` the folders are also
   mounted over those paths, read-only, and read live.

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

On a machine of its own, `production/` is the compose file to copy: the published image, the
platform on the host's network with discovery on, and an override for a bridge of its own -
`nebulahome-net`, declared there and handed to the supervisor, so the containers integrations run
join it and reach the broker by the platform's name - for Docker Desktop
([production/README.md](production/README.md)).

**Docker Desktop** (Windows, macOS) is different: its "host" network is its own virtual
machine's, which reaches no device on the LAN, and its page is not even reachable from Windows.
Keep the bridge there. Checked on 2026-09-27 with the same mDNS question from three places: the
Windows machine heard the Shelly devices answer, the container on the bridge and the one on
Docker Desktop's host network heard nothing but themselves.

### Docker's socket and the containers integrations run

The compose file gives the container `/var/run/docker.sock`. Only the `supervisor` holds it: the
**Containers** page shows every container of the machine as a card - one per compose project,
opening the project's page, one per container started on its own - with its processor and memory,
its image and whether a newer one is out, its environment (secrets withheld), networks, ports and
mounts, and its logs. The platform's own containers - every service of this compose file, which
carries the label `io.nebulahome.platform`, and anything else of the platform's compose project -
are the **system**: shown and measured, never stopped, updated or removed from here, and no device.
Each of the others is also a device with entities. The socket is root on the machine: remove the
line to keep Docker out of reach, and the page says Docker cannot be seen.

The owner adds containers from the same page: **Install container** looks an image up on Docker
Hub and runs it with the ports, environment and folders the form says (a folder kept "in
NebulaHome's data" lives under `/data/containers/installed/<name>/`, so the backups take it, and
the install itself is recorded beside it so a restore makes the container again; a Docker volume
or a folder of the machine is not backed up), and
**New compose** takes a compose file, written in the page or uploaded. The image carries the
Docker command line and its compose plugin for that: the supervisor keeps the file in
`/data/containers/compose/<project>/`, checks it with `docker compose config`, points the
project's own folders (`./data`) at the same folder of the data volume the way Docker on the host
sees it, and brings it up with `docker compose up -d`. A project deployed from here is changed,
started and stopped whole, updated and removed from its page; `build:` is refused - only images
from a registry run here.

An integration may declare a container of its own - zigbee2mqtt does. Once the integration is set
up, the supervisor pulls its image (the newest release of the major the bundle accepts), creates
`nebulahome-<vendor>` with `restart: unless-stopped`, and puts it and the platform on a bridge
network of their own, `nebulahome`, where the platform answers to `nebulahome` - on the host
network it runs on the host network too. Its data lives in the platform's own volume, under
`/data/containers/<id>/`, mounted into it as a volume subpath (Docker 26 or newer), so the backups
take it; the restore stops it and starts it again. Such a container is the integration's: the
page shows it, and nobody starts, stops or updates it by hand.

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
`/data`. Its layout is defined in `@nebulahome/config` (`data-layout.ts`) and described in
ARCHITECTURE.md §14:

```
data/
├── hub/integrations/<vendor>/   integration bundles installed into the hub
├── proxy/tls/                   the proxy's certificates
├── packages/<id>/               one per installed feature package              (not yet)
├── containers/<id>/<volume>/    the data of the containers integrations run: zigbee2mqtt's
├── secrets/                     the instance keys and the backup key
├── cache/                       what can be fetched again; never backed up
│   ├── maps/<z>/<x>/<y>.png     the map around the house
│   └── containers/<id>/<volume>/ what those containers keep that can be made again
└── backups/                     the archives of the system location; never backed up itself
    └── .staging/                a backup or a restore in progress
```

Deleting `cache/` is always safe. An integration installed from the interface lands in
`hub/integrations/<vendor>/<version>-<nonce>/`, the build `.nebula-install.json` names running.
An integration under development is not here either: its repository's `dist/`, named in
`HUB_DEV_BUNDLE_DIR`, is read beside `hub/integrations`. The image carries no integration; the
archives in `infra/local-integrations` are offered to install.

**The Community Hub.** `COMMUNITY_HUB_URL` names it (`cloud-backend`, `http://localhost:8088` when
its stack runs on this machine); unset, the install dialogs offer the local folders and nothing
else. `packet-manager` reports to it what it installs from its indexes, with one token for the
whole installation kept in `system.community_hub_installations`;
`COMMUNITY_HUB_REPORT_INSTALLS=false` turns that off.

## Development

The services run on the machine with `pnpm dev`; only the database and the bus are containers -
the `postgres` and `nats` services of the same compose file, started by name. The MQTT broker is
the hub's own, on this machine's `1883` (`HUB_MQTT_PORT`), its files in `hub/mqtt` of the data
directory:

```bash
pnpm infra:up           # PostgreSQL and NATS; waits until they are healthy
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

The supervisor too runs with the others. On Windows, point it at Docker Desktop's named pipe in
`.env` - `SUPERVISOR_DOCKER_SOCKET=//./pipe/docker_engine` - and the Containers page lists the
development stack's containers. The broker `pnpm dev` uses is the hub's own on `localhost:1883`:
the hub uses its own username and the supervisor asks it for its containers', so `.env` sets no
`NEBULA_MQTT_URL` - one set there is an external broker the integrations and containers use
instead. The integration tests run
a broker of their own in the test process (`apps/hub/tests/support/broker.ts`).

**Development and the container on one Docker.** Both have a supervisor, and both would run
`nebulahome-zigbee2mqtt` - each pointing it at its own broker. So every container an integration
runs is labelled with the installation that made it (`io.nebulahome.installation`): the container
generates its id once (`secrets/installation-id`), development keeps `NEBULA_INSTALLATION_ID` of
`.env` (`development`), and a supervisor leaves a container the other made alone, saying so on
the vendor's page. Stop one, or remove its container, to run the integration from the other. A
container edited by hand is made again at the supervisor's next look: its environment is the
integration's, and the Configure dialog is where it changes.

## Secrets

`api`, `hub` and `core` read `NEBULA_SECRETS_KEY` from `.env`: what an owner types into an
integration's password field is sealed with it before it is stored, and opened with it when the
instance connects; an HTTP request action's Authorization header is sealed by `api` and opened by
`core` when it sends it. The services must hold the **same** key, and a second machine working on
the same database needs a copy of it - a value sealed on one PC cannot be opened on another
without it. Generate it once:

```bash
openssl rand -hex 32
```

The container generates its own (above), and never needs this.
