# infra

Everything needed to run NebulaHome that is not application code.

| Path                     | What it is                                                 | Versioned |
| ------------------------ | ---------------------------------------------------------- | --------- |
| `docker-compose.dev.yml` | PostgreSQL and NATS for local development                  | yes       |
| `seed/dev.sql`           | Fake devices and history so the UI has something to render | yes       |
| `certs/`                 | Locally generated TLS material for the proxy               | no        |
| `data/`                  | Runtime state: package artefacts, NVR recordings           | no        |

`certs/` and `data/` are git-ignored: they are machine-local runtime state, and `certs/`
would otherwise put private keys in the repository.

## Usage

```bash
docker compose -f infra/docker-compose.dev.yml up -d
docker compose -f infra/docker-compose.dev.yml down      # stop, keep data
docker compose -f infra/docker-compose.dev.yml down -v   # stop and wipe the database
```
