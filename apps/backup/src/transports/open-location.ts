/**
 * Opening a location, whatever its kind: the system folder, a local one, a share mounted for the
 * occasion, an FTP server.
 */
import {
  backupTargetInputSchema,
  localPathProblem,
  type BackupTargetInput,
  type JsonObject,
} from '@nebula-home/contracts';
import { openSecrets } from '@nebula-home/db';

import type { StoredLocation } from '../persistence/backup-store.js';

import { openFolder } from './filesystem.js';
import { openFtp } from './ftp.js';
import { mountShare } from './mount.js';
import type { LocationSession } from './session.js';

/** Where a location writes, its password in clear: what opening one needs. */
export type LocationTarget = { readonly kind: 'system' } | BackupTargetInput;

/** What opening a location needs besides the target. */
export type OpenDependencies = {
  /** The data directory's `backups/`: the system location. */
  readonly systemDirectory: string;

  /** The data directory, which no local location may be inside. */
  readonly dataDirectory: string;

  /** Where shares are mounted. */
  readonly mountRoot: string;

  /** How long a connection or a mount may take. */
  readonly timeoutMs: number;
};

/**
 * A stored location's target, its password opened.
 *
 * @param location - The location as stored.
 * @param secretsKey - The instance's secrets key.
 * @returns The target.
 * @throws {Error} When the stored settings no longer parse.
 */
export function targetOf(location: StoredLocation, secretsKey: Buffer): LocationTarget {
  if (location.kind === 'system') {
    return { kind: 'system' };
  }

  const opened: JsonObject = openSecrets(location.config, secretsKey);

  return backupTargetInputSchema.parse({ ...opened, kind: location.kind });
}

/**
 * Opens a location.
 *
 * @param target - Where it writes.
 * @param dependencies - See {@link OpenDependencies}.
 * @returns The session; the caller closes it.
 */
export async function openLocation(
  target: LocationTarget,
  dependencies: OpenDependencies,
): Promise<LocationSession> {
  switch (target.kind) {
    case 'system':
      return openFolder(dependencies.systemDirectory);

    case 'local': {
      const problem = localPathProblem(target.path, dependencies.dataDirectory);

      if (problem !== null) {
        throw new Error(problem);
      }

      return openFolder(target.path);
    }

    case 'ftp':
      return openFtp({ ...target, password: target.password ?? '' }, dependencies.timeoutMs);

    case 'smb':
    case 'nfs': {
      const mounted = await mountShare(
        target.kind,
        target.kind === 'smb' ? { ...target, password: target.password ?? '' } : target,
        { mountRoot: dependencies.mountRoot, timeoutMs: dependencies.timeoutMs },
      );

      try {
        return await openFolder(mounted.directory, mounted.unmount);
      } catch (error: unknown) {
        await mounted.unmount();

        throw error;
      }
    }
  }
}
