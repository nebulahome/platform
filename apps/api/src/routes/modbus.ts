/**
 * `/brokers/modbus`: the house's Modbus broker, for its page on the Brokers screen.
 *
 * Reading it is reading devices (`device:read`). Adding or changing a device or a template,
 * ignoring a server found, and asking a device - identification, the template editor's tests - is
 * `device:write`: each opens a connection to an address the owner typed, and a test write changes
 * what the device does, so it is audited. Removing a device removes it from the house
 * (`device:delete`). The search - its settings and starting one now - is configuring an
 * integration (`integration:configure`).
 */
import { z } from 'zod';

import {
  modbusDeviceInputSchema,
  modbusDeviceSchema,
  modbusDevicesReplySchema,
  modbusFoundReplySchema,
  modbusIdentifyReplySchema,
  modbusIdentifyRequestSchema,
  modbusIgnoreReplySchema,
  modbusIgnoreRequestSchema,
  modbusSettingsSchema,
  modbusStatusSchema,
  modbusTemplateRecordSchema,
  modbusTemplateSaveRequestSchema,
  modbusTemplatesReplySchema,
  modbusTestReadReplySchema,
  modbusTestReadRequestSchema,
  modbusTestTemplateReplySchema,
  modbusTestTemplateRequestSchema,
  modbusTestWriteReplySchema,
  modbusTestWriteRequestSchema,
} from '@nebulahome/contracts';

import { requirePermission } from '../auth/permissions.js';
import type { ApiContext } from '../context.js';
import { defineRoute, type RouteEnvironment } from '../http/route.js';
import {
  identifyModbus,
  ignoreModbus,
  modbusDevices,
  modbusFound,
  modbusStatus,
  modbusTemplates,
  removeModbusDevice,
  removeModbusTemplate,
  saveModbusDevice,
  saveModbusSettings,
  saveModbusTemplate,
  searchModbus,
  testModbusRead,
  testModbusTemplate,
  testModbusWrite,
} from '../services/modbus.js';

import { forRequest } from './devices.js';

/** Which device or template a request is about. */
const idParamsSchema = z.object({ id: z.uuid() });

/**
 * Registers the Modbus broker's routes.
 *
 * @param environment - Where routes are registered and documented.
 * @param context - The service's collaborators.
 */
