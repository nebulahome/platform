/**
 * `/brokers/infrared`: the house's Infrared broker, for its page on the Brokers screen.
 *
 * Reading it is reading devices (`device:read`): the blasters, the remotes and their buttons, a
 * learn job, and a code shown in the formats it copies as. Making or changing a remote or a
 * button - saving, moving, duplicating, importing, learning - and sending a code through a blaster
 * are `device:write`; removing a remote or a button removes it from the house (`device:delete`),
 * audited. A learn job is answered at once, `202`, and the page reads it until it ends.
 */
import { z } from 'zod';

import {
  infraredBlastersReplySchema,
  infraredButtonPressReplySchema,
  infraredButtonSaveRequestSchema,
  infraredButtonSchema,
  infraredCodeFormatsReplySchema,
  infraredCodeFormatsRequestSchema,
  infraredImportParseReplySchema,
  infraredImportParseRequestSchema,
  infraredImportRequestSchema,
  infraredLearnJobSchema,
  infraredLearnRequestSchema,
  infraredRemoteDetailSchema,
  infraredRemoteSaveRequestSchema,
  infraredRemoteSchema,
  infraredRemotesReplySchema,
  infraredStatusSchema,
  infraredTestRequestSchema,
} from '@nebulahome/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import {
  cancelInfraredLearn,
  importInfrared,
  infraredBlasters,
  infraredCodeFormats,
  infraredLearnJob,
  infraredRemote,
  infraredRemotes,
  infraredStatus,
  learnInfrared,
  moveInfraredButton,
  parseInfraredImport,
  pressInfraredButton,
  removeInfraredButton,
  removeInfraredRemote,
  saveInfraredButton,
  saveInfraredRemote,
  testInfrared,
} from '../services/infrared.js';

import { forRequest } from './devices.js';

/** The status a learn job is answered with: started, done later. */
const ACCEPTED_STATUS = 202;

/** Which remote or button a request is about. */
const idParamsSchema = z.object({ id: z.uuid() });

/** Which learn job a request is about. */
const jobParamsSchema = z.object({ jobId: z.string().min(1).max(64) });

/**
 * Registers the Infrared broker's routes.
 *
 * @param environment - Where routes are registered and documented.
 * @param context - The service's collaborators.
 */
export function registerInfraredRoutes(environment: RouteEnvironment, context: ApiContext): void {
  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/brokers/infrared',
      summary: "Where the house's Infrared broker stands",
      tag: 'Brokers',
      permission: 'device:read',
      response: infraredStatusSchema,
    },

    /**
     * Says where the broker stands.
     *
     * @param route - Who is asking.
     * @returns Its state.
     */
    async (route) => {
      requirePermission(route.identity, 'device:read');

      return infraredStatus(forRequest(context, route.request.traceId));
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/brokers/infrared/blasters',
      summary: 'List the IR blasters the integrations provide',
      tag: 'Brokers',
      permission: 'device:read',
      response: infraredBlastersReplySchema,
    },

    /**
     * Lists the blasters.
     *
     * @param route - Who is asking.
     * @returns Them, by name.
     */
    async (route) => {
      requirePermission(route.identity, 'device:read');

      return infraredBlasters(forRequest(context, route.request.traceId));
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/brokers/infrared/remotes',
      summary: "List the house's infrared remotes",
      tag: 'Brokers',
      permission: 'device:read',
      response: infraredRemotesReplySchema,
    },

    /**
     * Lists the remotes.
     *
     * @param route - Who is asking.
     * @returns Them, by name, without their buttons.
     */
    async (route) => {
      requirePermission(route.identity, 'device:read');

      return infraredRemotes(forRequest(context, route.request.traceId));
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/brokers/infrared/remotes/:id',
      summary: 'Read an infrared remote with its buttons',
      tag: 'Brokers',
      permission: 'device:read',
      params: idParamsSchema,
      response: infraredRemoteDetailSchema,
    },

    /**
     * Reads a remote.
     *
     * @param route - The remote, and who is asking.
     * @returns It, its buttons by cell.
     */
    async (route) => {
      requirePermission(route.identity, 'device:read');

      return infraredRemote(forRequest(context, route.request.traceId), route.params.id);
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/infrared/remotes',
      summary: 'Add an infrared remote, or change one',
      tag: 'Brokers',
      permission: 'device:write',
      body: infraredRemoteSaveRequestSchema,
      response: infraredRemoteSchema,
    },

    /**
     * Saves a remote: one with an id replaces it, a new one is added to the house.
     *
     * @param route - The remote, and who is asking.
     * @returns It, as the page lists it.
     */
    async (route) => {
      requirePermission(route.identity, 'device:write');

      const saved = await saveInfraredRemote(
        forRequest(context, route.request.traceId),
        route.body,
      );

      await context.audit.record({
        action: 'infrared.remote.save',
        resourceType: 'infrared',
        resourceId: saved.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { name: saved.name, kind: saved.kind, blasterId: saved.blasterId },
      });

      return saved;
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/brokers/infrared/remotes/:id',
      summary: 'Remove an infrared remote and its buttons from the house',
      tag: 'Brokers',
      permission: 'device:delete',
      params: idParamsSchema,
      successStatus: 204,
    },

    /**
     * Removes a remote: its device from the house, then the remote from the broker.
     *
     * @param route - The remote, and who is asking.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'device:delete');

      const { name, removed } = await removeInfraredRemote(
        forRequest(context, route.request.traceId),
        route.params.id,
      );

      await context.audit.record({
        action: 'infrared.remote.remove',
        resourceType: 'infrared',
        resourceId: route.params.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { name, entityIds: removed?.entityIds ?? [] },
      });
    },
  );

  registerButtonRoutes(environment, context);
  registerCodeRoutes(environment, context);
}

/**
 * Registers the routes of a remote's buttons.
 *
 * @param environment - Where routes are registered and documented.
 * @param context - The service's collaborators.
 */
