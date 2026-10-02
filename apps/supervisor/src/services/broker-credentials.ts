/**
 * The broker a managed container reaches, with a username of its own (PACKAGES.md 2, 13).
 *
 * A container that speaks MQTT - its environment or its first configuration names
 * `{platform.mqtt.url}` and the like - is given a username the house's broker made for it,
 * `nebula-vendor-zigbee2mqtt`, held to the topics its declaration names. The house's broker is
 * whichever package provides `mqtt-broker`, found on the packet-manager's list and asked over the
 * bus (`svc.<package>.credentials`); it answers the port it listens on, and the address is the
 * platform's, which `brokerUrlFor` turns into the one the container reaches it by. With no such
 * package, or none that answers, the container goes without one. A broker the environment names
 * (`NEBULA_MQTT_URL`) is used instead, and nothing is asked: the callers do not ask then.
 */
import type { BusClient } from '@nebulahome/bus';
import {
  busSubjects,
  MQTT_BROKER_SERVICE,
  MQTT_CREDENTIALS_METHOD,
  mqttCredentialsReplySchema,
  PACKET_MANAGER_METHODS,
  PACKET_MANAGER_SERVICE,
  packageListReplySchema,
  providerOf,
  type ManagedContainerSpec,
  type MqttCredentialsRequest,
} from '@nebulahome/contracts';

import type { PlatformContext } from '../domain/managed.js';

/** How long the packet-manager and the broker each have to answer: a container is not held up. */
const TIMEOUT_MS = 3000;

/**
 * Whether a declaration names the broker at all.
 *
 * @param spec - The declaration.
 * @returns True when its environment or its first files name `{platform.mqtt.…}`.
 */
export function speaksMqtt(spec: ManagedContainerSpec): boolean {
  return [...spec.env.map((entry) => entry.value), ...spec.seed.map((seed) => seed.content)].some(
    (text) => text.includes('{platform.mqtt.'),
  );
}

/**
 * The broker a container reaches, from the house's broker.
 *
 * @param client - The bus.
 * @param spec - The container's declaration.
 * @returns The broker as the platform reaches it, with the container's username; undefined when
 *   the container does not speak MQTT, or no broker answered.
 */
export async function brokerFor(
  client: BusClient,
  spec: ManagedContainerSpec,
): Promise<PlatformContext['mqtt'] | undefined> {
  if (!speaksMqtt(spec)) {
    return undefined;
  }

  return credentialsFor(client, {
    principal: 'container',
    owner: `${spec.ownerKind}:${spec.vendorId}`,
    ...(spec.mqttTopics === undefined ? {} : { topics: [...spec.mqttTopics] }),
  });
}

/**
 * The broker a package's compose project reaches, from the house's broker: one username for the
 * project, every topic.
 *
 * @param client - The bus.
 * @param packageId - The package.
 * @returns The broker with the project's username; undefined when no broker answered.
 */
export async function brokerForPackage(
  client: BusClient,
  packageId: string,
): Promise<PlatformContext['mqtt'] | undefined> {
  return credentialsFor(client, { principal: 'container', owner: `package:${packageId}` });
}

/**
 * Asks the house's broker for a username: first which package it is, then that package.
 *
 * @param client - The bus.
 * @param request - Whose username, held to which topics.
 * @returns The broker with the username; undefined when there is none, or it did not answer.
 */
async function credentialsFor(
  client: BusClient,
  request: MqttCredentialsRequest,
): Promise<PlatformContext['mqtt'] | undefined> {
  try {
    const listed = await client.request(
      busSubjects.service(PACKET_MANAGER_SERVICE, PACKET_MANAGER_METHODS.list),
      {},
      packageListReplySchema,
      { timeoutMs: TIMEOUT_MS },
    );
    const provider = providerOf(
      MQTT_BROKER_SERVICE,
      listed.items.map((item) => ({
        id: item.id,
        provides: item.provides,
        isRunning: item.state === 'running',
      })),
    );

    if (provider === undefined) {
      return undefined;
    }

    const reply = await client.request(
      busSubjects.service(provider, MQTT_CREDENTIALS_METHOD),
      request,
      mqttCredentialsReplySchema,
      { timeoutMs: TIMEOUT_MS },
    );

    return {
      url: `mqtt://127.0.0.1:${String(reply.port)}`,
      username: reply.username,
      password: reply.password,
    };
  } catch {
    return undefined;
  }
}
