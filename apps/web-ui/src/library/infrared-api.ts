/**
 * The house's Infrared broker, as its pages read and drive it (`/api/v1/brokers/infrared`): the
 * blasters integrations provide, the remotes learned through them and each remote's buttons, the
 * learn jobs, and the import of codes written down elsewhere.
 */
import { z } from 'zod';

import {
  infraredBlastersReplySchema,
  infraredButtonPressReplySchema,
  infraredButtonSchema,
  infraredCodeFormatsReplySchema,
  infraredImportParseReplySchema,
  infraredLearnJobSchema,
  infraredRemoteDetailSchema,
  infraredRemoteSchema,
  infraredRemotesReplySchema,
  infraredStatusSchema,
  type InfraredBlaster,
  type InfraredButton,
  type InfraredButtonSaveRequest,
  type InfraredCode,
  type InfraredLearnJob,
  type InfraredRemote,
  type InfraredRemoteDetail,
  type InfraredRemoteSaveRequest,
  type InfraredSignal,
  type InfraredStatus,
} from '@nebulahome/contracts';

import { apiRequest } from '@/lib/api-client';

/** The keys the broker is cached under: below `brokers`, so reading the brokers again reads it. */
export const INFRARED_QUERY_KEYS = {
  status: ['brokers', 'infrared', 'status'] as const,
  blasters: ['brokers', 'infrared', 'blasters'] as const,
  remotes: ['brokers', 'infrared', 'remotes'] as const,
  remote: ['brokers', 'infrared', 'remote'] as const,
  learn: ['brokers', 'infrared', 'learn'] as const,
};

/**
 * The options of a read: its abort signal, when it has one.
 *
 * @param signal - Cancels the request.
 * @returns The options.
 */
function readOptions(signal: AbortSignal | undefined) {
  return signal === undefined ? {} : { signal };
}

/**
 * Reads where the broker stands.
 *
 * @param signal - Cancels the request.
 * @returns Its state, the blasters online, the last code sent and who is listening.
 */
export async function fetchInfraredStatus(signal?: AbortSignal): Promise<InfraredStatus> {
  return apiRequest('/brokers/infrared', infraredStatusSchema, readOptions(signal));
}

/**
 * Lists the blasters the integrations provide.
 *
 * @param signal - Cancels the request.
 * @returns Them, by name.
 */
export async function fetchInfraredBlasters(signal?: AbortSignal): Promise<InfraredBlaster[]> {
  return (
    await apiRequest('/brokers/infrared/blasters', infraredBlastersReplySchema, readOptions(signal))
  ).items;
}

/**
 * Lists the remotes.
 *
 * @param signal - Cancels the request.
 * @returns Them, by name.
 */
export async function fetchInfraredRemotes(signal?: AbortSignal): Promise<InfraredRemote[]> {
  return (
    await apiRequest('/brokers/infrared/remotes', infraredRemotesReplySchema, readOptions(signal))
  ).items;
}

/**
 * Reads one remote with its buttons.
 *
 * @param id - The remote.
 * @param signal - Cancels the request.
 * @returns It, its buttons by cell.
 */
export async function fetchInfraredRemote(
  id: string,
  signal?: AbortSignal,
): Promise<InfraredRemoteDetail> {
  return apiRequest(
    `/brokers/infrared/remotes/${encodeURIComponent(id)}`,
    infraredRemoteDetailSchema,
    readOptions(signal),
  );
}

/**
 * Adds a remote, or changes one: its name, kind, room or blaster.
 *
 * @param remote - The remote; a new one without an id.
 * @returns It, saved.
 */
export async function saveInfraredRemote(
  remote: Omit<InfraredRemoteSaveRequest, 'columns'> & { readonly columns?: number },
): Promise<InfraredRemote> {
  return apiRequest('/brokers/infrared/remotes', infraredRemoteSchema, {
    method: 'POST',
    body: remote,
  });
}

/**
 * Removes a remote, its device and its buttons.
 *
 * @param id - The remote.
 */
export async function removeInfraredRemote(id: string): Promise<void> {
  await apiRequest(`/brokers/infrared/remotes/${encodeURIComponent(id)}`, z.undefined(), {
    method: 'DELETE',
  });
}

/**
 * Saves a button: a new one (a learned code, or a duplicate), or one renamed or learned again.
 *
 * @param button - The button.
 * @returns It, saved, in its cell.
 */
