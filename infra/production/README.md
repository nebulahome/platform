# NebulaHome on a machine of its own

What to copy to a machine with Docker to run NebulaHome from the published image: no build, no
development stack. The platform is one container ([../README.md](../README.md#the-container));
beside it run the containers an integration needs - zigbee2mqtt for Zigbee - which the platform
starts itself through Docker's socket.

| File                        | What                                                                     |
| --------------------------- | ------------------------------------------------------------------------ |
| `docker-compose.yml`        | The platform on the host's network, discovery on (a Linux server)        |
| `docker-compose.bridge.yml` | Docker Desktop, or no host network: a bridge of its own, ports published |
| `.env.example`              | The settings - the image, the ports, the data folder - to copy to .env   |

The platform is one container because it is the whole of it: PostgreSQL with TimescaleDB, NATS
and every service run inside it, supervised by s6, each with a volume of its own. There is no
database or bus container to add; neither is reachable from outside it.

Docker with Compose 2.24 or later. Docker Engine 26 or later (Docker Desktop 4.29) keeps the
data of the containers integrations run inside the data directory; an older engine keeps it in
volumes of their own, outside the backups. Linux, x86-64 or ARM64 as the image was built for; on
Windows and macOS, Docker Desktop.

## The image

The compose file runs `nebulahome/platform:latest` unless `.env` says otherwise. To run an image
of your own, build it from the repository and push it where the machine can pull it:

```bash
docker build --target runtime -t yourname/nebulahome:latest .
docker push yourname/nebulahome:latest
```

then `NEBULA_IMAGE=yourname/nebulahome` in `.env`. The image is built for the architecture of
the machine that builds it; for another, `docker buildx build --platform linux/arm64 … --push`.

## Starting it

```bash
cp .env.example .env
docker compose pull
docker compose up -d --wait
```

The page is on `http://<machine>:8080`, and `https://<machine>:8443` with a certificate made on
the first start. The first visit creates the owner. The first start takes a minute or two: the
keys are generated, the database is created and migrated.

```bash
docker compose logs -f              # every service's log
docker compose ps                   # running, healthy
docker compose restart              # restart the platform
docker compose pull && docker compose up -d --wait    # upgrade to the latest image
docker compose stop                 # stop it; everything is kept
```

An upgrade is a new image and a start: the migrations run before any service. The containers the
platform runs - zigbee2mqtt - keep running while it restarts and are picked up again.

## The network

**The host's network (the default).** The platform is on the machine's own network, where the hub
hears the LAN - mDNS, Govee's scan, Shelly's and Bambu Lab's announcements - and finds devices on
its own. Nothing is published: the page is on the host's ports 8080 and 8443, the house's MQTT
broker on 1883 for the devices on the network, and what else the platform listens on -
PostgreSQL 5433, NATS 4223 (monitor 8223), `api` 4100 - is on loopback only, with passwords. Those
ports must be free on the host; the page's are changed with `PROXY_HTTP_PORT` and
`PROXY_HTTPS_PORT` in `.env`, the broker's on its own page (Packages → MQTT → Configure). The
containers integrations run go on the host's network too and reach the broker on `127.0.0.1`.

A Linux server only: Docker Desktop's host network is its virtual machine's and reaches no device.

**A bridge, on Docker Desktop or where the host's network is not wanted.**

```bash
docker compose -f docker-compose.yml -f docker-compose.bridge.yml up -d --wait
```

The platform is then on one user-defined bridge, `nebulahome-net`, declared by the override,
under the name `nebulahome`, with the page's ports and the broker's published (`NEBULA_HTTP_PORT`,
`NEBULA_HTTPS_PORT`, `NEBULA_MQTT_PORT`). The containers integrations run are put on that same
network by the platform and reach it by name: zigbee2mqtt is given `mqtt://nebulahome:1883` as its
broker, with a username of its own. Nothing depends on an address Docker handed out, so the subnet
Docker picks does not matter - unless it is the LAN's own: if a device on your network has an
address in the subnet Docker gave `nebulahome-net` (`docker network inspect nebulahome-net`), the
platform cannot reach it, and a subnet of your choosing goes in the override's `ipam` block.

A bridge carries no multicast, so the hub cannot hear devices announce themselves: there
discovery is off and devices are added by their address; cloud integrations (Ecovacs) and Zigbee
work as anywhere. Every command below then takes both `-f` files.

Switching between the two keeps everything: the data, the database and the containers.

## Zigbee

Plug the coordinator into the machine, then in the page: **Integrations → Zigbee2MQTT → Configure**

- the adapter, and its path, `/dev/serial/by-id/…` (`ls -l /dev/serial/by-id/` lists them). The
  platform downloads zigbee2mqtt and runs it as `nebulahome-zigbee2mqtt`, with the coordinator
  passed in and its data - the network's keys - in the data directory, so in every backup. Its log is
  on the Containers page.

## The data

Three volumes: `nebulahome_nebula-data` - the data directory: the integrations, the keys, the
certificates, the backups and the containers' data - `nebulahome_nebula-postgres` and
`nebulahome_nebula-nats`. To keep the data directory in a folder of the machine instead - easy to
copy, easy to see - set `NEBULA_DATA_PATH=/srv/nebulahome/data` before the first start.

Backups are made from **Settings → Backup**, to the data directory and to any disk or share added
there; a disk of the machine is mounted in by the commented line of the compose file. Download the
backup key from the same page and keep it somewhere else: without it an archive cannot be opened.

## Starting again from nothing

```bash
docker compose down
docker volume rm nebulahome_nebula-data nebulahome_nebula-postgres nebulahome_nebula-nats
```

deletes everything, the keys and the backups in the data volume with it. On the bridge,
`docker compose down` leaves `nebulahome-net` in place while zigbee2mqtt is still on it (`Resource is still in use`):
`docker rm -f nebulahome-zigbee2mqtt` first, or leave the network for the next start.

## When something is wrong

- **The page does not open.** `docker compose ps`: `starting` for the first two minutes is the
  first start; `unhealthy` after it, `docker compose logs --tail=200` says which service stopped.
- **`Unable to open config file /run/mosquitto/mosquitto.conf`**: an image from before the
  house's broker moved into the platform. Build or pull a current one: Mosquitto is gone.
- **The MQTT broker says port 1883 is in use.** An installation from before the broker moved into
  the hub still has the `mqtt` package: remove it on Packages, and the broker takes the port within
  ten seconds. Its clients are not carried over: add each device's again.
- **Devices cannot connect to the broker.** Brokers → MQTT: the broker's page says the port and
  lists the clients; each device needs a username added there (or clients without a username
  allowed in its settings). On the bridge, the host's port is `NEBULA_MQTT_PORT` (1883); on the host's network, the
  broker's own port.
- **zigbee2mqtt cannot reach the broker.** On the bridge, `docker network inspect nebulahome-net`
  should list both `nebulahome-nebulahome-1` and `nebulahome-zigbee2mqtt`; on the host's network
  both are on it and meet on `127.0.0.1`. The vendor's page says what the bridge last heard.
- **The page does not start on the host's network: `address already in use`.** Something else on
  the host holds 8080, 8443 or 1883: move the page with `PROXY_HTTP_PORT` / `PROXY_HTTPS_PORT` in
  `.env`, or stop what holds it.
- **`network nebulahome-net was found but has incorrect label`**: a network of that name was made
  by hand or by another tool. `docker network rm nebulahome-net` with nothing on it, and start
  again.
