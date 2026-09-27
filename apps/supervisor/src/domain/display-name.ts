/**
 * What the interface calls a container.
 *
 * Docker's names are for machines: `nebulahome-postgres-1`, `nebulahome-zigbee2mqtt`,
 * `festive_hopper`. The page calls a container what a person would: the integration's name for
 * one an integration runs, the service's for one of a compose project, and otherwise its own name
 * with the dashes gone and the words capitalised - with the few names that are spelt otherwise
 * spelt right. The name stays what addresses a container; this is only what is shown.
 */
import { COMPOSE_LABELS } from './system.js';

/** Words spelt otherwise than capitalised, by their lower-case form. */
const SPELLINGS: Readonly<Record<string, string>> = {
  adguard: 'AdGuard',
  api: 'API',
  db: 'DB',
  dns: 'DNS',
  esphome: 'ESPHome',
  homeassistant: 'Home Assistant',
  http: 'HTTP',
  https: 'HTTPS',
  influxdb: 'InfluxDB',
  mariadb: 'MariaDB',
  mongodb: 'MongoDB',
  mqtt: 'MQTT',
  mysql: 'MySQL',
  nats: 'NATS',
  nebulahome: 'NebulaHome',
  nfs: 'NFS',
  nginx: 'NGINX',
  nodered: 'Node-RED',
  pihole: 'Pi-hole',
  postgres: 'PostgreSQL',
  postgresql: 'PostgreSQL',
  smb: 'SMB',
  ssh: 'SSH',
  timescaledb: 'TimescaleDB',
  ui: 'UI',
  vpn: 'VPN',
  zigbee2mqtt: 'Zigbee2MQTT',
};

/** The longest name shown. */
const MAXIMUM_LENGTH = 128;

/**
 * A machine's name made readable: `node-red_flows` becomes `Node Red Flows`.
 *
 * @param name - The name.
 * @returns It in words, never empty.
 */
export function humanize(name: string): string {
  const words = name
    .split(/[\s_.-]+/)
    .filter((word) => word !== '')
    .map(
      (word) => SPELLINGS[word.toLowerCase()] ?? `${word.charAt(0).toUpperCase()}${word.slice(1)}`,
    );

  return words.length === 0 ? name : words.join(' ').slice(0, MAXIMUM_LENGTH);
}

/** What naming a container needs. */
export type NamedContainer = {
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly isSelf: boolean;

  /** What the integration running it calls it, for a managed container. */
  readonly managedName: string | null;
};

/**
 * What the interface calls a container.
 *
 * @param container - The container.
 * @returns Its name for people.
 */
export function displayNameOf(container: NamedContainer): string {
  if (container.isSelf) {
    return 'NebulaHome';
  }

  if (container.managedName !== null && container.managedName !== '') {
    return container.managedName.slice(0, MAXIMUM_LENGTH);
  }

  const service = container.labels[COMPOSE_LABELS.service];

  if (service !== undefined && service !== '') {
    const number = Number(container.labels[COMPOSE_LABELS.number]);

    return `${humanize(service)}${Number.isInteger(number) && number > 1 ? ` ${String(number)}` : ''}`.slice(
      0,
      MAXIMUM_LENGTH,
    );
  }

  return humanize(container.name);
}
