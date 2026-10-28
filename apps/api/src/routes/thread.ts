/**
 * `/brokers/thread`: the house's Thread network, for its page on the Brokers screen.
 *
 * Reading it is reading devices (`device:read`): the network, its border routers and nodes, and
 * the radios a border router could run on. Everything that changes the border router or the
 * network - setting Thread up, joining another network, restarting, removing, the settings - and
 * asking a radio which firmware it runs, are configuring an integration
 * (`integration:configure`). So is reading the network key and the dataset, which open the
 * network to whoever holds them: each read is audited, and neither is ever written to the audit.
 * Setting up is answered at once, `202`, and the page reads the status until the job ends.
 */
import { z } from 'zod';

import {
  threadBorderRoutersReplySchema,
  threadDatasetReplySchema,
  threadDevicesReplySchema,
  threadJoinRequestSchema,
  threadNetworkKeyReplySchema,
  threadRadioCheckReplySchema,
  threadRadiosReplySchema,
  threadRemoveReplySchema,
  threadSettingsRequestSchema,
  threadSetupRequestSchema,
  threadStatusSchema,
} from '@nebulahome/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { defineRoute, type RouteContext, type RouteEnvironment } from '../http/route.js';
import {
  checkThreadRadio,
  joinThread,
  removeThread,
  restartThread,
  saveThreadSettings,
  setUpThread,
  threadBorderRouters,
  threadDataset,
  threadDevices,
  threadNetworkKey,
  threadRadios,
  threadStatus,
} from '../services/thread.js';

import { forRequest } from './devices.js';

/** The status setting up is answered with: started, done later. */
const ACCEPTED_STATUS = 202;

/**
 * Registers the Thread broker's routes.
 *
 * @param environment - Where routes are registered and documented.
 * @param context - The service's collaborators.
 */