export async function saveInfraredButton(
  button: Omit<InfraredButtonSaveRequest, 'icon'> & { readonly icon?: string | null },
): Promise<InfraredButton> {
  return apiRequest('/brokers/infrared/buttons', infraredButtonSchema, {
    method: 'POST',
    body: button,
  });
}

/**
 * Moves a button to an empty cell.
 *
 * @param id - The button.
 * @param cell - The cell.
 * @returns It, moved.
 */
export async function moveInfraredButton(id: string, cell: number): Promise<InfraredButton> {
  return apiRequest(
    `/brokers/infrared/buttons/${encodeURIComponent(id)}/move`,
    infraredButtonSchema,
    { method: 'POST', body: { cell } },
  );
}

/**
 * Removes a button.
 *
 * @param id - The button.
 */
export async function removeInfraredButton(id: string): Promise<void> {
  await apiRequest(`/brokers/infrared/buttons/${encodeURIComponent(id)}`, z.undefined(), {
    method: 'DELETE',
  });
}

/**
 * Sends a button through its remote's blaster.
 *
 * @param id - The button.
 * @returns When it went.
 */
export async function pressInfraredButton(id: string): Promise<Date> {
  return (
    await apiRequest(
      `/brokers/infrared/buttons/${encodeURIComponent(id)}/press`,
      infraredButtonPressReplySchema,
      { method: 'POST' },
    )
  ).pressedAt;
}

/**
 * Sends a code not saved yet, as a test.
 *
 * @param blasterId - Through which blaster.
 * @param code - The code.
 * @returns When it went.
 */
export async function testInfraredCode(blasterId: string, code: InfraredCode): Promise<Date> {
  return (
    await apiRequest('/brokers/infrared/test', infraredButtonPressReplySchema, {
      method: 'POST',
      body: { blasterId, code },
    })
  ).pressedAt;
}

/**
 * Starts listening on a blaster for one button.
 *
 * @param blasterId - The blaster.
 * @param signal - Infrared, or radio at 433 MHz.
 * @returns The job.
 */
export async function learnInfrared(
  blasterId: string,
  signal: InfraredSignal,
): Promise<InfraredLearnJob> {
  return apiRequest('/brokers/infrared/learn', infraredLearnJobSchema, {
    method: 'POST',
    body: { blasterId, signal },
  });
}

/**
 * Reads a learn job.
 *
 * @param jobId - The job.
 * @param signal - Cancels the request.
 * @returns Where it stands.
 */
export async function fetchInfraredLearnJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<InfraredLearnJob> {
  return apiRequest(
    `/brokers/infrared/learn/jobs/${encodeURIComponent(jobId)}`,
    infraredLearnJobSchema,
    readOptions(signal),
  );
}

/**
 * Stops listening.
 *
 * @param jobId - The job.
 * @returns It, cancelled.
 */
export async function cancelInfraredLearn(jobId: string): Promise<InfraredLearnJob> {
  return apiRequest(
    `/brokers/infrared/learn/jobs/${encodeURIComponent(jobId)}/cancel`,
    infraredLearnJobSchema,
    { method: 'POST' },
  );
}

/**
 * Reads codes written down elsewhere: pasted lines, or a Flipper Zero file.
 *
 * @param text - What was pasted or dropped.
 * @param fileName - The dropped file's name, when one was.
 * @returns The codes understood, and the lines that were not.
 */
export async function parseInfraredImport(text: string, fileName?: string) {
  return apiRequest('/brokers/infrared/import/parse', infraredImportParseReplySchema, {
    method: 'POST',
    body: fileName === undefined ? { text } : { text, fileName },
  });
}

/**
 * Adds codes to a remote as buttons, in its next empty cells.
 *
 * @param remoteId - The remote.
 * @param items - The buttons.
 * @returns The remote, with them.
 */
export async function importInfraredButtons(
  remoteId: string,
  items: readonly { readonly name: string; readonly code: InfraredCode }[],
): Promise<InfraredRemoteDetail> {
  return apiRequest('/brokers/infrared/import', infraredRemoteDetailSchema, {
    method: 'POST',
    body: { remoteId, items },
  });
}

/**
 * A code in the formats other tools write, and what it is.
 *
 * @param code - The code.
 * @returns Broadlink base64, Pronto and raw timings, its protocol and its pulses.
 */
export async function fetchInfraredCodeFormats(code: InfraredCode) {
  return apiRequest('/brokers/infrared/codes/formats', infraredCodeFormatsReplySchema, {
    method: 'POST',
    body: { code },
  });
}
