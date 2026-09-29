/**
 * The broker a managed container reaches, with a username of its own (PACKAGES.md 13).
 *
 * A container that speaks MQTT - its environment or its first configuration names
 * `{platform.mqtt.url}` and the like - is given a username the house's broker made for it,
 * `nebula-vendor-zigbee2mqtt`, held to the topics its declaration names. The broker is
 * `pkg-mqtt`, asked over the bus (`svc.mqtt.credentials`); it answers the port it listens on, and
 * the address is the platform's, which `brokerUrlFor` turns into the one the container reaches it
 * by. When `pkg-mqtt` does not answer, the broker the environment names - an external one, or none
 * - stands in.
 */
import { z } from 'zod';

import type { BusClient } from '@nebula-home/bus';
import { busSubjects, type ManagedContainerSpec } from '@nebula-home/contracts';

import type { PlatformContext } from '../domain/managed.js';

/** The package that is the house's broker, and its service. */
const BROKER_PACKAGE = 'mqtt';

/** What it answers. */
const credentialsReplySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  port: z.int().min(1).max(65_535),
});

/** How long the broker has to answer: a container is not held up by it. */
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
 *   the container does not speak MQTT or the broker did not answer.
 */
export async function brokerFor(
  client: BusClient,
  spec: ManagedContainerSpec,
): Promise<PlatformContext['mqtt'] | undefined> {
  if (!speaksMqtt(spec)) {
    return undefined;
  }

  try {
    const reply = await client.request(
      busSubjects.service(BROKER_PACKAGE, 'credentials'),
      {
        principal: 'container',
        owner: `${spec.ownerKind}:${spec.vendorId}`,
        ...(spec.mqttTopics === undefined ? {} : { topics: spec.mqttTopics }),
      },
      credentialsReplySchema,
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
