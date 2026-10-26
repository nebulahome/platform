/**
 * What this page knows of Nebula Home restarting or updating itself, and how far it has seen it go.
 *
 * The server says what it can while it runs - a restart stopping the services, an update
 * downloading, then installing - and goes away. Everything after that the page sees for itself:
 * the server not answering, answering again, the version that came up being checked, how the
 * update ended. Each stage is kept with the moment this page saw it begin, which is what the
 * screen's durations are measured from (`platform-progress.ts`).
 *
 * Followed by every signed-in page, whoever started it: the supervisor tells every socket
 * (`platform_event`), and a page opened meanwhile reads it once (`GET /system/platform`).
 */
import { create } from 'zustand';

import type { PlatformOperation, PlatformUpdateOutcome } from '@nebulahome/contracts';

/** How far the page has seen an operation go, in order. */
export const PLATFORM_STAGES = [
  'stopping',
  'downloading',
  'installing',
  'away',
  'back',
  'checking',
  'done',
  'failed',
] as const;

/** How far the page has seen an operation go. */
export type PlatformStage = (typeof PLATFORM_STAGES)[number];

/** A restart or an update this page is showing. */
export type PlatformWatch = {
  /** The operation as the server last told it: versions, percent, sizes, when it began. */
  readonly operation: PlatformOperation;

  readonly stage: PlatformStage;

  /** When this page saw each stage begin, in milliseconds since the epoch. */
  readonly seenAt: Readonly<Partial<Record<PlatformStage, number>>>;

  /** How the update ended, once it did not finish. */
  readonly outcome: PlatformUpdateOutcome | null;
};

/** What the page says once Nebula Home is back. */
export type PlatformWelcome = {
  readonly kind: 'restart' | 'update';
  readonly version: string;
};

/** What the store holds. */
type PlatformStore = {
  readonly watch: PlatformWatch | null;

  /** The machine Nebula Home runs on, as Docker names it. */
  readonly machine: string | null;

  /** The note shown once Nebula Home is back, until it goes. */
  readonly welcome: PlatformWelcome | null;

  /**
   * Takes in what the server says is under way.
   *
   * @param operation - It, or null once nothing is.
   * @param now - When it was heard.
   */
  readonly follow: (operation: PlatformOperation | null, now?: number) => void;

  /**
   * Moves on to a stage the page saw for itself; never back.
   *
   * @param stage - The stage.
   * @param now - When it was seen.
   */
  readonly reach: (stage: PlatformStage, now?: number) => void;

  /**
   * Ends an update that did not finish.
   *
   * @param outcome - How it ended.
   * @param now - When the page learned it.
   */
  readonly fail: (outcome: PlatformUpdateOutcome, now?: number) => void;

  /** Takes the screen down. */
  readonly dismiss: () => void;

  /**
   * Remembers the machine's name.
   *
   * @param machine - It.
   */
  readonly setMachine: (machine: string | null) => void;

  /**
   * Shows, or takes away, the note that Nebula Home is back.
   *
   * @param welcome - What it says.
   */
  readonly setWelcome: (welcome: PlatformWelcome | null) => void;
};

/**
 * Where a stage stands in the order.
 *
 * @param stage - The stage.
 * @returns Its place; the two endings share the last.
 */
export function stageRank(stage: PlatformStage): number {
  return stage === 'failed' ? PLATFORM_STAGES.indexOf('done') : PLATFORM_STAGES.indexOf(stage);
}

/**
 * Whether the page has seen the operation end.
 *
 * @param stage - Its stage.
 * @returns True when it did.
 */
export function isEnded(stage: PlatformStage): boolean {
  return stage === 'done' || stage === 'failed';
}

/**
 * Whether two reports are of the same operation.
 *
 * @param a - One.
 * @param b - The other.
 * @returns True for one restart, or one update to one version.
 */
function isSame(a: PlatformOperation, b: PlatformOperation): boolean {
  return a.kind === b.kind && a.toVersion === b.toVersion && a.fromVersion === b.fromVersion;
}

/** What this page knows of Nebula Home restarting or updating. */
export const usePlatform = create<PlatformStore>((set) => ({
  watch: null,
  machine: null,
  welcome: null,

  /**
   * Takes in what the server says is under way.
   *
   * @param operation - It, or null.
   * @param now - When it was heard.
   */
  follow: (operation, now = Date.now()): void => {
    set((current) => {
      const watch = current.watch;

      if (operation === null) {
        // Said by the version that was running, before it went away: it gave up. Said after,
        // it is a new process that knows nothing of it, and the page goes on watching.
        return watch !== null && stageRank(watch.stage) < stageRank('away') ? { watch: null } : {};
      }

      const stage: PlatformStage = operation.phase;

      if (watch === null || isEnded(watch.stage) || !isSame(watch.operation, operation)) {
        return { watch: { operation, stage, seenAt: { [stage]: now }, outcome: null } };
      }

      const isLater = stageRank(stage) > stageRank(watch.stage);

      return {
        watch: {
          ...watch,
          // A new process knows nothing of how far the download went or the backup taken.
          operation: {
            ...operation,
            backupBytes: operation.backupBytes ?? watch.operation.backupBytes,
            downloadBytes: operation.downloadBytes ?? watch.operation.downloadBytes,
            startedAt: watch.operation.startedAt,
          },
          ...(isLater ? { stage, seenAt: { ...watch.seenAt, [stage]: now } } : {}),
        },
      };
    });
  },

  /**
   * Moves on to a stage.
   *
   * @param stage - The stage.
   * @param now - When it was seen.
   */
  reach: (stage, now = Date.now()): void => {
    set((current) => {
      const watch = current.watch;

      if (watch === null || stageRank(stage) <= stageRank(watch.stage)) {
        return {};
      }

      return { watch: { ...watch, stage, seenAt: { ...watch.seenAt, [stage]: now } } };
    });
  },

  /**
   * Ends an update that did not finish.
   *
   * @param outcome - How it ended.
   * @param now - When the page learned it.
   */
  fail: (outcome, now = Date.now()): void => {
    set((current) =>
      current.watch === null
        ? {}
        : {
            watch: {
              ...current.watch,
              stage: 'failed',
              seenAt: { ...current.watch.seenAt, failed: now },
              outcome,
            },
          },
    );
  },

  /** Takes the screen down. */
  dismiss: (): void => {
    set({ watch: null });
  },

  /**
   * Remembers the machine's name.
   *
   * @param machine - It.
   */
  setMachine: (machine): void => {
    set({ machine });
  },

  /**
   * Shows or takes away the note.
   *
   * @param welcome - What it says.
   */
  setWelcome: (welcome): void => {
    set({ welcome });
  },
}));