function registerButtonRoutes(environment: RouteEnvironment, context: ApiContext): void {
  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/infrared/buttons',
      summary: 'Add a button to an infrared remote, change one, or duplicate one',
      tag: 'Brokers',
      permission: 'device:write',
      body: infraredButtonSaveRequestSchema,
      response: infraredButtonSchema,
    },

    /**
     * Saves a button: one with an id replaces it, a new one takes the first empty cell.
     *
     * @param route - The button, and who is asking.
     * @returns It.
     */
    async (route) => {
      requirePermission(route.identity, 'device:write');

      return saveInfraredButton(forRequest(context, route.request.traceId), route.body);
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/infrared/buttons/:id/move',
      summary: "Move a button to an empty cell of its remote's keypad",
      tag: 'Brokers',
      permission: 'device:write',
      params: idParamsSchema,
      body: z.object({ cell: z.int().min(0).max(1023) }),
      response: infraredButtonSchema,
    },

    /**
     * Moves a button.
     *
     * @param route - The button, the cell, and who is asking.
     * @returns It, moved.
     */
    async (route) => {
      requirePermission(route.identity, 'device:write');

      return moveInfraredButton(forRequest(context, route.request.traceId), {
        id: route.params.id,
        cell: route.body.cell,
      });
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/brokers/infrared/buttons/:id',
      summary: 'Remove a button from its infrared remote',
      tag: 'Brokers',
      permission: 'device:delete',
      params: idParamsSchema,
      successStatus: 204,
    },

    /**
     * Removes a button; its entity goes when the remote's device is identified again.
     *
     * @param route - The button, and who is asking.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'device:delete');

      await removeInfraredButton(forRequest(context, route.request.traceId), route.params.id);
      await context.audit.record({
        action: 'infrared.button.remove',
        resourceType: 'infrared',
        resourceId: route.params.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: {},
      });
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/infrared/buttons/:id/press',
      summary: "Send a button's code through its remote's blaster",
      tag: 'Brokers',
      permission: 'device:write',
      params: idParamsSchema,
      response: infraredButtonPressReplySchema,
    },

    /**
     * Presses a button.
     *
     * @param route - The button, and who is asking.
     * @returns When it was sent.
     */
    async (route) => {
      requirePermission(route.identity, 'device:write');

      return pressInfraredButton(forRequest(context, route.request.traceId), route.params.id);
    },
  );
}

