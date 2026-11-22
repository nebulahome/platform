/**
 * Asking another service one of its methods over the bus, the one way every `api` service does.
 */
import type { z } from 'zod';

import type { BusClient } from '@nebulahome/bus';
import { busSubjects, DeviceUnavailableError, HUB_SERVICE } from '@nebulahome/contracts';

/** What asking a service needs from a request. */
export type AskServiceContext = {
  readonly bus: BusClient | undefined;

  /** The request's trace id, carried onto the bus. */
  readonly traceId: string;
};

/**
 * The bus, or the refusal of a request that needs it while the broker is away.
 *
 * @param context - Where the bus is, when it is connected.
 * @param context.bus - The bus.
 * @param details - What the refusal names: the thing the request was about.
 * @returns The bus.
 * @throws {DeviceUnavailableError} While the bus is not connected.
 */
export function requireBus(
  context: { readonly bus: BusClient | undefined },
  details: Readonly<Record<string, unknown>>,
): BusClient {
  if (context.bus === undefined) {
    throw new DeviceUnavailableError('The message bus is not reachable', { details });
  }

  return context.bus;
}

/**
 * Asks a service one of its methods.
 *
 * @param context - The bus and the trace id.
 * @param service - The service.
 * @param method - The method.
 * @param body - What it is asked.
 * @param schema - What the answer must be.
 * @param timeoutMs - How long it may take; the bus's usual wait when left out.
 * @returns The answer.
 * @throws {DeviceUnavailableError} When the bus is away or the service does not answer.
 */
export async function askService<TSchema extends z.ZodType>(
  context: AskServiceContext,
  service: string,
  method: string,
  body: unknown,
  schema: TSchema,
  timeoutMs?: number,
): Promise<z.output<TSchema>> {
  return requireBus(context, { dependency: 'bus' }).request(
    busSubjects.service(service, method),
    body,
    schema,
    timeoutMs === undefined
      ? { traceId: context.traceId }
      : { traceId: context.traceId, timeoutMs },
  );
}

/**
 * Asks the hub one of its methods: a broker's, the infrared, serial or Thread one.
 *
 * @param context - The bus, the trace id and the request's usual wait.
 * @param method - The method.
 * @param body - What it is asked.
 * @param schema - What the answer must be.
 * @param timeoutMs - How long the hub has; the request's usual wait unless the method needs more.
 * @returns The answer.
 * @throws {DeviceUnavailableError} When the hub cannot be asked.
 */
export async function askHub<TSchema extends z.ZodType>(
  context: AskServiceContext & { readonly timeoutMs: number },
  method: string,
  body: object,
  schema: TSchema,
  timeoutMs = context.timeoutMs,
): Promise<z.output<TSchema>> {
  return askService(context, HUB_SERVICE, method, body, schema, timeoutMs);
}
