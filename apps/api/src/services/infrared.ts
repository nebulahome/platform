/**
 * The house's Infrared broker, read through and driven: `hub` holds it (ARCHITECTURE.md 4.2).
 *
 * Everything here is a question to the hub. What it adds is what the house's own rows need: a
 * new remote's device is put in the room the owner picked - the hub never writes a device row,
 * so the room goes through the ordinary device update - and removing a remote removes its device
 * the way any device is removed, then the broker forgets the remote. Icons are checked against
 * the catalogue here, as for a Modbus template.
 */
import type { z } from 'zod';

import {
  busSubjects,
  HUB_INFRARED_BLASTERS_METHOD,
  HUB_INFRARED_BUTTON_MOVE_METHOD,
  HUB_INFRARED_BUTTON_PRESS_METHOD,
  HUB_INFRARED_BUTTON_REMOVE_METHOD,
  HUB_INFRARED_BUTTON_SAVE_METHOD,
  HUB_INFRARED_CODE_FORMATS_METHOD,
  HUB_INFRARED_IMPORT_METHOD,
  HUB_INFRARED_IMPORT_PARSE_METHOD,
  HUB_INFRARED_LEARN_CANCEL_METHOD,
  HUB_INFRARED_LEARN_JOB_METHOD,
  HUB_INFRARED_LEARN_METHOD,
  HUB_INFRARED_REMOTE_METHOD,
  HUB_INFRARED_REMOTE_REMOVE_METHOD,
  HUB_INFRARED_REMOTE_SAVE_METHOD,
  HUB_INFRARED_REMOTES_METHOD,
  HUB_INFRARED_STATUS_METHOD,
  HUB_INFRARED_TEST_METHOD,
  HUB_SERVICE,
  infraredBlastersReplySchema,
  infraredButtonPressReplySchema,
  infraredButtonSchema,
  infraredCodeFormatsReplySchema,
  infraredImportParseReplySchema,
  infraredLearnJobSchema,
  infraredRemoteDetailSchema,
  infraredRemoteSchema,
  infraredRemotesReplySchema,
  infraredRemoveReplySchema,
  infraredStatusSchema,
  NotFoundError,
  ValidationError,
  type InfraredButtonSaveRequest,
  type InfraredRemote,
  type InfraredRemoteSaveRequest,
  type InfraredStatus,
} from '@nebulahome/contracts';

import { deleteDevice, updateDevice, type DevicesContext, type RemovedDevice } from './devices.js';
import type { IconLookup } from './icon-lookup.js';
import { busOf, type IntegrationsContext } from './integrations.js';

/**
 * How long saving a new remote may take: the hub waits up to 15 s for the house to have its
 * device, which the api's own discovery adoption does meanwhile.
 */
const REMOTE_SAVE_TIMEOUT_MS = 20_000;

/** How long sending through a blaster may take: the hub gives it 10 s. */
const BLASTER_TIMEOUT_MS = 15_000;

/**
 * Asks the hub one of the broker's methods.
 *
 * @param context - The request's collaborators.
 * @param method - The method.
 * @param body - What it is asked.
 * @param schema - What the answer must be.
 * @param timeoutMs - How long the hub has; the service's usual wait unless the method needs more.
 * @returns The answer.
 * @throws {DeviceUnavailableError} When the hub cannot be asked.
 */
export async function askInfrared<TSchema extends z.ZodType>(
  context: IntegrationsContext,
  method: string,
  body: object,
  schema: TSchema,
  timeoutMs = context.timeoutMs,
): Promise<z.output<TSchema>> {
  return busOf(context).request(busSubjects.service(HUB_SERVICE, method), body, schema, {
    traceId: context.traceId,
    timeoutMs,
  });
}

/**
 * Checks icons a request names against the catalogue.
 *
 * @param icons - The catalogue.
 * @param named - Each icon with the path it was sent at.
 * @throws {ValidationError} When one is not in it.
 */
function checkIcons(
  icons: IconLookup,
  named: readonly { readonly path: string; readonly icon: string | null }[],
): void {
  const issues = named
    .filter(({ icon }) => icon !== null && !icons.has(icon))
    .map(({ path, icon }) => ({ path, message: `No icon has the id ${String(icon)}` }));

  if (issues.length > 0) {
    throw new ValidationError('An icon is not in the catalogue', { details: { issues } });
  }
}

/**
 * Where the broker stands.
 *
 * @param context - The request's collaborators.
 * @returns Its state.
 */
