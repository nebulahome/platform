/**
 * Asking another service one of its methods over the bus, the one way every `api` service does.
 */
import type { z } from 'zod';

import type { BusClient } from '@nebulahome/bus';
import { busSubjects, DeviceUnavailableError } from '@nebulahome/contracts';

/** What asking a service needs from a request. */
export type AskServiceContext = {
  readonly bus: BusClient | undefined;

  /** The request's trace id, carried onto the bus. */
  readonly traceId: string;
};

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
  if (context.bus === undefined) {
    throw new DeviceUnavailableError('The message bus is not reachable', {
      details: { dependency: 'bus' },
    });
  }

  return context.bus.request(
    busSubjects.service(service, method),
    body,
    schema,
    timeoutMs === undefined
      ? { traceId: context.traceId }
      : { traceId: context.traceId, timeoutMs },
  );
}
