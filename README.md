# NebulaHome Platform

Monorepo for the NebulaHome smart home platform: the essential services, the shared packages
they are built from, and the web interface.

Installable packages (protocol adapters, feature packages) live in their own repositories under
the same organisation.

## Layout

| Path                       | What it is                                              |
| -------------------------- | ------------------------------------------------------- |
| `apps/core`                | Entity registry, automation, scene and alias engines    |
| `apps/hub`                 | Every protocol: transports, integrations, bundles       |
| `apps/api`                 | REST and WebSocket gateway                              |
| `apps/proxy`               | TLS termination, static serving, routing                |
| `apps/packet-manager`      | npm-based package installer and lifecycle supervisor    |
| `apps/logger`              | Log ingestion, storage and query                        |
| `apps/web-ui`              | React single-page application                           |
| `packages/contracts`       | Zod schemas and derived types shared by everything      |
| `packages/bus`             | Typed NATS client                                       |
| `packages/db`              | Drizzle schema, migrations, repositories                |
| `packages/config`          | Zod-validated environment loader, data directory layout |
| `packages/logging`         | Shared pino factory                                     |
| `packages/package-runtime` | Integration contract: transports, bundles, profiles     |
| `packages/ui`              | Design system: Tailwind and shadcn/ui components        |
| `infra/`                   | docker-compose, seeds, the development data directory   |

## Requirements

- Node.js 22 LTS
- pnpm 11
- Docker, for PostgreSQL and NATS in development

## Getting started

```bash
pnpm install
cp .env.example .env
docker compose -f infra/docker-compose.dev.yml up -d   # postgres + nats
pnpm db:migrate
pnpm dev
```

## Everyday commands

| Command                 | What it does                                     |
| ----------------------- | ------------------------------------------------ |
| `pnpm dev`              | Every service in watch mode                      |
| `pnpm build`            | Build all workspaces                             |
| `pnpm typecheck`        | Type check without emitting                      |
| `pnpm lint`             | ESLint across the monorepo                       |
| `pnpm test`             | Unit tests                                       |
| `pnpm test:integration` | Integration tests against real Postgres and NATS |
| `pnpm format`           | Prettier write                                   |

## Conventions

Architecture, coding rules and the database schema are documented outside this repository.
In short: everything is written in English, every function carries a TSDoc block, every file is
named in kebab-case, and commits follow Conventional Commits. `main` and `dev` are protected —
open a pull request against `dev`.
