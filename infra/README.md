# infra

Everything needed to run NebulaHome that is not application code.

| Path                     | What it is                                                      | Versioned |
| ------------------------ | --------------------------------------------------------------- | --------- |
| `docker-compose.dev.yml` | PostgreSQL, NATS and Mosquitto for local development            | yes       |
| `seed/dev.sql`           | Fake devices and history so the UI has something to render      | yes       |
| `data/`                  | The data directory in development: every file the services keep | no        |

`data/` is git-ignored: it is machine-local runtime state, and it will hold private keys - the
proxy's certificates, the instance keys - that must never reach the repository.

## The data directory

Every file a service keeps - everything but the database - lives under one directory,
`NEBULA_DATA_DIR`. Unset, it is this `infra/data`; in a container it is the one volume mounted
at `/data`. Its layout is defined in `@nebula-home/config` (`data-layout.ts`) and described in
ARCHITECTURE.md §14:

```
data/
├── hub/integrations/<vendor>/   integration bundles installed into the hub
├── proxy/tls/                   the proxy's certificates and ACME account key   (not yet)
├── packages/<id>/               one per installed feature package              (not yet)
├── secrets/                     the instance keys, when not in the environment  (not yet)
├── cache/                       what can be fetched again; never backed up
│   └── maps/<z>/<x>/<y>.png     the map around the house
└── backups/                     what the backups write; never backed up itself (not yet)
```

Deleting `cache/` is always safe. The bundles in `apps/hub/bundles` are not here: they are the
integrations under development, which the hub reads beside `hub/integrations` outside
production until the integrations catalogue exists.

## Usage

```bash
docker compose -f infra/docker-compose.dev.yml up -d
pnpm db:migrate                                          # once, and after every new migration
docker compose -f infra/docker-compose.dev.yml down      # stop, keep data
docker compose -f infra/docker-compose.dev.yml down -v   # stop and wipe the database
```

The containers give you an empty PostgreSQL. Nothing in it exists until `pnpm db:migrate` has
run - not the tables, not the roles, not the view every service reads at startup to check it is
talking to the schema it was built for. A service started before that refuses with
``run `pnpm db:migrate` and start again`` and exits with code 79; that is the check working, not
the service broken. `down -v` puts you back to this state, so it needs the migrate step again.

## Secrets

`api` and `hub` both read `NEBULA_SECRETS_KEY` from `.env`: what an owner types into an
integration's password field is sealed with it before it is stored, and opened with it when the
instance connects. The two services must hold the **same** key, and a second machine working on
the same database needs a copy of it - a value sealed on one PC cannot be opened on another
without it. Generate it once:

```bash
openssl rand -hex 32
```