/**
 * Registers the routes of codes not saved yet: testing, learning, importing, showing.
 *
 * @param environment - Where routes are registered and documented.
 * @param context - The service's collaborators.
 */
function registerCodeRoutes(environment: RouteEnvironment, context: ApiContext): void {
  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/infrared/test',
      summary: 'Send a code not saved yet through a blaster',
      tag: 'Brokers',
      permission: 'device:write',
      body: infraredTestRequestSchema,
      response: infraredButtonPressReplySchema,
    },

    /**
     * Sends the code.
     *
     * @param route - The blaster and the code, and who is asking.
     * @returns When it was sent.
     */
    async (route) => {
      requirePermission(route.identity, 'device:write');

      return testInfrared(forRequest(context, route.request.traceId), route.body);
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/infrared/learn',
      summary: 'Start learning a code on a blaster',
      tag: 'Brokers',
      permission: 'device:write',
      body: infraredLearnRequestSchema,
      response: infraredLearnJobSchema,
      successStatus: ACCEPTED_STATUS,
    },

    /**
     * Starts listening.
     *
     * @param route - The blaster, the signal, and who is asking.
     * @returns The job, listening.
     */
    async (route) => {
      requirePermission(route.identity, 'device:write');

      return learnInfrared(forRequest(context, route.request.traceId), route.body);
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/brokers/infrared/learn/jobs/:jobId',
      summary: 'Read a job learning a code',
      tag: 'Brokers',
      permission: 'device:read',
      params: jobParamsSchema,
      response: infraredLearnJobSchema,
    },

    /**
     * Reads the job.
     *
     * @param route - The job, and who is asking.
     * @returns It, as it now stands.
     */
    async (route) => {
      requirePermission(route.identity, 'device:read');

      return infraredLearnJob(forRequest(context, route.request.traceId), route.params.jobId);
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/infrared/learn/jobs/:jobId/cancel',
      summary: 'Stop learning a code before one came',
      tag: 'Brokers',
      permission: 'device:write',
      params: jobParamsSchema,
      response: infraredLearnJobSchema,
    },

    /**
     * Stops the job.
     *
     * @param route - The job, and who is asking.
     * @returns It, cancelled.
     */
    async (route) => {
      requirePermission(route.identity, 'device:write');

      return cancelInfraredLearn(forRequest(context, route.request.traceId), route.params.jobId);
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/infrared/import/parse',
      summary: 'Read pasted or dropped infrared codes: Broadlink, Pronto, raw, Flipper Zero',
      tag: 'Brokers',
      permission: 'device:write',
      body: infraredImportParseRequestSchema,
      response: infraredImportParseReplySchema,
    },

    /**
     * Reads the codes.
     *
     * @param route - The text and the file's name, and who is asking.
     * @returns The codes found, and the lines not understood.
     */
    async (route) => {
      requirePermission(route.identity, 'device:write');

      return parseInfraredImport(forRequest(context, route.request.traceId), route.body);
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/infrared/import',
      summary: 'Add imported codes to an infrared remote as buttons',
      tag: 'Brokers',
      permission: 'device:write',
      body: infraredImportRequestSchema,
      response: infraredRemoteDetailSchema,
    },

    /**
     * Adds the buttons, all or none.
     *
     * @param route - The remote and the codes, and who is asking.
     * @returns The remote, with its buttons.
     */
    async (route) => {
      requirePermission(route.identity, 'device:write');

      return importInfrared(forRequest(context, route.request.traceId), route.body);
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/infrared/codes/formats',
      summary: 'Show an infrared code in each format it copies as',
      tag: 'Brokers',
      permission: 'device:read',
      body: infraredCodeFormatsRequestSchema,
      response: infraredCodeFormatsReplySchema,
    },

    /**
     * Writes the code in each format.
     *
     * @param route - The code, and who is asking.
     * @returns The formats, and what the code reads as.
     */
    async (route) => {
      requirePermission(route.identity, 'device:read');

      return infraredCodeFormats(forRequest(context, route.request.traceId), route.body);
    },
  );
}