export function registerThreadRoutes(environment: RouteEnvironment, context: ApiContext): void {
  /**
   * Declares a read of the broker: `device:read`, the hub's answer as it is.
   *
   * @param url - What follows `/brokers/thread`.
   * @param summary - The operation's line.
   * @param response - What it answers.
   * @param read - What the hub is asked.
   */
  const defineRead = (
    url: string,
    summary: string,
    response: z.ZodType,
    read: (traceId: string) => Promise<unknown>,
  ): void => {
    defineRoute(
      environment,
      {
        method: 'GET',
        url: `/brokers/thread${url}`,
        summary,
        tag: 'Brokers',
        permission: 'device:read',
        response,
      },

      /**
       * Reads it.
       *
       * @param route - Who is asking.
       * @returns The hub's answer.
       */
      async (route) => {
        requirePermission(route.identity, 'device:read');

        return read(route.request.traceId);
      },
    );
  };

  /**
   * Writes one change to the network in the audit trail.
   *
   * @param action - What happened.
   * @param route - Who asked, and the request.
   * @param details - What the trail keeps of it: never a key or a dataset.
   */
  const audit = async (
    action: string,
    route: Pick<RouteContext<unknown, unknown, unknown>, 'identity' | 'request'>,
    details: Record<string, unknown> = {},
  ): Promise<void> => {
    await context.audit.record({
      action,
      resourceType: 'thread',
      resourceId: 'network',
      result: 'success',
      identity: route.identity,
      ipAddress: route.request.ip,
      traceId: route.request.traceId,
      details,
    });
  };

  defineRead('', "Where the house's Thread network stands", threadStatusSchema, (traceId) =>
    threadStatus(forRequest(context, traceId)),
  );
  defineRead(
    '/radios',
    'List the free serial ports a Thread radio may be on, the recognised radios first',
    threadRadiosReplySchema,
    (traceId) => threadRadios(forRequest(context, traceId)),
  );
  defineRead(
    '/border-routers',
    'List the Thread border routers heard on the network',
    threadBorderRoutersReplySchema,
    (traceId) => threadBorderRouters(forRequest(context, traceId)),
  );
  defineRead(
    '/devices',
    "List the nodes of the house's Thread network",
    threadDevicesReplySchema,
    (traceId) => threadDevices(forRequest(context, traceId)),
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/thread/radios/:portId/check',
      summary: 'Ask a radio which firmware it runs',
      tag: 'Brokers',
      permission: 'integration:configure',
      params: z.object({ portId: z.uuid() }),
      response: threadRadioCheckReplySchema,
    },

    /**
     * Asks the radio.
     *
     * @param route - The radio's port, and who is asking.
     * @returns The firmware, or why it could not be asked.
     */
    async (route) => {
      requirePermission(route.identity, 'integration:configure');

      return checkThreadRadio(forRequest(context, route.request.traceId), route.params.portId);
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/thread/setup',
      summary: 'Set Thread up: the border router, the radio, the network and Matter',
      tag: 'Brokers',
      permission: 'integration:configure',
      body: threadSetupRequestSchema,
      response: threadStatusSchema,
      successStatus: ACCEPTED_STATUS,
    },

    /**
     * Starts the setup; Try again is the same request.
     *
     * @param route - The border router and the network, and who is asking.
     * @returns Where the broker stands, the job in `setup`.
     */
    async (route) => {
      requirePermission(route.identity, 'integration:configure');

      const status = await setUpThread(forRequest(context, route.request.traceId), route.body);
      const { border, network } = route.body;

      // The external border router by its host alone: a URL may carry a password.
      await audit('thread.setup', route, {
        mode: border.mode,
        ...(border.mode === 'local'
          ? { portId: border.portId }
          : { host: new URL(border.url).host }),
        network: network.action,
        ...(network.action === 'create' ? { name: network.name, channel: network.channel } : {}),
        useForMatter: route.body.useForMatter,
      });

      return status;
    },
  );

  defineRoute(
    environment,
    {
      method: 'PUT',
      url: '/brokers/thread/settings',
      summary: "Change the Thread network's name, channel or hand-off to Matter",
      tag: 'Brokers',
      permission: 'integration:configure',
      body: threadSettingsRequestSchema,
      response: threadStatusSchema,
    },

    /**
     * Saves the settings.
     *
     * @param route - The settings, and who is asking.
     * @returns Where the broker stands then.
     */
    async (route) => {
      requirePermission(route.identity, 'integration:configure');

      const status = await saveThreadSettings(
        forRequest(context, route.request.traceId),
        route.body,
      );

      await audit('thread.settings', route, { ...route.body });

      return status;
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/thread/join',
      summary: 'Join another Thread network by its dataset, leaving this one',
      tag: 'Brokers',
      permission: 'integration:configure',
      body: threadJoinRequestSchema,
      response: threadStatusSchema,
    },

    /**
     * Joins the network.
     *
     * @param route - The dataset, and who is asking.
     * @returns Where the broker stands then.
     */
    async (route) => {
      requirePermission(route.identity, 'integration:configure');

      const status = await joinThread(forRequest(context, route.request.traceId), route.body);

      await audit('thread.join', route, { networkName: status.network?.name ?? null });

      return status;
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/thread/restart',
      summary: "Restart the platform's Thread border router",
      tag: 'Brokers',
      permission: 'integration:configure',
      response: threadStatusSchema,
    },

    /**
     * Restarts the border router.
     *
     * @param route - Who is asking.
     * @returns Where the broker stands then.
     */
    async (route) => {
      requirePermission(route.identity, 'integration:configure');

      const status = await restartThread(forRequest(context, route.request.traceId));

      await audit('thread.restart', route);

      return status;
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/brokers/thread/border-router',
      summary: 'Remove the Thread border router: Thread is not set up afterwards',
      tag: 'Brokers',
      permission: 'integration:configure',
      response: threadRemoveReplySchema,
    },

    /**
     * Removes the border router; an external one is only forgotten.
     *
     * @param route - Who is asking.
     * @returns Whether there was one.
     */
    async (route) => {
      requirePermission(route.identity, 'integration:configure');

      const reply = await removeThread(forRequest(context, route.request.traceId));

      await audit('thread.remove', route, { isRemoved: reply.isRemoved });

      return reply;
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/brokers/thread/network-key',
      summary: "Read the Thread network's key from the border router",
      tag: 'Brokers',
      permission: 'integration:configure',
      response: threadNetworkKeyReplySchema,
    },

    /**
     * Reads the key: who read it is audited, the key never is.
     *
     * @param route - Who is asking.
     * @returns The key.
     */
    async (route) => {
      requirePermission(route.identity, 'integration:configure');

      const reply = await threadNetworkKey(forRequest(context, route.request.traceId));

      await audit('thread.network_key.reveal', route);

      return reply;
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/brokers/thread/dataset',
      summary: "Read the Thread network's active dataset from the border router",
      tag: 'Brokers',
      permission: 'integration:configure',
      response: threadDatasetReplySchema,
    },

    /**
     * Reads the dataset: who read it is audited, the dataset never is.
     *
     * @param route - Who is asking.
     * @returns The dataset, as TLV hex.
     */
    async (route) => {
      requirePermission(route.identity, 'integration:configure');

      const reply = await threadDataset(forRequest(context, route.request.traceId));

      await audit('thread.dataset.reveal', route);

      return reply;
    },
  );
}
