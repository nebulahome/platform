/**
 * SMB shares and NFS exports, mounted for as long as a backup writes to them.
 *
 * The system's own clients - `mount.cifs`, `mount.nfs` - rather than a client in JavaScript:
 * they speak every dialect the servers do (SMB 3 with encryption, NFS 4). That needs root and,
 * in a container, `CAP_SYS_ADMIN` - which is why the backup
 * service runs as root, and says what is missing when a mount is refused.
 *
 * Nothing the owner typed reaches the command line as an option: the host, the share and the
 * path are checked to be plain names (contracts/backup.ts), the options are built from fixed
 * values, and the SMB user and password go in a credentials file - mode 0600, removed the moment
 * the mount returns - never in the arguments another process could read.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { joinRemote } from './session.js';

const run = promisify(execFile);

/** An SMB location's settings, with its password in clear. */
export type SmbTarget = {
  readonly host: string;
  readonly share: string;
  readonly path: string;
  readonly username: string;
  readonly password: string;
  readonly domain: string;
  readonly version: string;
};

/** An NFS location's settings. */
export type NfsTarget = {
  readonly host: string;
  readonly export: string;
  readonly path: string;
  readonly version: string;
};

/** Options every mount takes: nothing on a share is run, or treated as a device. */
const SAFE_OPTIONS = ['nosuid', 'nodev', 'noexec'] as const;

/**
 * The arguments that mount an SMB share.
 *
 * @param target - The share.
 * @param mountpoint - Where.
 * @param credentialsFile - The file with the user and password, or null for a guest.
 * @returns The arguments to `mount`.
 */
export function smbMountArguments(
  target: SmbTarget,
  mountpoint: string,
  credentialsFile: string | null,
): string[] {
  const options = [
    credentialsFile === null ? 'guest' : `credentials=${credentialsFile}`,
    ...(target.version === 'auto' ? [] : [`vers=${target.version}`]),
    'uid=0',
    'gid=0',
    'file_mode=0644',
    'dir_mode=0755',
    'iocharset=utf8',
    'noserverino',
    ...SAFE_OPTIONS,
  ];

  return ['-t', 'cifs', `//${target.host}/${target.share}`, mountpoint, '-o', options.join(',')];
}

/**
 * The arguments that mount an NFS export.
 *
 * Soft, with a short timeout: a server that went away fails the backup in seconds instead of
 * leaving a process waiting on it for ever.
 *
 * @param target - The export.
 * @param mountpoint - Where.
 * @returns The arguments to `mount`.
 */
export function nfsMountArguments(target: NfsTarget, mountpoint: string): string[] {
  const host = target.host.includes(':') ? `[${target.host}]` : target.host;
  const options = [
    'soft',
    'timeo=100',
    'retrans=2',
    ...(target.version === 'auto' ? [] : [`vers=${target.version}`]),
    ...SAFE_OPTIONS,
  ];

  return ['-t', 'nfs', `${host}:${target.export}`, mountpoint, '-o', options.join(',')];
}

/**
 * What an SMB credentials file says.
 *
 * @param target - The share.
 * @returns The file's text.
 * @throws {Error} When the user or password holds a line break, which the format cannot carry.
 */
export function smbCredentials(target: SmbTarget): string {
  if (/[\r\n]/u.test(target.username) || /[\r\n]/u.test(target.password)) {
    throw new Error('A user name or password for a share cannot contain a line break');
  }

  return [
    `username=${target.username}`,
    `password=${target.password}`,
    ...(target.domain === '' ? [] : [`domain=${target.domain}`]),
    '',
  ].join('\n');
}

/**
 * Whether shares can be mounted here, and why not when they cannot.
 *
 * @returns Null when they can; otherwise what is missing.
 */
export function mountProblem(): string | null {
  if (process.platform !== 'linux') {
    return 'Shares are mounted only on Linux, in the NebulaHome container';
  }

  if (process.getuid?.() !== 0) {
    return 'Mounting a share needs the backup service to run as root';
  }

  if (!['/sbin/mount.cifs', '/usr/sbin/mount.cifs'].some((file) => existsSync(file))) {
    return 'The SMB client (cifs-utils) is not installed';
  }

  return null;
}

/**
 * Explains a refused mount in words an owner can act on.
 *
 * @param message - What `mount` said.
 * @returns The message, with what to do when the container lacks the capability.
 */
function explain(message: string): string {
  if (/Operation not permitted|permission denied.*mount|must be superuser/iu.test(message)) {
    return `${message.trim()} - the container needs cap_add SYS_ADMIN (and, with AppArmor, security_opt apparmor:unconfined)`;
  }

  return message.trim();
}

/** A mounted share. */
export type Mounted = {
  /** The folder a backup writes into: the share, and the path inside it. */
  readonly directory: string;

  /** Unmounts it. */
  readonly unmount: () => Promise<void>;
};

/**
 * Mounts a share.
 *
 * @param kind - SMB or NFS.
 * @param target - The share.
 * @param options - Where mounts go, and how long one may take.
 * @param options.mountRoot - The folder mountpoints are made in.
 * @param options.timeoutMs - How long the mount may take.
 * @returns The mounted share.
 */
export async function mountShare(
  kind: 'smb' | 'nfs',
  target: SmbTarget | NfsTarget,
  options: { readonly mountRoot: string; readonly timeoutMs: number },
): Promise<Mounted> {
  const problem = mountProblem();

  if (problem !== null) {
    throw new Error(problem);
  }

  const mountpoint = path.join(options.mountRoot, randomUUID());

  await mkdir(mountpoint, { recursive: true, mode: 0o700 });

  let credentialsDir: string | null = null;

  try {
    let args: string[];

    if (kind === 'smb') {
      const smb = target as SmbTarget;

      if (smb.username === '') {
        args = smbMountArguments(smb, mountpoint, null);
      } else {
        credentialsDir = await mkdtemp(path.join(tmpdir(), 'nebula-smb-'));

        const file = path.join(credentialsDir, 'credentials');

        await writeFile(file, smbCredentials(smb), { mode: 0o600 });
        args = smbMountArguments(smb, mountpoint, file);
      }
    } else {
      args = nfsMountArguments(target as NfsTarget, mountpoint);
    }

    await run('mount', args, { timeout: options.timeoutMs });
  } catch (error: unknown) {
    await rmdir(mountpoint).catch(() => undefined);

    const said =
      typeof error === 'object' &&
      error !== null &&
      'stderr' in error &&
      typeof error.stderr === 'string' &&
      error.stderr !== ''
        ? error.stderr
        : error instanceof Error
          ? error.message
          : String(error);

    throw new Error(explain(said), { cause: error });
  } finally {
    if (credentialsDir !== null) {
      await rm(credentialsDir, { recursive: true, force: true });
    }
  }

  return {
    directory: path.join(mountpoint, ...joinRemote(target.path).split('/').filter(Boolean)),
    /** Unmounts the share, lazily when it is still busy, and removes the mountpoint. */
    unmount: async (): Promise<void> => {
      try {
        await run('umount', [mountpoint], { timeout: options.timeoutMs });
      } catch {
        // A share still busy, or a server gone: detach it now, let the kernel finish later.
        await run('umount', ['-l', mountpoint], { timeout: options.timeoutMs }).catch(
          () => undefined,
        );
      }

      await rmdir(mountpoint).catch(() => undefined);
    },
  };
}
