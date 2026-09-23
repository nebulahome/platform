/**
 * The devices the hub heard announce themselves, and adopting one.
 *
 * The hub holds the list; `api` reads it and adds what the owner adopts. Adopting is adding a
 * device - the same `createDevice`, the same checks against the bundle, the same reload - with
 * the answers discovery already has filled in: the driver, the model, the address. What the owner
 * decides comes from the body; what the device said comes from the hub, read again at the moment
 * of adopting, so a client can neither adopt a device as another kind nor point it elsewhere.
 *
 * One thing is added beyond a device typed in by hand: the id the device reported, written as
 * the one identification must find. An adopted Shelly at an address that changed hands in the
 * meantime is then refused by the hub rather than silently taken over.
 */
import {
  busSubjects,
  discoveredReplySchema,
  HUB_DISCOVERED_METHOD,
  HUB_SERVICE,
  NotFoundError,
  ValidationError,
  type DeviceCreate,
  type DeviceView,
  type DiscoveredDevice,
  type DiscoveryAdopt,
} from '@nebula-home/contracts';

import { createDevice, type DevicesContext } from './devices.js';
import { busOf, type IntegrationsContext } from './integrations.js';

/** What adopting a device adds, and which device identification must find. */
export type Adoption = {
  readonly create: DeviceCreate;

  /** The id the device reported, or null when it keeps its id until it is set up. */
  readonly expectedExternalId: string | null;
};

/**
 * Decides the model a device is adopted as.
 *
 * @param candidate - What discovery heard.
 * @param picked - What the owner picked, if anything.
 * @returns The model.
 * @throws {ValidationError} When the pick is not one the device could be, or the device named a
 * family and nothing was picked from it.
 */
function modelOf(candidate: DiscoveredDevice, picked: string | undefined): string {
  const choices = candidate.modelChoices;
  const model =
    picked ?? candidate.model ?? (choices.length === 1 ? (choices[0] ?? undefined) : undefined);

  if (model === undefined || !choices.includes(model)) {
    throw new ValidationError('Pick which of the models the device is', {
      details: {
        issues: [{ path: 'model', message: `Must be one of ${choices.join(', ')}` }],
        choices,
      },
    });
  }

  return model;
}

/**
 * Composes what adopting a device adds, out of what the device said and what the owner decided.
 *
 * @param candidate - What discovery heard.
 * @param body - What the owner decided.
 * @returns The device to add, and which device identification must find.
 * @throws {ValidationError} When the model cannot be decided.
 */
export function adoptionOf(candidate: DiscoveredDevice, body: DiscoveryAdopt): Adoption {
  return {
    create: {
      id: body.id,
      kind: candidate.kind,
      model: modelOf(candidate, body.model),
      name: body.name,
      ...(body.icon === undefined ? {} : { icon: body.icon }),

      // The candidate's last: what the device announced it is reached at is not the body's to
      // change, and the body fills only what discovery could not - a token, a password.
      transportConfig: { ...body.transportConfig, ...candidate.transportConfig },
      options: body.options,
      isEnabled: true,
      ...(body.areaId === undefined ? {} : { areaId: body.areaId }),
      tagIds: body.tagIds,
    },
    expectedExternalId: candidate.externalId,
  };
}

/**
 * Reads what the hub proposes.
 *
 * @param context - The request's collaborators.
 * @returns Every device heard and not yet added.
 * @throws {DeviceUnavailableError} When the bus is not reachable or the hub did not answer.
 */
async function discoveredOn(context: IntegrationsContext): Promise<DiscoveredDevice[]> {
  const reply = await busOf(context).request(
    busSubjects.service(HUB_SERVICE, HUB_DISCOVERED_METHOD),
    {},
    discoveredReplySchema,
    { traceId: context.traceId },
  );

  return reply.items;
}

/**
 * Lists what the hub proposes, or nothing when it is not there to ask.
 *
 * A page that shows the proposals is a page that shows everything else too; a hub that is
 * restarting must not turn it into an error.
 *
 * @param context - The request's collaborators.
 * @returns Every device heard and not yet added; none when the hub did not answer.
 */
export async function listDiscovered(context: IntegrationsContext): Promise<DiscoveredDevice[]> {
  if (context.bus === undefined) {
    return [];
  }

  try {
    return await discoveredOn(context);
  } catch (error: unknown) {
    context.logger.warn({ err: error }, 'The hub did not answer for what it discovered');

    return [];
  }
}

/**
 * Adopts one discovered device.
 *
 * @param context - The request's collaborators.
 * @param candidateId - Which device, as the hub listed it.
 * @param body - What the owner decided.
 * @returns The device added, and the candidate it was adopted from.
 * @throws {NotFoundError} When the hub no longer proposes that device.
 * @throws {ConflictError} When the vendor still needs setting up, or a device already has the id.
 * @throws {ValidationError} When the model cannot be decided, or what the driver asks is missing.
 * @throws {DeviceUnavailableError} When the hub cannot be asked.
 */
export async function adoptDiscovered(
  context: DevicesContext,
  candidateId: string,
  body: DiscoveryAdopt,
): Promise<{ readonly device: DeviceView; readonly candidate: DiscoveredDevice }> {
  const candidate = (await discoveredOn(context)).find((each) => each.id === candidateId);

  if (candidate === undefined) {
    throw new NotFoundError('The hub does not propose that device, or no longer does', {
      details: { candidateId },
    });
  }

  const adoption = adoptionOf(candidate, body);
  const device = await createDevice(context, adoption.create, {
    expectedExternalId: adoption.expectedExternalId,
  });

  return { device, candidate };
}
