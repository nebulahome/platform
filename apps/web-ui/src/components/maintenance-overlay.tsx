/**
 * The screen a restore is waited out on.
 *
 * It covers everything while the installation is restored: the page underneath reads data that is
 * about to be replaced. It follows the restore - from the backup service while the archive is
 * fetched and checked, from the public maintenance endpoint once the database is being swapped,
 * through the moments `api` itself restarts - and when it ends, it signs out on success (the
 * users are the archive's now) or says what went wrong, in full, and lets the person go back.
 */
import { useQuery } from '@tanstack/react-query';

import type { BackupPhase, MaintenanceState } from '@nebulahome/contracts';
import { Button } from '@nebulahome/ui';

import { useMaintenance } from '@/auth/maintenance-store';
import { useSession } from '@/auth/session-store';
import { fetchBackupStatus, fetchMaintenance } from '@/backup/api';

/** What each step is called on the screen. */
const PHASE_WORDS: Readonly<Partial<Record<BackupPhase, string>>> = {
  downloading: 'Fetching the archive',
  verifying: 'Opening and checking the archive',
  safety_backup: 'Backing up what is here now, first',
  restoring_database: 'Restoring the database',
  reconciling: 'Keeping this machine’s backup settings',
  switching: 'Switching to the restored data',
  starting_services: 'Starting the services again',
  finishing: 'Finishing',
};

/** How often the screen asks how the restore goes. */
const POLL_MS = 2000;

/** What the screen shows: in progress, or how it ended. */
type Progress =
  | {
      readonly kind: 'running';
      readonly phase: BackupPhase | null;
      readonly percent: number | null;
    }
  | { readonly kind: 'ended'; readonly state: MaintenanceState };

/**
 * Asks how the restore goes: the maintenance state, and - before the database is being swapped -
 * the backup service's own progress.
 *
 * @param runId - The restore this page started, when it did.
 * @param signal - Cancels the requests.
 * @returns The progress.
 */
async function readProgress(runId: string | null, signal: AbortSignal): Promise<Progress> {
  let state: MaintenanceState;

  try {
    state = await fetchMaintenance(signal);
  } catch {
    // `api` restarting, in the middle of the switch.
    return { kind: 'running', phase: 'starting_services', percent: null };
  }

  if (state.state === 'restoring') {
    return { kind: 'running', phase: state.phase, percent: state.percent };
  }

  const isOurs = runId === null || state.runId === runId;

  if (isOurs && state.outcome !== null) {
    return { kind: 'ended', state };
  }

  // Not yet in maintenance: the archive is still being fetched and checked.
  try {
    const status = await fetchBackupStatus(signal);

    return {
      kind: 'running',
      phase: status.active?.phase ?? 'downloading',
      percent: status.active?.bytesDone ?? null,
    };
  } catch {
    return { kind: 'running', phase: null, percent: null };
  }
}

/**
 * Renders the screen, while there is a restore to wait on.
 *
 * @returns The screen, or nothing.
 */
export function MaintenanceOverlay() {
  const isActive = useMaintenance((state) => state.isActive);
  const runId = useMaintenance((state) => state.runId);
  const leave = useMaintenance((state) => state.leave);
  const signOut = useSession((state) => state.signOut);
  const progress = useQuery({
    queryKey: ['maintenance', runId],
    enabled: isActive,
    /**
     * How soon to ask again: not once the restore has ended.
     *
     * @param query - The query, with what it last read.
     * @returns Milliseconds, or false to stop.
     */
    refetchInterval: (query) => (query.state.data?.kind === 'ended' ? false : POLL_MS),

    /**
     * Asks how the restore goes.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request.
     * @returns The progress.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => readProgress(runId, signal),
  });

  if (!isActive) {
    return null;
  }

  const data = progress.data;
  const ended = data?.kind === 'ended' ? data.state : null;
  const isRestored = ended?.outcome === 'restored';
  const percent = data?.kind === 'running' ? data.percent : isRestored ? 100 : null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="maintenance-title"
      className="fixed inset-0 z-[100] grid place-items-center bg-canvas/92 px-4 backdrop-blur-sm"
    >
      <div className="flex w-full max-w-md flex-col gap-4 rounded-panel border border-border bg-surface p-6">
        <h2 id="maintenance-title" className="text-subhead font-semibold text-foreground">
          {ended === null
            ? 'Restoring from a backup'
            : isRestored
              ? 'Restored'
              : 'The restore did not complete'}
        </h2>

        {ended === null ? (
          <>
            <p className="text-ui text-foreground-muted">
              {(data?.kind === 'running' && data.phase !== null
                ? PHASE_WORDS[data.phase]
                : undefined) ?? 'Working'}
              …
            </p>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-surface-high"
              role="progressbar"
              aria-label="How far the restore is"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent ?? undefined}
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-700"
                /* eslint-disable-next-line react/forbid-dom-props -- the bar's length is the
                   progress, which no class can hold. */
                style={{ width: `${String(Math.max(4, Math.min(100, percent ?? 8)))}%` }}
              />
            </div>
            <p className="text-caption text-foreground-subtle">
              The house keeps running until the switch, which takes a few seconds. Everybody signs
              in again afterwards: the accounts are the backup’s.
            </p>
          </>
        ) : isRestored ? (
          <>
            <p className="text-ui text-foreground-muted">
              The installation is back as it was when the backup was made. Sign in again with an
              account from then.
            </p>
            {ended.message === null ? null : (
              <p role="alert" className="text-ui text-warning">
                {ended.message}
              </p>
            )}
            <Button
              onClick={() => {
                void signOut().finally(() => {
                  leave();
                  window.location.assign('/');
                });
              }}
            >
              Sign in
            </Button>
          </>
        ) : (
          <>
            <p className="text-ui text-foreground-muted">
              {ended.outcome === 'rolled_back'
                ? 'Everything was put back as it was before the restore.'
                : ended.outcome === 'manual'
                  ? 'Putting things back did not complete either: the installation needs looking at.'
                  : 'Nothing was changed.'}
            </p>
            <div className="max-h-48 overflow-auto rounded-field border border-border bg-surface-raised p-3">
              <p role="alert" className="text-ui break-words whitespace-pre-wrap text-danger">
                {ended.message ?? 'The restore failed.'}
              </p>
            </div>
            <Button
              variant="ghost"
              onClick={() => {
                leave();
                window.location.reload();
              }}
            >
              Back to the settings
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
