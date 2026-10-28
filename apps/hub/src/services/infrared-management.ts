/**
 * The Infrared broker on the bus: what the Brokers page and a remote's page read and ask, through
 * `api`.
 *
 * `svc.hub.infrared_status`, `infrared_blasters`, `infrared_remotes` and `infrared_remote` read;
 * `infrared_remote_save` saves a remote - a new one answers once its device is in the house - and
 * `infrared_remote_remove` removes one, after `api` removed its device. `infrared_button_save`,
 * `_move`, `_remove` and `_press` change and send buttons; Duplicate is a save of a new button
 * with the same code. `infrared_test` sends a code not saved yet; `infrared_learn` starts a learn
 * job read with `infrared_learn_job` and stopped with `infrared_learn_cancel`.
 * `infrared_import_parse` reads pasted codes or a dropped file, `infrared_import` adds the ones
 * kept, and `infrared_code_formats` writes a code as Show code copies it.
 */
import { z } from 'zod';

import type { BusClient, BusSubscription } from '@nebulahome/bus';
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
  infraredButtonMoveRequestSchema,
  infraredButtonSaveRequestSchema,
  infraredCodeFormatsRequestSchema,
  infraredIdRequestSchema,
  infraredImportParseRequestSchema,
  infraredImportRequestSchema,
  infraredLearnJobRequestSchema,
  infraredLearnRequestSchema,
  infraredRemoteSaveRequestSchema,
  infraredTestRequestSchema,
} from '@nebulahome/contracts';

import type { InfraredBroker } from '../infrared/broker.js';
import { infraredCodeFormats, parseInfraredImport } from '../infrared/codes.js';

/**
 * Serves the Infrared broker's methods.
 *
 * @param client - The hub's bus client.
 * @param broker - The broker.
 * @returns The subscriptions, to drop on stop.
 */
export function serveInfrared(client: BusClient, broker: InfraredBroker): BusSubscription[] {
  /**
   * One method of the broker's.
   *
   * @param method - Its name.
   * @returns Its subject.
   */
  const subject = (method: string): string => busSubjects.service(HUB_SERVICE, method);

  return [
    client.serve(
      subject(HUB_INFRARED_STATUS_METHOD),
      z.object({}),

      /**
       * Says where the broker stands.
       *
       * @returns Its status.
       */
      async () => broker.status(),
    ),

    client.serve(
      subject(HUB_INFRARED_BLASTERS_METHOD),
      z.object({}),

      /**
       * Lists the blasters.
       *
       * @returns Them, by name.
       */
      async () => ({ items: await broker.blasters() }),
    ),

    client.serve(
      subject(HUB_INFRARED_REMOTES_METHOD),
      z.object({}),

      /**
       * Lists the remotes.
       *
       * @returns Them, by name, without their buttons.
       */
      async () => ({ items: await broker.remotes() }),
    ),

    client.serve(
      subject(HUB_INFRARED_REMOTE_METHOD),
      infraredIdRequestSchema,

      /**
       * Reads one remote.
       *
       * @param request - The remote.
       * @returns It, with its buttons.
       */
      async (request) => broker.remote(request.id),
    ),

    client.serve(
      subject(HUB_INFRARED_REMOTE_SAVE_METHOD),
      infraredRemoteSaveRequestSchema,

      /**
       * Saves a remote, new or changed.
       *
       * @param request - The remote.
       * @returns It; a new one with its device once added.
       */
      async (request) => broker.saveRemote(request),
    ),

    client.serve(
      subject(HUB_INFRARED_REMOTE_REMOVE_METHOD),
      infraredIdRequestSchema,

      /**
       * Removes a remote and its buttons.
       *
       * @param request - The remote.
       * @returns Whether there was one.
       */
      async (request) => ({ isRemoved: await broker.removeRemote(request.id) }),
    ),

    client.serve(
      subject(HUB_INFRARED_BUTTON_SAVE_METHOD),
      infraredButtonSaveRequestSchema,

      /**
       * Saves a button, new or changed.
       *
       * @param request - The button.
       * @returns It, saved.
       */
      async (request) => broker.saveButton(request),
    ),

    client.serve(
      subject(HUB_INFRARED_BUTTON_MOVE_METHOD),
      infraredButtonMoveRequestSchema,

      /**
       * Moves a button to an empty cell.
       *
       * @param request - The button, and the cell.
       * @returns It, moved.
       */
      async (request) => broker.moveButton(request.id, request.cell),
    ),

    client.serve(
      subject(HUB_INFRARED_BUTTON_REMOVE_METHOD),
      infraredIdRequestSchema,

      /**
       * Removes a button.
       *
       * @param request - The button.
       * @returns Whether there was one.
       */
      async (request) => ({ isRemoved: await broker.removeButton(request.id) }),
    ),

    client.serve(
      subject(HUB_INFRARED_BUTTON_PRESS_METHOD),
      infraredIdRequestSchema,

      /**
       * Sends a button.
       *
       * @param request - The button.
       * @returns When it was sent.
       */
      async (request) => broker.press(request.id),
    ),

    client.serve(
      subject(HUB_INFRARED_TEST_METHOD),
      infraredTestRequestSchema,

      /**
       * Sends a code not saved yet.
       *
       * @param request - The blaster, and the code.
       * @returns When it was sent.
       */
      async (request) => broker.test(request.blasterId, request.code),
    ),

    client.serve(
      subject(HUB_INFRARED_LEARN_METHOD),
      infraredLearnRequestSchema,

      /**
       * Starts learning a code.
       *
       * @param request - The blaster, the signal, and how long it listens.
       * @returns The job, running.
       */
      (request) => broker.learn(request.blasterId, request.signal, request.timeoutMs),
    ),

    client.serve(
      subject(HUB_INFRARED_LEARN_JOB_METHOD),
      infraredLearnJobRequestSchema,

      /**
       * Reads a learn job.
       *
       * @param request - The job.
       * @returns It.
       */
      (request) => broker.job(request.jobId),
    ),

    client.serve(
      subject(HUB_INFRARED_LEARN_CANCEL_METHOD),
      infraredLearnJobRequestSchema,

      /**
       * Stops a learn job.
       *
       * @param request - The job.
       * @returns It, cancelled.
       */
      async (request) => broker.cancel(request.jobId),
    ),

    client.serve(
      subject(HUB_INFRARED_IMPORT_PARSE_METHOD),
      infraredImportParseRequestSchema,

      /**
       * Reads pasted codes or a dropped file.
       *
       * @param request - The text, and the file's name.
       * @returns The codes found, and what was not understood.
       */
      (request) => parseInfraredImport(request.text, request.fileName),
    ),

    client.serve(
      subject(HUB_INFRARED_IMPORT_METHOD),
      infraredImportRequestSchema,

      /**
       * Adds the codes kept as buttons.
       *
       * @param request - The remote, and the codes.
       * @returns The remote, with its buttons.
       */
      async (request) => broker.importButtons(request.remoteId, request.items),
    ),

    client.serve(
      subject(HUB_INFRARED_CODE_FORMATS_METHOD),
      infraredCodeFormatsRequestSchema,

      /**
       * Writes a code in every format Show code copies.
       *
       * @param request - The code.
       * @returns The formats.
       */
      (request) => infraredCodeFormats(request.code),
    ),
  ];
}
