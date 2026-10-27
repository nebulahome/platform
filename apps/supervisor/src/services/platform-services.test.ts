/**
 * Starting, stopping and restarting the platform's own services: the `s6-svc` each action runs,
 * and a refusal where s6 does not supervise them.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConflictError } from '@nebulahome/contracts';

import { controlPlatformService, type ProgramRunner } from './platform-services.js';

describe('controlPlatformService', () => {
  let serviceDir: string;
  let calls: { file: string; args: readonly string[] }[];

  /**
   * Records what it is asked to run.
   *
   * @param file - The program.
   * @param args - Its arguments.
   * @returns Nothing of note.
   */
  const run: ProgramRunner = async (file, args) => {
    calls.push({ file, args });

    return Promise.resolve();
  };

  beforeEach(() => {
    serviceDir = mkdtempSync(path.join(os.tmpdir(), 'nebula-s6-'));
    calls = [];
  });

  afterEach(() => {
    rmSync(serviceDir, { recursive: true, force: true });
  });

  it('runs s6-svc on the service for each action', async () => {
    mkdirSync(path.join(serviceDir, 'otbr'));
    const otbr = path.join(serviceDir, 'otbr');

    await controlPlatformService({ service: 'otbr', action: 'start' }, serviceDir, run);
    await controlPlatformService({ service: 'otbr', action: 'restart' }, serviceDir, run);
    await controlPlatformService({ service: 'otbr', action: 'stop' }, serviceDir, run);

    expect(calls).toEqual([
      { file: 's6-svc', args: ['-u', otbr] },
      { file: 's6-svc', args: ['-r', '-u', otbr] },
      { file: 's6-svc', args: ['-wD', '-T', '20000', '-d', otbr] },
    ]);
  });

  it('refuses where s6 does not supervise the service', async () => {
    await expect(
      controlPlatformService({ service: 'otbr', action: 'restart' }, serviceDir, run),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(calls).toEqual([]);
  });
});
