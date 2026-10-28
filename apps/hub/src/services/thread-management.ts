/**
 * The Thread broker on the bus: what the Brokers page reads and asks, through `api`.
 *
 * `svc.hub.thread_status`, `thread_radios`, `thread_border_routers` and `thread_devices` read;
 * `thread_radio_check` asks a radio its firmware; `thread_setup` starts setting Thread up and
 * answers at once, the job followed in the status; `thread_settings`, `thread_join`,
 * `thread_restart` and `thread_remove` change the border router; `thread_network_key` and
 * `thread_dataset` read the network's secrets from the border router, which `api` audits.
 */
import { z } from 'zod';

import type { BusClient, BusSubscription } from '@nebulahome/bus';
import {
  busSubjects,
  HUB_SERVICE,
  HUB_THREAD_BORDER_ROUTERS_METHOD,
  HUB_THREAD_DATASET_METHOD,
  HUB_THREAD_DEVICES_METHOD,
  HUB_THREAD_JOIN_METHOD,
  HUB_THREAD_NETWORK_KEY_METHOD,
  HUB_THREAD_RADIO_CHECK_METHOD,
  HUB_THREAD_RADIOS_METHOD,
  HUB_THREAD_REMOVE_METHOD,
  HUB_THREAD_RESTART_METHOD,
  HUB_THREAD_SETTINGS_METHOD,
  HUB_THREAD_SETUP_METHOD,
  HUB_THREAD_STATUS_METHOD,
  threadJoinRequestSchema,
  threadRadioCheckRequestSchema,
  threadSettingsRequestSchema,
  threadSetupRequestSchema,
} from '@nebulahome/contracts';

import type { ThreadBroker } from '../thread/broker.js';

/**
 * Serves the Thread broker's methods.
 *
 * @param client - The hub's bus client.
 * @param broker - The broker.
 * @returns The subscriptions, to drop on stop.
 */
export function serveThread(client: BusClient, broker: ThreadBroker): BusSubscription[] {
  /**
   * One method of the broker's.
   *
   * @param method - Its name.
   * @returns Its subject.
   */
  const subject = (method: string): string => busSubjects.service(HUB_SERVICE, method);

  return [
    client.serve(
      subject(HUB_THREAD_STATUS_METHOD),
      z.object({}),

      /**
       * Says where the broker stands.
       *
       * @returns Its status, the setup job in it.
       */
      async () => broker.status(),
    ),

    client.serve(
      subject(HUB_THREAD_RADIOS_METHOD),
      z.object({}),

      /**
       * Lists the ports a radio may be on.
       *
       * @returns Them, the recognised radios first.
       */
      async () => ({ items: await broker.radios() }),
    ),

    client.serve(
      subject(HUB_THREAD_RADIO_CHECK_METHOD),
      threadRadioCheckRequestSchema,

      /**
       * Asks a radio which firmware it runs.
       *
       * @param request - Its port.
       * @returns The firmware, or why it could not be asked.
       */
      async (request) => broker.checkRadio(request.portId),
    ),

    client.serve(
      subject(HUB_THREAD_SETUP_METHOD),
      threadSetupRequestSchema,

      /**
       * Starts setting Thread up.
       *
       * @param request - The border router, the network, and the hand-off to Matter.
       * @returns Where the broker stands, the job running.
       */
      async (request) => broker.setup(request),
    ),

    client.serve(
      subject(HUB_THREAD_SETTINGS_METHOD),
      threadSettingsRequestSchema,

      /**
       * Saves the owner's settings.
       *
       * @param request - What changes.
       * @returns Where the broker stands.
       */
      async (request) => broker.saveSettings(request),
    ),

    client.serve(
      subject(HUB_THREAD_JOIN_METHOD),
      threadJoinRequestSchema,

      /**
       * Joins another network.
       *
       * @param request - Its dataset.
       * @returns Where the broker stands.
       */
      async (request) => broker.join(request.dataset),
    ),

    client.serve(
      subject(HUB_THREAD_RESTART_METHOD),
      z.object({}),

      /**
       * Restarts the platform's border router.
       *
       * @returns Where the broker stands.
       */
      async () => broker.restart(),
    ),

    client.serve(
      subject(HUB_THREAD_REMOVE_METHOD),
      z.object({}),

      /**
       * Removes the border router.
       *
       * @returns Whether there was one.
       */
      async () => broker.remove(),
    ),

    client.serve(
      subject(HUB_THREAD_NETWORK_KEY_METHOD),
      z.object({}),

      /**
       * Reads the network key from the border router.
       *
       * @returns The key.
       */
      async () => broker.networkKey(),
    ),

    client.serve(
      subject(HUB_THREAD_DATASET_METHOD),
      z.object({}),

      /**
       * Reads the active dataset from the border router.
       *
       * @returns The dataset as TLV hex.
       */
      async () => broker.dataset(),
    ),

    client.serve(
      subject(HUB_THREAD_BORDER_ROUTERS_METHOD),
      z.object({}),

      /**
       * Lists the border routers heard.
       *
       * @returns Them, this server's first.
       */
      async () => ({ items: await broker.borderRouters() }),
    ),

    client.serve(
      subject(HUB_THREAD_DEVICES_METHOD),
      z.object({}),

      /**
       * Lists the nodes of the network.
       *
       * @returns Them, the house's first.
       */
      async () => ({ items: await broker.devices() }),
    ),
  ];
}