export async function infraredStatus(context: IntegrationsContext): Promise<InfraredStatus> {
  return askInfrared(context, HUB_INFRARED_STATUS_METHOD, {}, infraredStatusSchema);
}

/**
 * The IR-capable devices the integrations provide.
 *
 * @param context - The request's collaborators.
 * @returns Them, by name.
 */
export async function infraredBlasters(context: IntegrationsContext) {
  return askInfrared(context, HUB_INFRARED_BLASTERS_METHOD, {}, infraredBlastersReplySchema);
}

/**
 * Every remote, without its buttons.
 *
 * @param context - The request's collaborators.
 * @returns Them, by name.
 */
export async function infraredRemotes(context: IntegrationsContext) {
  return askInfrared(context, HUB_INFRARED_REMOTES_METHOD, {}, infraredRemotesReplySchema);
}

/**
 * One remote, with its buttons.
 *
 * @param context - The request's collaborators.
 * @param id - The remote.
 * @returns It, its buttons by cell.
 */
export async function infraredRemote(context: IntegrationsContext, id: string) {
  return askInfrared(context, HUB_INFRARED_REMOTE_METHOD, { id }, infraredRemoteDetailSchema);
}

/**
 * Saves a remote, new or changed. A new one's device is put in the room asked for once the house
 * has it; afterwards the room is the device's own.
 *
 * @param context - The request's collaborators.
 * @param request - The remote, checked.
 * @returns It, as the page lists it.
 * @throws {NotFoundError} When there is no such remote, or the blaster is not one.
 */
export async function saveInfraredRemote(
  context: DevicesContext,
  request: InfraredRemoteSaveRequest,
): Promise<InfraredRemote> {
  const saved = await askInfrared(
    context,
    HUB_INFRARED_REMOTE_SAVE_METHOD,
    request,
    infraredRemoteSchema,
    REMOTE_SAVE_TIMEOUT_MS,
  );
  const areaId = request.areaId ?? null;

  // A device not added in time keeps no room: the remote is saved all the same, and its device
  // is put in a room from its own page.
  if (request.id !== undefined || saved.deviceId === null || areaId === null) {
    return saved;
  }

  await updateDevice(context, saved.deviceId, { areaId });

  return { ...saved, areaId };
}

/**
 * Removes a remote: its device from the house, then the remote from the broker.
 *
 * @param context - The request's collaborators.
 * @param id - The remote.
 * @returns The device removed from the house, if it was added.
 * @throws {NotFoundError} When the broker has no such remote.
 */
export async function removeInfraredRemote(
  context: DevicesContext,
  id: string,
): Promise<{ readonly name: string; readonly removed: RemovedDevice | null }> {
  const remote = (await infraredRemotes(context)).items.find((each) => each.id === id);

  if (remote === undefined) {
    throw new NotFoundError('The Infrared broker has no such remote', { details: { id } });
  }

  // Removing the device from the house lets the broker forget the remote too; the request after
  // it is for a remote never added.
  const removed = remote.deviceId === null ? null : await deleteDevice(context, remote.deviceId);

  await askInfrared(context, HUB_INFRARED_REMOTE_REMOVE_METHOD, { id }, infraredRemoveReplySchema);

  return { name: remote.name, removed };
}

/**
 * Saves a button, new or changed; a duplicate is a new one with the same code.
 *
 * @param context - The request's collaborators.
 * @param request - The button, checked.
 * @returns It.
 * @throws {ValidationError} When its icon is not in the catalogue.
 * @throws {ConflictError} When the cell is held, or the remote is full.
 */
export async function saveInfraredButton(
  context: IntegrationsContext & { readonly icons: IconLookup },
  request: InfraredButtonSaveRequest,
) {
  checkIcons(context.icons, [{ path: 'icon', icon: request.icon }]);

  return askInfrared(context, HUB_INFRARED_BUTTON_SAVE_METHOD, request, infraredButtonSchema);
}

/**
 * Moves a button to an empty cell.
 *
 * @param context - The request's collaborators.
 * @param request - The button, and the cell.
 * @returns It, moved.
 * @throws {ConflictError} When the cell is held.
 */
export async function moveInfraredButton(context: IntegrationsContext, request: object) {
  return askInfrared(context, HUB_INFRARED_BUTTON_MOVE_METHOD, request, infraredButtonSchema);
}

