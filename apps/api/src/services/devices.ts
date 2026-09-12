/**
 * Finding devices and adopting them, on the hub's behalf.
 *
 * Three relays and no state. The hub runs the pass, holds what it found, and writes what is
 * adopted - through `core`, the registry's one writer - so the API's part is to carry a request
 * across the bus and an answer back, with the trace id and a timeout. What is deliberately not
 * here is a candidate table: a candidate is something a scan saw a moment ago, and the hub's
 * memory of the current pass is the only honest place for it.
 *
 * Every relay needs the bus. Without it the answer is a 503 naming the dependency, not an empty
 * list: an empty list would say the house has nothing to find.
 */
import type { BusClient } from '@nebula-home/bus';
import {
  busSubjects,
  DeviceUnavailableError,
  deviceAdoptReplySchema,
  deviceCandidatesReplySchema,
  deviceDiscoverReplySchema,
  HUB_ADOPT_METHOD,
  HUB_CANDIDATES_METHOD,
  HUB_DISCOVER_METHOD,
  HUB_SERVICE,
  type DeviceAdoptReply,
  type DeviceAdoptRequest,
  type DeviceCandidatesReply,
  type DeviceDiscoverReply,
  type DeviceDiscoverRequest,
} from '@nebula-home/contracts';

/** What the relays need, for one request. */
export type DevicesContext = {
  /** The bus, when the broker is reachable. */
  readonly bus: BusClient | undefined;

  /** How long to wait for the hub. */
  readonly timeoutMs: number;

  /** The request's trace id, carried onto the bus. */
  readonly traceId: string;
};

/**
 * Adopting waits longer than the other two: it is a registration through `core` and a
 * subscription plan rebuilt on the hub, and a timeout that fired between the two would leave a
 * device written and unwatched.
 */
const ADOPT_TIMEOUT_MS = 15_000;

/**
 * The bus, or the reason there is none.
 *
 * @param context - The request's collaborators.
 * @returns The client.
 * @throws {DeviceUnavailableError} While the broker is unreachable.
 */
function busOf(context: DevicesContext): BusClient {
  if (context.bus === undefined) {
    throw new DeviceUnavailableError('The message bus is not reachable', {
      details: { dependency: 'bus' },
    });
  }

  return context.bus;
}

/**
 * Asks the hub to start a discovery pass.
 *
 * @param context - The request's collaborators.
 * @param request - Which instance to look with, and for how long.
 * @returns The pass identifier and the instances actually looking.
 * @throws {DeviceUnavailableError} When the bus is away or the hub does not answer.
 */
export async function startDiscovery(
  context: DevicesContext,
  request: DeviceDiscoverRequest,
): Promise<DeviceDiscoverReply> {
  return busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_DISCOVER_METHOD),
    request,
    deviceDiscoverReplySchema,
    { traceId: context.traceId, timeoutMs: context.timeoutMs },
  );
}

/**
 * Asks the hub what the current pass has found.
 *
 * @param context - The request's collaborators.
 * @returns The candidates so far, and whether the pass is still running.
 * @throws {DeviceUnavailableError} When the bus is away or the hub does not answer.
 */
export async function readCandidates(context: DevicesContext): Promise<DeviceCandidatesReply> {
  return busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_CANDIDATES_METHOD),
    {},
    deviceCandidatesReplySchema,
    { traceId: context.traceId, timeoutMs: context.timeoutMs },
  );
}

/**
 * Asks the hub to adopt a candidate of the current pass.
 *
 * @param context - The request's collaborators.
 * @param request - Which candidate, and what to call it.
 * @returns The device row and the entities written under it.
 * @throws {DeviceUnavailableError} When the bus is away or the hub does not answer.
 * @throws {NotFoundError} When the candidate is not from the current pass - crossing the bus by
 * its code, so the client hears a 404 rather than a 502.
 */
export async function adoptCandidate(
  context: DevicesContext,
  request: DeviceAdoptRequest,
): Promise<DeviceAdoptReply> {
  return busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_ADOPT_METHOD),
    request,
    deviceAdoptReplySchema,
    { traceId: context.traceId, timeoutMs: ADOPT_TIMEOUT_MS },
  );
}
