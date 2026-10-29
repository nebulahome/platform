/**
 * How the Backup page says things: a location in one line, a run's outcome, the next backup.
 */
import type {
  BackupLocationView,
  BackupPhase,
  BackupRunView,
  BackupSection,
} from '@nebulahome/contracts';

import { defineMessage, text, translate, type Message } from '@/i18n/messages';

/** Each part of a backup, as the page names it. */
const SECTION_NAMES: Readonly<Record<BackupSection, Message>> = {
  configuration: defineMessage('backup.sections.configuration', 'Configuration'),
  history: defineMessage('backup.sections.history', 'History'),
  packages: defineMessage('backup.sections.packages', 'Packages'),
  containers: defineMessage('backup.sections.containers', 'Containers'),
};

/**
 * A part of a backup, as the page names it.
 *
 * @param section - The part.
 * @returns Its name.
 */
export function sectionName(section: BackupSection): string {
  return text(SECTION_NAMES[section]);
}

/** Each kind of location, as the page names it: the protocols by their own names. */
const KIND_NAMES: Readonly<Record<BackupLocationView['target']['kind'], Message | string>> = {
  system: defineMessage('backup.kinds.system', 'System'),
  local: defineMessage('backup.kinds.local', 'Folder'),
  smb: 'SMB',
  ftp: 'FTP',
  nfs: 'NFS',
};

/**
 * A kind of location, as the page names it.
 *
 * @param kind - The kind.
 * @returns Its name.
 */
export function kindName(kind: BackupLocationView['target']['kind']): string {
  const name = KIND_NAMES[kind];

  return typeof name === 'string' ? name : text(name);
}

/** What a run is doing, in a few words. */
const PHASE_NAMES: Readonly<Record<BackupPhase, Message>> = {
  preparing: defineMessage('backup.phases.preparing', 'Preparing'),
  dumping: defineMessage('backup.phases.dumping', 'Dumping the database'),
  packing: defineMessage('backup.phases.packing', 'Packing and encrypting'),
  uploading: defineMessage('backup.phases.uploading', 'Writing to the locations'),
  pruning: defineMessage('backup.phases.pruning', 'Removing old backups'),
  downloading: defineMessage('backup.phases.downloading', 'Fetching the archive'),
  verifying: defineMessage('backup.phases.verifying', 'Checking the archive'),
  safety_backup: defineMessage('backup.phases.safetyBackup', 'Backing up first'),
  restoring_database: defineMessage('backup.phases.restoringDatabase', 'Restoring the database'),
  reconciling: defineMessage('backup.phases.reconciling', 'Reconciling'),
  switching: defineMessage('backup.phases.switching', 'Switching'),
  starting_services: defineMessage('backup.phases.startingServices', 'Starting the services'),
  finishing: defineMessage('backup.phases.finishing', 'Finishing'),
};

/**
 * What a run is doing, in a few words.
 *
 * @param phase - Its step.
 * @returns The words.
 */
export function phaseName(phase: BackupPhase): string {
  return text(PHASE_NAMES[phase]);
}

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
      return translate('backup.systemTarget', 'backups/ in the data directory');
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
      return { words: translate('backup.outcomes.running', 'Running'), tone: 'accent' };
    case 'success':
      return {
        words:
          run.kind === 'restore'
            ? translate('backup.outcomes.restored', 'Restored')
            : translate('backup.outcomes.done', 'Done'),
        tone: 'success',
      };
    case 'partial':
      return { words: translate('backup.outcomes.partial', 'Partly done'), tone: 'warning' };
    case 'failure':
      return { words: translate('backup.outcomes.failed', 'Failed'), tone: 'danger' };
    case 'interrupted':
      return { words: translate('backup.outcomes.interrupted', 'Interrupted'), tone: 'warning' };
    case 'cancelled':
      return { words: translate('backup.outcomes.cancelled', 'Cancelled'), tone: 'neutral' };
  }
}

/** What started a run, in a few words. */
const TRIGGER_NAMES: Readonly<Record<BackupRunView['trigger'], Message>> = {
  schedule: defineMessage('backup.triggers.schedule', 'Scheduled'),
  catch_up: defineMessage('backup.triggers.catchUp', 'Missed, taken later'),
  manual: defineMessage('backup.triggers.manual', 'By hand'),
  pre_restore: defineMessage('backup.triggers.preRestore', 'Before a restore'),
};

/**
 * What started a run, in a few words.
 *
 * @param trigger - What started it.
 * @returns The words.
 */
export function triggerName(trigger: BackupRunView['trigger']): string {
  return text(TRIGGER_NAMES[trigger]);
}

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
