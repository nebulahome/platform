/**
 * The platform's own services the hub may start, stop and restart: today the OpenThread Border
 * Router (`otbr`), which waits until the Thread broker has written its radio and network.
 *
 * s6 supervises them (ARCHITECTURE.md 14): `s6-svc -u` brings one up, `-d` takes it down and keeps
 * it down, `-r` restarts it - how the border router reads a new `otbr.conf`. Which service is a
 * name from the contracts' hard-coded list, never a path a caller gives.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { ConflictError, type PlatformServiceRequest } from '@nebulahome/contracts';

/** Runs a program with its arguments: `execFile`, replaced in tests. */
export type ProgramRunner = (file: string, args: readonly string[]) => Promise<unknown>;

/** Where s6 keeps the services it supervises, in the platform's image. */
export const S6_SERVICE_DIR = '/run/service';

/** How long a service is given to go down before `stop` gives up. */
const STOP_TIMEOUT_MS = 20_000;

/**
 * The `s6-svc` options for each action. A restart also asks for the service up, so a service
 * taken down before starts again rather than staying down: `-r` alone acts only on one that is up.
 * A stop waits until the service is down, so the radio's serial port is free when it answers.
 */
const S6_OPTIONS: Record<PlatformServiceRequest['action'], readonly string[]> = {
  start: ['-u'],
  stop: ['-wD', '-T', String(STOP_TIMEOUT_MS), '-d'],
  restart: ['-r', '-u'],
};

const execFileAsync = promisify(execFile);

/**
 * Runs a program, giving up after the stop's own timeout and a margin.
 *
 * @param file - The program.
 * @param args - Its arguments.
 * @returns What it wrote.
 */
const runProgram: ProgramRunner = async (file, args) =>
  execFileAsync(file, [...args], { timeout: STOP_TIMEOUT_MS + 5000 });

/**
 * Starts, stops or restarts one of the platform's own services.
 *
 * @param request - Which service, and what to do to it.
 * @param serviceDir - Where s6 keeps its services.
 * @param run - How `s6-svc` is run.
 * @throws {ConflictError} When the service is not supervised here: outside the platform's image.
 */
export async function controlPlatformService(
  request: PlatformServiceRequest,
  serviceDir = S6_SERVICE_DIR,
  run: ProgramRunner = runProgram,
): Promise<void> {
  const directory = path.join(serviceDir, request.service);

  if (!existsSync(directory)) {
    throw new ConflictError(
      `The ${request.service} service is not supervised here: the platform is not running in its image`,
    );
  }

  await run('s6-svc', [...S6_OPTIONS[request.action], directory]);
}
