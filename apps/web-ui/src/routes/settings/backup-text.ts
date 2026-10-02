/**
 * How the Backup page says things: a location in one line, a run's outcome, the next backup.
 */
import type {
  BackupLocationView,
  BackupPhase,
  BackupRunView,
  BackupSection,
} from '@nebulahome/contracts';

/** Each part of a backup, as the page names it. */
export const SECTION_NAMES: Readonly<Record<BackupSection, string>> = {
  configuration: 'Configuration',
  history: 'History',
  packages: 'Packages',
};

/** Each kind of location, as the page names it. */
export const KIND_NAMES = {
  system: 'System',
  local: 'Folder',
  smb: 'SMB',
  ftp: 'FTP',
  nfs: 'NFS',
} as const;

/** What a run is doing, in a few words. */
export const PHASE_NAMES: Readonly<Record<BackupPhase, string>> = {
  preparing: 'Preparing',
  dumping: 'Dumping the database',
  packing: 'Packing and encrypting',
  uploading: 'Writing to the locations',
  pruning: 'Removing old backups',
  downloading: 'Fetching the archive',
  verifying: 'Checking the archive',
  safety_backup: 'Backing up first',
  restoring_database: 'Restoring the database',
  reconciling: 'Reconciling',
  switching: 'Switching',
  starting_services: 'Starting the services',
  finishing: 'Finishing',
};

/**
 * Where a location writes, in one line.
 *
 * @param location - The location.
 * @returns "//nas.local/backups/nebula", "ftp://server/backups", "/mnt/usb"…
 */
export function targetText(location: BackupLocationView): string {
  const { target } = location;
  /**
   * A path inside a share or a server, with its slashes tidied.
   *
   * @param path - The path.
   * @returns It, with one leading slash, or nothing.
   */
  const tail = (path: string): string => {
    const clean = path.split('/').filter(Boolean).join('/');

    return clean === '' ? '' : `/${clean}`;
  };

  switch (target.kind) {
    case 'system':
      return 'backups/ in the data directory';
    case 'local':
      return target.path;
    case 'smb':
      return `//${target.host}/${target.share}${tail(target.path)}`;
    case 'ftp':
      return `${target.security === 'none' ? 'ftp' : 'ftps'}://${target.host}${
        target.port === null ? '' : `:${String(target.port)}`
      }${tail(target.path)}`;
    case 'nfs':
      return `${target.host}:${target.export}${tail(target.path)}`;
  }
}

/**
 * How a run went, in a word or two.
 *
 * @param run - The run.
 * @returns The words, and the badge tone they go with.
 */
export function runOutcome(run: BackupRunView): {
  readonly words: string;
  readonly tone: 'success' | 'warning' | 'danger' | 'neutral' | 'accent';
} {
  switch (run.status) {
    case 'running':
      return { words: 'Running', tone: 'accent' };
    case 'success':
      return { words: run.kind === 'restore' ? 'Restored' : 'Done', tone: 'success' };
    case 'partial':
      return { words: 'Partly done', tone: 'warning' };
    case 'failure':
      return { words: 'Failed', tone: 'danger' };
    case 'interrupted':
      return { words: 'Interrupted', tone: 'warning' };
    case 'cancelled':
      return { words: 'Cancelled', tone: 'neutral' };
  }
}

/** What started a run, in a few words. */
export const TRIGGER_NAMES: Readonly<Record<BackupRunView['trigger'], string>> = {
  schedule: 'Scheduled',
  catch_up: 'Missed, taken later',
  manual: 'By hand',
  pre_restore: 'Before a restore',
};

/**
 * The quarter hour a time starts.
 *
 * @param time - `HH:MM`.
 * @returns The quarter hour from midnight, 0 to 95.
 */
export function slotOfTime(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);

  return Math.min(95, Math.floor((hours * 60 + minutes) / 15));
}

/**
 * The browser's own time zone: what a time typed on this page means.
 *
 * @returns An IANA zone, such as `Europe/Rome`.
 */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Whether two JSON values are the same, whatever the order of their keys.
 *
 * @param a - One.
 * @param b - The other.
 * @returns True when they are.
 */
export function isSameJson(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }

  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }

  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }

  const keysOfA = Object.keys(a);
  const keysOfB = Object.keys(b);

  return (
    keysOfA.length === keysOfB.length &&
    keysOfA.every((key) =>
      isSameJson((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  );
}
