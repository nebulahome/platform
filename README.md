# NebulaHome Platform

Monorepo for the NebulaHome smart home platform: the essential services, the shared packages
they are built from, and the web interface.

Installable packages (protocol adapters, feature packages) live in their own repositories under
the same organisation.

## Layout

| Path                       | What it is                                               |
| -------------------------- | -------------------------------------------------------- |
| `apps/core`                | Entity registry, automation, scene and alias engines     |
| `apps/hub`                 | Every protocol: transports, integrations, bundles        |
| `apps/api`                 | REST and WebSocket gateway                               |
| `apps/proxy`               | TLS termination, static serving, routing                 |
| `apps/packet-manager`      | npm-based package installer and lifecycle supervisor     |
| `apps/logger`              | Log ingestion, storage and query                         |
| `apps/backup`              | Scheduled encrypted backups, locations, restore          |
| `apps/web-ui`              | React single-page application                            |
| `packages/contracts`       | Zod schemas and derived types shared by everything       |
| `packages/bus`             | Typed NATS client                                        |
| `packages/db`              | Drizzle schema, migrations, repositories                 |
| `packages/config`          | Zod-validated environment loader, data directory layout  |
| `packages/logging`         | Shared pino factory                                      |
| `packages/package-runtime` | Integration contract: transports, bundles, profiles      |
| `packages/ui`              | Design system: Tailwind and shadcn/ui components         |
| `infra/`                   | The container, docker-compose, seeds, the data directory |
| `Dockerfile`               | The one image: database, bus and every service           |

## Requirements

- Node.js 22 LTS
- pnpm 11
- Docker, for PostgreSQL and NATS in development, and for running the whole platform

## Getting started

```bash
pnpm install
cp .env.example .env
pnpm infra:up        # postgres + nats
pnpm db:migrate
pnpm dev
```

To run NebulaHome as it is installed - one container with the database, the bus and every
service - `pnpm docker:up`, then http://localhost:8080 (`pnpm docker:up:local` on Docker
Desktop). See [infra/README.md](infra/README.md).

## Everyday commands

| Command                 | What it does                                         |
| ----------------------- | ---------------------------------------------------- |
| `pnpm dev`              | Every service in watch mode                          |
| `pnpm build`            | Build all workspaces                                 |
| `pnpm typecheck`        | Type check without emitting                          |
| `pnpm lint`             | ESLint across the monorepo                           |
| `pnpm test`             | Unit tests                                           |
| `pnpm test:integration` | Integration tests against real Postgres and NATS     |
| `pnpm format`           | Prettier write                                       |
| `pnpm infra:up`         | Start the development database and bus               |
| `pnpm infra:down`       | Stop them, keep the data                             |
| `pnpm db:reset`         | Wipe the development database and migrate again      |
| `pnpm db:psql`          | `psql` on the development database                   |
| `pnpm docker:up`        | Build and start the whole platform in one container  |
| `pnpm docker:logs`      | Follow the container's logs                          |
| `pnpm docker:db:reset`  | Empty the container's database                       |
| `pnpm docker:wipe`      | Delete the container's volumes: database, data, keys |

## Conventions

Architecture, coding rules and the database schema are documented outside this repository.
In short: everything is written in English, every function carries a TSDoc block, every file is
named in kebab-case, and commits follow Conventional Commits. `main` and `dev` are protected —
open a pull request against `dev`.
