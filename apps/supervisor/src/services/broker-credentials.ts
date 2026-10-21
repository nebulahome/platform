/**
 * The broker a managed container reaches, with a username of its own (PACKAGES.md 2, 13).
 *
 * A container that speaks MQTT - its environment or its first configuration names
 * `{platform.mqtt.url}` and the like - is given a username the house's broker made for it,
 * `nebula-vendor-zigbee2mqtt`, held to the topics its declaration names. The house's broker is
 * the one the hub runs, asked over the bus (`svc.hub.mqtt_credentials`), which answers the
 * supervisor alone; it answers the port it listens on, and the address is the platform's, which
 * `brokerUrlFor` turns into the one the container reaches it by. While the broker does not listen,
 * or the hub does not answer, the container waits for it (`ManagedContainers`). A broker the
 * environment names (`NEBULA_MQTT_URL`) is used instead, and nothing is asked: the callers do not
 * ask then.
 */
import type { BusClient } from '@nebulahome/bus';
import {
  busSubjects,
  HUB_MQTT_CREDENTIALS_METHOD,
  HUB_SERVICE,
  mqttCredentialsReplySchema,
  type ManagedContainerSpec,
  type MqttCredentialsRequest,
} from '@nebulahome/contracts';
import type { PlatformLogger } from '@nebulahome/logging';

import type { PlatformContext } from '../domain/managed.js';

/** How long the hub has to answer: a container is not held up. */
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
 * @param logger - Where a broker that did not answer is noted.
 * @returns The broker as the platform reaches it, with the container's username; undefined when
 *   the container does not speak MQTT, or no broker answered.
 */
export async function brokerFor(
  client: BusClient,
  spec: ManagedContainerSpec,
  logger?: PlatformLogger,
): Promise<PlatformContext['mqtt'] | undefined> {
  if (!speaksMqtt(spec)) {
    return undefined;
  }

  return credentialsFor(
    client,
    {
      owner: `${spec.ownerKind}:${spec.vendorId}`,
      ...(spec.mqttTopics === undefined ? {} : { topics: [...spec.mqttTopics] }),
    },
    logger,
  );
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
  return credentialsFor(client, { owner: `package:${packageId}` });
}

/**
 * Asks the house's broker, which the hub runs, for a username.
 *
 * @param client - The bus.
 * @param request - Whose username, held to which topics.
 * @param logger - Where a broker that did not answer is noted: at debug, since the callers ask
 *   again every few seconds while there is none and say once themselves that they wait.
 * @returns The broker with the username; undefined when there is none, or it did not answer.
 */
async function credentialsFor(
  client: BusClient,
  request: MqttCredentialsRequest,
  logger?: PlatformLogger,
): Promise<PlatformContext['mqtt'] | undefined> {
  const { owner } = request;

  try {
    const reply = await client.request(
      busSubjects.service(HUB_SERVICE, HUB_MQTT_CREDENTIALS_METHOD),
      request,
      mqttCredentialsReplySchema,
      { timeoutMs: TIMEOUT_MS },
    );

    return {
      url: `mqtt://127.0.0.1:${String(reply.port)}`,
      username: reply.username,
      password: reply.password,
    };
  } catch (error: unknown) {
    logger?.debug({ err: error, owner }, 'The house’s MQTT broker gave no username');

    return undefined;
  }
}