/**
 * Removes a button.
 *
 * @param context - The request's collaborators.
 * @param id - The button.
 * @throws {NotFoundError} When there is no such button.
 */
export async function removeInfraredButton(context: IntegrationsContext, id: string) {
  const reply = await askInfrared(
    context,
    HUB_INFRARED_BUTTON_REMOVE_METHOD,
    { id },
    infraredRemoveReplySchema,
  );

  if (!reply.isRemoved) {
    throw new NotFoundError('The Infrared broker has no such button', { details: { id } });
  }
}

/**
 * Sends a saved button's code through its remote's blaster.
 *
 * @param context - The request's collaborators.
 * @param id - The button.
 * @returns When it was sent.
 * @throws {ConflictError} When the remote has no blaster, or it is offline or refused.
 */
export async function pressInfraredButton(context: IntegrationsContext, id: string) {
  return askInfrared(
    context,
    HUB_INFRARED_BUTTON_PRESS_METHOD,
    { id },
    infraredButtonPressReplySchema,
    BLASTER_TIMEOUT_MS,
  );
}

/**
 * Sends a code not saved yet through a blaster.
 *
 * @param context - The request's collaborators.
 * @param request - The blaster, and the code.
 * @returns When it was sent.
 */
export async function testInfrared(context: IntegrationsContext, request: object) {
  return askInfrared(
    context,
    HUB_INFRARED_TEST_METHOD,
    request,
    infraredButtonPressReplySchema,
    BLASTER_TIMEOUT_MS,
  );
}

/**
 * Starts learning a code on a blaster.
 *
 * @param context - The request's collaborators.
 * @param request - The blaster, the signal and how long it listens.
 * @returns The job, listening.
 */
export async function learnInfrared(context: IntegrationsContext, request: object) {
  return askInfrared(context, HUB_INFRARED_LEARN_METHOD, request, infraredLearnJobSchema);
}

/**
 * Reads a learn job.
 *
 * @param context - The request's collaborators.
 * @param jobId - The job.
 * @returns It.
 */
export async function infraredLearnJob(context: IntegrationsContext, jobId: string) {
  return askInfrared(context, HUB_INFRARED_LEARN_JOB_METHOD, { jobId }, infraredLearnJobSchema);
}

/**
 * Stops a learn job before it captured anything.
 *
 * @param context - The request's collaborators.
 * @param jobId - The job.
 * @returns It, cancelled.
 */
export async function cancelInfraredLearn(context: IntegrationsContext, jobId: string) {
  return askInfrared(
    context,
    HUB_INFRARED_LEARN_CANCEL_METHOD,
    { jobId },
    infraredLearnJobSchema,
    BLASTER_TIMEOUT_MS,
  );
}

/**
 * Reads pasted or dropped codes.
 *
 * @param context - The request's collaborators.
 * @param request - The text, and the file's name.
 * @returns The codes found, and what was not understood.
 */
export async function parseInfraredImport(context: IntegrationsContext, request: object) {
  return askInfrared(
    context,
    HUB_INFRARED_IMPORT_PARSE_METHOD,
    request,
    infraredImportParseReplySchema,
  );
}

/**
 * Adds the codes kept from an import as buttons of a remote.
 *
 * @param context - The request's collaborators.
 * @param request - The remote, and the buttons.
 * @param request.remoteId - The remote.
 * @param request.items - The buttons, each with its icon.
 * @returns The remote, with its buttons.
 * @throws {ValidationError} When an icon is not in the catalogue.
 * @throws {ConflictError} When they do not all fit; none is added.
 */
export async function importInfrared(
  context: IntegrationsContext & { readonly icons: IconLookup },
  request: {
    readonly remoteId: string;
    readonly items: readonly { readonly icon: string | null }[];
  },
) {
  checkIcons(
    context.icons,
    request.items.map((item, index) => ({ path: `items.${String(index)}.icon`, icon: item.icon })),
  );

  return askInfrared(context, HUB_INFRARED_IMPORT_METHOD, request, infraredRemoteDetailSchema);
}

/**
 * A code in each format Show code copies it as.
 *
 * @param context - The request's collaborators.
 * @param request - The code.
 * @returns The formats, and what the code reads as.
 */
export async function infraredCodeFormats(context: IntegrationsContext, request: object) {
  return askInfrared(
    context,
    HUB_INFRARED_CODE_FORMATS_METHOD,
    request,
    infraredCodeFormatsReplySchema,
  );
}
