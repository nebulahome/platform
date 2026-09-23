# infra

Everything needed to run NebulaHome that is not application code.

| Path                     | What it is                                                  | Versioned |
| ------------------------ | ----------------------------------------------------------- | --------- |
| `docker-compose.dev.yml` | PostgreSQL and NATS for local development                   | yes       |
| `seed/dev.sql`           | Fake devices and history so the UI has something to render  | yes       |
| `certs/`                 | Locally generated TLS material for the proxy                | no        |
| `data/`                  | Runtime state: package artefacts, map tiles, NVR recordings | no        |

`certs/` and `data/` are git-ignored: they are machine-local runtime state, and `certs/`
would otherwise put private keys in the repository.

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
