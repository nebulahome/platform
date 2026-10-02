# syntax=docker/dockerfile:1.7
#
# NebulaHome in one image: PostgreSQL with TimescaleDB, NATS and every platform service,
# supervised by s6-overlay. See ARCHITECTURE.md 14 (Production) and infra/README.md.
#
#   docker compose -f infra/docker-compose.yml up -d --build     (pnpm docker:up)
#
# Three stages: `build` compiles the workspace and prunes it to what runs; `test` is `build` with
# the PostgreSQL client, for the integration tests that need pg_dump; `runtime` is the
# TimescaleDB image with Node, NATS and s6 added, and the pruned workspace in /app.

ARG NODE_IMAGE=node:22-alpine3.23
ARG TIMESCALE_IMAGE=timescale/timescaledb:2.29.2-pg16
ARG NATS_IMAGE=nats:2.14.6-alpine

FROM ${NODE_IMAGE} AS node
FROM ${NATS_IMAGE} AS nats

# ---------------------------------------------------------------------------------------------
# build: install, compile, prune
# ---------------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build

ENV HUSKY=0 \
    CI=true \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN corepack enable && corepack prepare pnpm@11.20.0 --activate

WORKDIR /src

# The lockfile alone first: the package store is fetched once and cached until it changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch

COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline && \
    pnpm build

# The tree that runs: the same layout, installed afresh with production dependencies only - the
# web-ui's are left out, it is served as built files - and each package's built output with the
# files it reads at runtime: the migrations, the icon catalogue, the bundles, and the packages the
# platform ships (`pkgs/`) with their manifests and built interfaces, which packet-manager runs.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    mkdir -p /app && \
    cp package.json pnpm-lock.yaml pnpm-workspace.yaml /app/ && \
    for dir in apps/* packages/* pkgs/*; do \
      [ -f "$dir/package.json" ] || continue; \
      mkdir -p "/app/$dir" && cp "$dir/package.json" "/app/$dir/"; \
    done && \
    cd /app && \
    pnpm install --frozen-lockfile --offline --prod --ignore-scripts \
      --filter '!@nebula-home/web-ui' --filter '!@nebula-home/ui' && \
    cd /src && \
    for dir in apps/* packages/* pkgs/*; do \
      if [ -d "$dir/dist" ]; then cp -a "$dir/dist" "/app/$dir/"; fi; \
    done && \
    for dir in pkgs/*; do \
      [ -f "$dir/nebula.package.json" ] || continue; \
      tar -C "$dir" --exclude=./node_modules --exclude=./src --exclude=./dist -cf - . | \
        tar -C "/app/$dir" -xf -; \
    done && \
    cp -a packages/db/migrations /app/packages/db/ && \
    cp packages/icons/catalogue.json /app/packages/icons/ && \
    cp -a apps/hub/bundles /app/apps/hub/ && \
    rm -rf /app/packages/ui /app/pnpm-lock.yaml

# ---------------------------------------------------------------------------------------------
# test: the build with the PostgreSQL client, for the backup's integration tests
# ---------------------------------------------------------------------------------------------
FROM build AS test

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    apk add --no-cache postgresql16-client && \
    pnpm install --frozen-lockfile --offline

# ---------------------------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------------------------
FROM ${TIMESCALE_IMAGE} AS runtime

ARG S6_OVERLAY_VERSION=3.2.1.0
ARG TARGETARCH

# Node from the official image built on the same Alpine: this Alpine's own package is Node 24,
# and the platform is written for 22.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=nats /usr/local/bin/nats-server /usr/local/bin/nats-server

# libstdc++ for Node; cifs-utils and nfs-utils for the backup's network locations; openssl for
# the generated keys and certificate; tzdata so a TZ is honoured; the Docker command line and its
# compose plugin, which the supervisor runs the owner's compose projects with. The house's MQTT
# broker is not here: it is the `mqtt` package, which /app/pkgs holds once it is back from
# parked/pkg-mqtt.
RUN apk add --no-cache libstdc++ libgcc cifs-utils nfs-utils openssl tzdata xz \
    docker-cli docker-cli-compose

RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) s6arch=x86_64 ;; \
      arm64) s6arch=aarch64 ;; \
      *) echo "unsupported architecture ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    base="https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}"; \
    for part in noarch "${s6arch}"; do \
      wget -qO "/tmp/s6-${part}.tar.xz" "${base}/s6-overlay-${part}.tar.xz"; \
      wget -qO "/tmp/s6-${part}.tar.xz.sha256" "${base}/s6-overlay-${part}.tar.xz.sha256"; \
      (cd /tmp && sed "s| .*| /tmp/s6-${part}.tar.xz|" "/tmp/s6-${part}.tar.xz.sha256" | sha256sum -c -); \
      tar -C / -Jxpf "/tmp/s6-${part}.tar.xz"; \
      rm "/tmp/s6-${part}.tar.xz" "/tmp/s6-${part}.tar.xz.sha256"; \
    done

# The account the Node services run as. The backup service runs as root: it mounts shares.
RUN addgroup -S -g 1000 nebula && adduser -S -D -H -u 1000 -G nebula nebula

COPY --from=build /app /app
COPY infra/docker/s6-rc.d /etc/s6-overlay/s6-rc.d
COPY infra/docker/scripts /etc/s6-overlay/scripts
COPY infra/docker/bin /usr/local/bin

RUN chmod +x /etc/s6-overlay/scripts/* /usr/local/bin/nebula-* \
             /etc/s6-overlay/s6-rc.d/*/run /etc/s6-overlay/s6-rc.d/*/finish 2>/dev/null || true; \
    node --version

ENV PATH=/command:$PATH \
    NODE_ENV=production \
    LOG_LEVEL=info \
    NEBULA_DATA_DIR=/data \
    HUB_DEV_BUNDLE_DIR=/app/apps/hub/bundles \
    PGDATA=/var/lib/postgresql/data \
    NEBULA_PG_PORT=5433 \
    PGPORT=5433 \
    NEBULA_NATS_PORT=4223 \
    NEBULA_NATS_MONITOR_PORT=8223 \
    API_PORT=4100 \
    PROXY_HTTP_PORT=8080 \
    PROXY_HTTPS_PORT=8443 \
    PROXY_TLS_MODE=self-signed \
    S6_BEHAVIOUR_IF_STAGE2_FAILS=2 \
    S6_KILL_GRACETIME=20000 \
    S6_SERVICES_GRACETIME=15000 \
    S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0

VOLUME ["/data", "/var/lib/postgresql/data", "/var/lib/nats"]
# The page, and the house's MQTT broker (the `mqtt` package) for the devices on the network.
EXPOSE 8080 8443 1883

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PROXY_HTTP_PORT}/healthz" >/dev/null || exit 1

ENTRYPOINT ["/init"]
# The TimescaleDB image's own command would be run by s6 as the container's program.
CMD []