export function registerModbusRoutes(environment: RouteEnvironment, context: ApiContext): void {
  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/brokers/modbus',
      summary: "Where the house's Modbus broker stands",
      tag: 'Brokers',
      permission: 'device:read',
      response: modbusStatusSchema,
    },

    /**
     * Says where the broker stands.
     *
     * @param route - Who is asking.
     * @returns Its state.
     */
    async (route) => {
      requirePermission(route.identity, 'device:read');

      return modbusStatus(forRequest(context, route.request.traceId));
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/brokers/modbus/devices',
      summary: "List the house's Modbus devices",
      tag: 'Brokers',
      permission: 'device:read',
      response: modbusDevicesReplySchema,
    },

    /**
     * Lists the devices.
     *
     * @param route - Who is asking.
     * @returns Each, with how it answers.
     */
    async (route) => {
      requirePermission(route.identity, 'device:read');

      return { items: await modbusDevices(forRequest(context, route.request.traceId)) };
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/modbus/devices',
      summary: 'Add a Modbus device, a template at an address, or change one',
      tag: 'Brokers',
      permission: 'device:write',
      body: modbusDeviceInputSchema,
      response: modbusDeviceSchema,
    },

    /**
     * Saves a device: one with an id replaces it.
     *
     * @param route - The device, and who is asking.
     * @returns It, as the page lists it.
     */
    async (route) => {
      requirePermission(route.identity, 'device:write');

      const saved = await saveModbusDevice(forRequest(context, route.request.traceId), route.body);

      await context.audit.record({
        action: 'modbus.device.save',
        resourceType: 'modbus',
        resourceId: saved.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: {
          name: saved.name,
          host: saved.host,
          port: saved.port,
          unitId: saved.unitId,
          template: saved.template,
        },
      });

      return saved;
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/brokers/modbus/devices/:id',
      summary: 'Remove a Modbus device from the house',
      tag: 'Brokers',
      permission: 'device:delete',
      params: idParamsSchema,
      successStatus: 204,
    },

    /**
     * Removes a device: from the house, then from the broker.
     *
     * @param route - The device, and who is asking.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'device:delete');

      const removed = await removeModbusDevice(
        forRequest(context, route.request.traceId),
        route.params.id,
      );

      await context.audit.record({
        action: 'modbus.device.remove',
        resourceType: 'modbus',
        resourceId: route.params.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { name: removed?.name ?? null, entityIds: removed?.entityIds ?? [] },
      });
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/brokers/modbus/templates',
      summary: "List the Modbus templates: the owner's and the integrations'",
      tag: 'Brokers',
      permission: 'device:read',
      response: modbusTemplatesReplySchema,
    },

    /**
     * Lists the templates.
     *
     * @param route - Who is asking.
     * @returns Them.
     */
    async (route) => {
      requirePermission(route.identity, 'device:read');

      return { items: await modbusTemplates(forRequest(context, route.request.traceId)) };
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/modbus/templates',
      summary: 'Save a Modbus template of the owner’s, new or changed',
      tag: 'Brokers',
      permission: 'device:write',
      body: modbusTemplateSaveRequestSchema,
      response: modbusTemplateRecordSchema,
    },

    /**
     * Saves a template: the devices that use it read it at once.
     *
     * @param route - The template, and who is asking.
     * @returns It, saved.
     */
    async (route) => {
      requirePermission(route.identity, 'device:write');

      const saved = await saveModbusTemplate(
        forRequest(context, route.request.traceId),
        route.body,
      );

      await context.audit.record({
        action: 'modbus.template.save',
        resourceType: 'modbus',
        resourceId: saved.id,
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { name: saved.document.name, entities: saved.document.entities.length },
      });

      return saved;
    },
  );

  defineRoute(
    environment,
    {
      method: 'DELETE',
      url: '/brokers/modbus/templates/:id',
      summary: 'Remove a Modbus template no device uses',
      tag: 'Brokers',
      permission: 'device:write',
      params: idParamsSchema,
      successStatus: 204,
    },

    /**
     * Removes a template.
     *
     * @param route - The template, and who is asking.
     */
    async (route): Promise<void> => {
      requirePermission(route.identity, 'device:write');

      await removeModbusTemplate(forRequest(context, route.request.traceId), route.params.id);
      await context.audit.record({
        action: 'modbus.template.remove',
        resourceType: 'modbus',
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
      method: 'PUT',
      url: '/brokers/modbus/settings',
      summary: 'Change how the network is searched for Modbus servers',
      tag: 'Brokers',
      permission: 'integration:configure',
      body: modbusSettingsSchema,
      response: modbusStatusSchema,
    },

    /**
     * Saves the settings: a search starts at once when it is on.
     *
     * @param route - The settings, and who is asking.
     * @returns Where the broker stands then.
     */
    async (route) => {
      requirePermission(route.identity, 'integration:configure');

      const status = await saveModbusSettings(
        forRequest(context, route.request.traceId),
        route.body,
      );

      await context.audit.record({
        action: 'modbus.settings',
        resourceType: 'modbus',
        resourceId: 'settings',
        result: 'success',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { ...route.body },
      });

      return status;
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/modbus/search',
      summary: 'Search the network for Modbus servers now',
      tag: 'Brokers',
      permission: 'integration:configure',
      response: modbusStatusSchema,
    },

    /**
     * Starts a search.
     *
     * @param route - Who is asking.
     * @returns Where the broker stands, searching.
     */
    async (route) => {
      requirePermission(route.identity, 'integration:configure');

      return searchModbus(forRequest(context, route.request.traceId));
    },
  );

  defineRoute(
    environment,
    {
      method: 'GET',
      url: '/brokers/modbus/found',
      summary: 'List the Modbus servers found on the network, and those ignored',
      tag: 'Brokers',
      permission: 'device:read',
      response: modbusFoundReplySchema,
    },

    /**
     * Lists the servers found.
     *
     * @param route - Who is asking.
     * @returns Them, and those ignored.
     */
    async (route) => {
      requirePermission(route.identity, 'device:read');

      return modbusFound(forRequest(context, route.request.traceId));
    },
  );

  defineRoute(
    environment,
    {
      method: 'PUT',
      url: '/brokers/modbus/ignored',
      summary: 'Ignore a Modbus server found, or stop ignoring it',
      tag: 'Brokers',
      permission: 'device:write',
      body: modbusIgnoreRequestSchema,
      response: modbusIgnoreReplySchema,
    },

    /**
     * Ignores a server, or stops.
     *
     * @param route - The server, and who is asking.
     * @returns How many are ignored.
     */
    async (route) => {
      requirePermission(route.identity, 'device:write');

      return ignoreModbus(forRequest(context, route.request.traceId), route.body);
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/modbus/identify',
      summary: 'Ask a Modbus device whether it answers, and who recognises it',
      tag: 'Brokers',
      permission: 'device:write',
      body: modbusIdentifyRequestSchema,
      response: modbusIdentifyReplySchema,
    },

    /**
     * Asks a device.
     *
     * @param route - The device, and who is asking.
     * @returns What it said.
     */
    async (route) => {
      requirePermission(route.identity, 'device:write');

      return identifyModbus(forRequest(context, route.request.traceId), route.body);
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/modbus/test/read',
      summary: 'Read one capability of a template from a Modbus device',
      tag: 'Brokers',
      permission: 'device:write',
      body: modbusTestReadRequestSchema,
      response: modbusTestReadReplySchema,
    },

    /**
     * Reads one capability.
     *
     * @param route - The device and the read, and who is asking.
     * @returns What was sent and got back.
     */
    async (route) => {
      requirePermission(route.identity, 'device:write');

      return testModbusRead(forRequest(context, route.request.traceId), route.body);
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/modbus/test/write',
      summary: 'Send one command of a template to a Modbus device',
      tag: 'Brokers',
      permission: 'device:write',
      body: modbusTestWriteRequestSchema,
      response: modbusTestWriteReplySchema,
    },

    /**
     * Sends one command: what the device does changes, so it is audited.
     *
     * @param route - The device, the entity and the command, and who is asking.
     * @returns What was sent and got back.
     */
    async (route) => {
      requirePermission(route.identity, 'device:write');

      const reply = await testModbusWrite(forRequest(context, route.request.traceId), route.body);
      const { target, capability, command } = route.body;

      await context.audit.record({
        action: 'modbus.test_write',
        resourceType: 'modbus',
        resourceId: `${target.host}:${String(target.port)}#${String(target.unitId)}`,
        result: reply.error === null ? 'success' : 'failure',
        identity: route.identity,
        ipAddress: route.request.ip,
        traceId: route.request.traceId,
        details: { entity: route.body.entity.name, capability, command, request: reply.request },
      });

      return reply;
    },
  );

  defineRoute(
    environment,
    {
      method: 'POST',
      url: '/brokers/modbus/test/template',
      summary: 'Read every entity of a template from a Modbus device once',
      tag: 'Brokers',
      permission: 'device:write',
      body: modbusTestTemplateRequestSchema,
      response: modbusTestTemplateReplySchema,
    },

    /**
     * Reads every entity.
     *
     * @param route - The device and the template, and who is asking.
     * @returns Each value.
     */
    async (route) => {
      requirePermission(route.identity, 'device:write');

      return testModbusTemplate(forRequest(context, route.request.traceId), route.body);
    },
  );
}
