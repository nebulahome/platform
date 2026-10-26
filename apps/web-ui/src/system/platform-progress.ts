/**
 * The steps the restart and update screens list, and the update's bar (boards N-Restart, N-Update,
 * N-Update-Failed), out of what the page has seen (`platform-store.ts`).
 *
 * Every step is something the page observed or the server said: a restart's services stopped is
 * the server no longer answering, its devices reconnected is the live channel back. The durations
 * are the time between two of those moments, as this page saw them.
 */
import { stageRank, type PlatformStage, type PlatformWatch } from '@/system/platform-store';

/** One line of a screen's list. */
export type PlatformStepId =
  | 'paused'
  | 'saved'
  | 'starting'
  | 'reconnecting'
  | 'backedUp'
  | 'downloaded'
  | 'installing'
  | 'restarting'
  | 'checking'
  | 'restored';

/** Where a step is. */
export type PlatformStepStatus = 'done' | 'running' | 'pending' | 'failed';

/** One step, with what its line says beside it. */
export type PlatformStep = {
  readonly id: PlatformStepId;
  readonly status: PlatformStepStatus;

  /** How long it took, once done; null when the page cannot tell. */
  readonly ms: number | null;

  /** How big it was: the backup, the download. */
  readonly bytes: number | null;
};

/** A duration longer than this was not measured, only guessed across two clocks. */
const MEASURABLE_MS = 60_000;

/**
 * How long passed between two moments the page saw.
 *
 * @param from - The first, in milliseconds since the epoch.
 * @param to - The second.
 * @returns The milliseconds, or null when either is unknown or they do not make sense.
 */
function between(from: number | undefined, to: number | undefined): number | null {
  if (from === undefined || to === undefined) {
    return null;
  }

  const ms = to - from;

  return ms >= 0 && ms < MEASURABLE_MS ? ms : null;
}

/**
 * Where a step stands, by the stage the page has seen.
 *
 * @param stage - The stage.
 * @param runsFrom - The first stage it runs in.
 * @param doneFrom - The first stage it is done in.
 * @returns Its status.
 */
function statusAt(
  stage: PlatformStage,
  runsFrom: PlatformStage,
  doneFrom: PlatformStage,
): PlatformStepStatus {
  const rank = stageRank(stage);

  return rank >= stageRank(doneFrom) ? 'done' : rank >= stageRank(runsFrom) ? 'running' : 'pending';
}

/**
 * The steps of a restart.
 *
 * @param watch - What the page has seen.
 * @returns Automations paused, state saved, services starting, devices reconnecting.
 */
function restartSteps(watch: PlatformWatch): PlatformStep[] {
  const { stage, seenAt } = watch;
  const startedAt = new Date(watch.operation.startedAt).getTime();

  return [
    {
      id: 'paused',
      status: 'done',
      ms: between(startedAt, seenAt.stopping),
      bytes: null,
    },
    {
      id: 'saved',
      status: statusAt(stage, 'stopping', 'away'),
      ms: between(seenAt.stopping, seenAt.away),
      bytes: null,
    },
    {
      id: 'starting',
      status: statusAt(stage, 'away', 'back'),
      ms: between(seenAt.away, seenAt.back),
      bytes: null,
    },
    {
      id: 'reconnecting',
      status: statusAt(stage, 'back', 'done'),
      ms: between(seenAt.back, seenAt.done),
      bytes: null,
    },
  ];
}

/**
 * The steps of an update, as it goes or as it ended.
 *
 * @param watch - What the page has seen.
 * @returns Backed up (when it was), downloaded, installing, restarting, checking - or, for one
 *   that did not finish, installing failed and the old version restored.
 */
function updateSteps(watch: PlatformWatch): PlatformStep[] {
  const { stage, operation, outcome } = watch;
  const backup: PlatformStep[] =
    operation.backupBytes === null
      ? []
      : [{ id: 'backedUp', status: 'done', ms: null, bytes: operation.backupBytes }];
  const downloaded: PlatformStep = {
    id: 'downloaded',
    status: statusAt(stage, 'downloading', 'installing'),
    ms: null,
    bytes: operation.downloadBytes,
  };

  if (stage === 'failed') {
    return [
      ...backup,
      { ...downloaded, status: 'done' },
      { id: 'installing', status: 'failed', ms: null, bytes: null },
      {
        id: 'restored',
        status: outcome?.status === 'rolled_back' ? 'done' : 'failed',
        ms: outcome?.restoredInMs ?? null,
        bytes: null,
      },
    ];
  }

  return [
    ...backup,
    downloaded,
    { id: 'installing', status: statusAt(stage, 'installing', 'back'), ms: null, bytes: null },
    { id: 'restarting', status: statusAt(stage, 'back', 'checking'), ms: null, bytes: null },
    { id: 'checking', status: statusAt(stage, 'checking', 'done'), ms: null, bytes: null },
  ];
}

/**
 * The steps the screen lists.
 *
 * @param watch - What the page has seen.
 * @returns The steps, in order.
 */
export function stepsOf(watch: PlatformWatch): PlatformStep[] {
  return watch.operation.kind === 'restart' ? restartSteps(watch) : updateSteps(watch);
}

/**
 * How full the update's bar is: the download's real share of it, then a step at a time.
 *
 * @param watch - What the page has seen.
 * @returns A whole percentage; null for a restart, whose bar only sweeps.
 */
export function percentOf(watch: PlatformWatch): number | null {
  if (watch.operation.kind === 'restart') {
    return null;
  }

  switch (watch.stage) {
    case 'stopping':
    case 'downloading': {
      return 10 + Math.floor((watch.operation.percent ?? 0) / 2);
    }
    case 'installing':
    case 'away': {
      return 60;
    }
    case 'back': {
      return 80;
    }
    case 'checking': {
      return 90;
    }
    case 'done':
    case 'failed': {
      return 100;
    }
  }
}
