/**
 * The screen every signed-in page shows while Nebula Home restarts or updates itself (boards
 * N-Restart, N-Update, N-Update-Failed, N-Transition-Flow, N-Back-Online;
 * docs/releases-and-updates.md 4).
 *
 * Whoever started it, every open page is taken over: the page steps back - blurred, dimmed, a
 * little smaller - the sidebar's mark flies to the middle and keeps turning while the server is
 * away, and the steps tick off as the page sees them happen (`system/platform-progress.ts`). Once
 * Nebula Home answers again the screen goes and a note says so; after an update the page loads
 * again first, since the interface itself is new. An update that did not finish says so, with the
 * updater's log, and the old version is running again.
 *
 * The page watches for itself while the server is away: whether it answers (`/api/versions`, no
 * sign-in), then what it says of itself (`GET /system/platform`), then - for a restart - the live
 * channel coming back.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import type { PlatformUpdateOutcome } from '@nebulahome/contracts';
import { AppIcon, Button, cn, Logo } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { numberFormat } from '@/i18n/formatters';
import { formatBytes } from '@/lib/format-bytes';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { useLive } from '@/live/live-store';
import {
  fetchPlatformState,
  isPlatformUp,
  releaseNotesUrl,
  runSystemUpdates,
} from '@/settings/updates-api';
import {
  percentOf,
  stepsOf,
  type PlatformStep,
  type PlatformStepId,
} from '@/system/platform-progress';
import {
  isEnded,
  stageRank,
  usePlatform,
  type PlatformWatch,
  type PlatformWelcome,
} from '@/system/platform-store';

/** How often the page looks for the server while it is away. */
const POLL_MS = 1500;

/** How long the screen takes to go once Nebula Home is back. */
const LEAVE_MS = 600;

/** How long after the screen goes the note rises, and how long it stays. */
const WELCOME_AFTER_MS = 500;
const WELCOME_FOR_MS = 6000;

/** Where the page keeps, across the reload after an update, that it should say so. */
const WELCOME_KEY = 'nebula.platform.welcome';

/**
 * Keeps the note for after the reload; a browser that keeps nothing only loses the note.
 *
 * @param welcome - What it says.
 */
function keepWelcome(welcome: PlatformWelcome): void {
  try {
    sessionStorage.setItem(WELCOME_KEY, JSON.stringify(welcome));
  } catch {
    // Private windows may refuse storage: the update still went through.
  }
}

/**
 * Takes the note kept across the reload, once.
 *
 * @returns It, or null.
 */
function takeWelcome(): PlatformWelcome | null {
  try {
    const kept = sessionStorage.getItem(WELCOME_KEY);

    sessionStorage.removeItem(WELCOME_KEY);

    const parsed: unknown = kept === null ? null : JSON.parse(kept);

    return typeof parsed === 'object' &&
      parsed !== null &&
      'version' in parsed &&
      typeof parsed.version === 'string'
      ? { kind: 'update', version: parsed.version }
      : null;
  } catch {
    return null;
  }
}

/** Looks once at where Nebula Home is, and moves the watch on. */
async function look(): Promise<void> {
  const { watch, reach, fail, setMachine } = usePlatform.getState();

  if (watch === null || isEnded(watch.stage)) {
    return;
  }

  if (!(await isPlatformUp())) {
    reach('away');

    return;
  }

  if (watch.stage === 'away') {
    reach('back');
  }

  // Still the version that was running, before it went away: nothing to read yet.
  if (stageRank(usePlatform.getState().watch?.stage ?? 'stopping') < stageRank('back')) {
    return;
  }

  if (watch.operation.kind === 'restart') {
    if (useLive.getState().status === 'live') {
      reach('done');
    }

    return;
  }

  try {
    const state = await fetchPlatformState();
    const last = state.lastUpdate;
    const startedAt = new Date(watch.operation.startedAt).getTime();

    setMachine(state.machine);

    if (
      last !== null &&
      last.toVersion === watch.operation.toVersion &&
      new Date(last.finishedAt).getTime() >= startedAt
    ) {
      if (last.status === 'success') {
        reach('done');
      } else {
        fail(last);
      }
    } else {
      reach('checking');
    }
  } catch {
    // Its services are still coming up.
  }
}

/**
 * Wraps the page, which steps back while the screen is up.
 *
 * @param props - The page.
 * @param props.children - It.
 * @returns The page, stepped back or not.
 */
export function PlatformStage(props: { readonly children: ReactNode }) {
  const isUp = usePlatform((state) => state.watch !== null && state.watch.stage !== 'done');
  const isReturning = usePlatform((state) => state.welcome?.kind === 'update');

  return (
    <div className={cn('app-stage', isUp && 'app-stage-back', isReturning && 'animate-enter')}>
      {props.children}
    </div>
  );
}

/**
 * The mark in the middle, its glow and its ripples.
 *
 * @param props - Whether it works or failed.
 * @param props.isFailed - True for an update that did not finish.
 * @returns The mark.
 */
function Mark(props: { readonly isFailed: boolean }) {
  const flying = useRef<HTMLSpanElement>(null);
  const isReduced = useReducedMotion();

  // It comes from the sidebar's mark, growing as it flies to the middle.
  useEffect(() => {
    const element = flying.current;
    const from = document.querySelector('[data-nebula-mark] svg')?.getBoundingClientRect();

    if (element === null || from === undefined || props.isFailed || isReduced) {
      return;
    }

    const to = element.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);

    element.animate(
      [
        {
          transform: `translate(${String(dx)}px, ${String(dy)}px) scale(${String(from.width / to.width)})`,
        },
        { transform: 'none' },
      ],
      { duration: 500, delay: 200, easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)', fill: 'backwards' },
    );
  }, [props.isFailed, isReduced]);

  return (
    <div className="relative flex size-42 items-center justify-center">
      <span aria-hidden="true" className="system-halo animate-glow" />
      {props.isFailed ? null : (
        <>
          <span
            aria-hidden="true"
            className="absolute inset-0 animate-ripple rounded-full border border-primary/55"
          />
          <span
            aria-hidden="true"
            className="system-ripple-late absolute inset-0 animate-ripple rounded-full border border-primary/40"
          />
        </>
      )}
      <span ref={flying} className="relative">
        <Logo size={112} isWorking={!props.isFailed} tone={props.isFailed ? 'danger' : 'primary'} />
      </span>
    </div>
  );
}

/**
 * One line of the list: its sign, its words, what it measured.
 *
 * @param props - The step and its words.
 * @param props.step - The step.
 * @param props.label - What the line says.
 * @returns The line.
 */
function StepLine(props: { readonly step: PlatformStep; readonly label: string }) {
  const { step, label } = props;
  const detail =
    step.status !== 'done'
      ? null
      : step.bytes !== null
        ? formatBytes(step.bytes)
        : step.ms !== null
          ? `${numberFormat({ minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(step.ms / 1000)} s`
          : null;

  return (
    <li className="flex h-10 items-center gap-3 border-t border-border">
      {step.status === 'done' ? (
        <span className="flex size-5.5 shrink-0 items-center justify-center rounded-full bg-success/16 text-success">
          <AppIcon id="check" size={13} />
        </span>
      ) : step.status === 'failed' ? (
        <span className="flex size-5.5 shrink-0 items-center justify-center rounded-full bg-danger/16 text-danger">
          <AppIcon id="x" size={12} />
        </span>
      ) : step.status === 'running' ? (
        <span className="flex size-5.5 shrink-0 items-center justify-center text-primary-hover">
          <AppIcon id="loader-circle" size={18} className="animate-spin" />
        </span>
      ) : (
        <span className="flex size-5.5 shrink-0 items-center justify-center">
          <span className="size-2 rounded-full border-2 border-foreground-disabled" />
        </span>
      )}
      <span
        className={cn(
          'grow text-ui',
          step.status === 'running'
            ? 'font-medium text-foreground'
            : step.status === 'pending'
              ? 'text-foreground-subtle'
              : step.status === 'failed'
                ? 'text-foreground'
                : 'text-foreground-muted',
        )}
      >
        {label}
      </span>
      {detail === null ? null : (
        <span className="font-mono text-mono-caption text-foreground-subtle">{detail}</span>
      )}
    </li>
  );
}

/**
 * The words of each step, as it stands.
 *
 * @param watch - What the page has seen.
 * @param t - The translator.
 * @returns A function naming a step.
 */
function stepWords(
  watch: PlatformWatch,
  t: ReturnType<typeof useTranslation>['t'],
): (step: PlatformStep) => string {
  const from = watch.operation.fromVersion;
  const words: Record<PlatformStepId, readonly [done: string, doing: string]> = {
    paused: [
      t('platform.steps.paused', 'Automations paused'),
      t('platform.steps.pausing', 'Pausing automations'),
    ],
    saved: [
      t('platform.steps.saved', 'State saved'),
      t('platform.steps.saving', 'Saving the state'),
    ],
    starting: [
      t('platform.steps.started', 'Services started'),
      t('platform.steps.starting', 'Starting the services'),
    ],
    reconnecting: [
      t('platform.steps.reconnected', 'Devices reconnected'),
      t('platform.steps.reconnecting', 'Reconnecting devices'),
    ],
    backedUp: [
      t('platform.steps.backedUp', 'Backed up'),
      t('platform.steps.backingUp', 'Backing up'),
    ],
    downloaded: [
      t('platform.steps.downloaded', 'Downloaded'),
      t('platform.steps.downloading', 'Downloading'),
    ],
    installing: [
      t('platform.steps.installed', 'Installed'),
      t('platform.steps.installing', 'Installing'),
    ],
    restarting: [
      t('platform.steps.restarted', 'Services restarted'),
      t('platform.steps.restarting', 'Restarting the services'),
    ],
    checking: [
      t('platform.steps.checked', 'Every service checked'),
      t('platform.steps.checking', 'Checking every service'),
    ],
    restored: [
      t('platform.steps.restored', 'Restored {{version}}', { version: from }),
      t('platform.steps.restoring', 'Restoring {{version}}', { version: from }),
    ],
  };

  return (step) =>
    step.status === 'failed'
      ? step.id === 'installing'
        ? t('platform.steps.didNotStart', 'Installing · a service did not start')
        : t('platform.steps.notRestored', '{{version}} could not be put back', { version: from })
      : words[step.id][step.status === 'done' ? 0 : 1];
}

/**
 * The note that Nebula Home is back, at the top of the page for a few seconds.
 *
 * @returns The note, or nothing.
 */
function WelcomeNote() {
  const { t } = useTranslation();
  const welcome = usePlatform((state) => state.welcome);
  const setWelcome = usePlatform((state) => state.setWelcome);
  const [isShown, setShown] = useState(false);

  useEffect(() => {
    if (welcome === null) {
      return undefined;
    }

    const rise = setTimeout(() => {
      setShown(true);
    }, WELCOME_AFTER_MS);
    const go = setTimeout(() => {
      setShown(false);
      setWelcome(null);
    }, WELCOME_AFTER_MS + WELCOME_FOR_MS);

    return (): void => {
      clearTimeout(rise);
      clearTimeout(go);
    };
  }, [welcome, setWelcome]);

  if (welcome === null || !isShown) {
    return null;
  }

  return (
    <div
      role="status"
      className="fixed top-6 left-1/2 z-[110] flex -translate-x-1/2 animate-arrive items-center gap-3 rounded-pill border border-success/35 bg-canvas/72 py-2.5 pr-4 pl-2.5 text-foreground shadow-popover backdrop-blur-xl"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-success/18 text-success">
        <AppIcon id="check" size={15} />
      </span>
      <span className="text-ui font-medium">
        {welcome.kind === 'update' ? (
          <Trans
            i18nKey="platform.welcome.updated"
            defaults="Updated to <0>{{version}}</0>"
            values={{ version: welcome.version }}
            components={[<span key="version" className="font-mono" translate="no" />]}
          />
        ) : (
          t('platform.welcome.restarted', 'Nebula Home restarted')
        )}
      </span>
      <span className="text-ui-sm text-foreground-muted">
        {t('platform.welcome.running', '· every service is running')}
      </span>
      {welcome.kind === 'update' ? (
        <a
          href={releaseNotesUrl(welcome.version)}
          target="_blank"
          rel="noreferrer"
          className="ml-1.5 text-ui-sm text-primary-hover hover:text-foreground"
        >
          {t('platform.welcome.whatsNew', 'What’s new')}
        </a>
      ) : null}
    </div>
  );
}

/**
 * The screen, while Nebula Home restarts or updates, and the note once it is back.
 *
 * @returns The screen, the note, or nothing.
 */
export function PlatformOverlay() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const watch = usePlatform((state) => state.watch);
  const machine = usePlatform((state) => state.machine);
  const canUpdate = useSession((state) => state.can('system:update'));
  const [retryError, setRetryError] = useState<string | null>(null);
  const stage = watch?.stage ?? null;
  const kind = watch?.operation.kind ?? null;

  // After an update the page has loaded anew: it says so once.
  useEffect(() => {
    const welcome = takeWelcome();

    if (welcome !== null) {
      usePlatform.getState().setWelcome(welcome);
    }
  }, []);

  // While it runs, the page looks for the server itself.
  useEffect(() => {
    if (stage === null || isEnded(stage)) {
      return undefined;
    }

    const timer = setInterval(() => {
      void look();
    }, POLL_MS);

    return (): void => {
      clearInterval(timer);
    };
  }, [stage]);

  // The live channel dropping is the server going away too, and a restart is over once it is back.
  useEffect(
    () =>
      useLive.subscribe((live) => {
        const current = usePlatform.getState().watch;

        if (current === null || isEnded(current.stage)) {
          return;
        }

        if (live.status !== 'live' && stageRank(current.stage) < stageRank('away')) {
          usePlatform.getState().reach('away');
        } else if (live.status === 'live' && current.stage === 'back') {
          void look();
        }
      }),
    [],
  );

  // Done: a restart's screen goes and the page reads everything again; an update loads anew.
  useEffect(() => {
    if (stage !== 'done' || watch === null) {
      return undefined;
    }

    if (kind === 'update' && watch.operation.toVersion !== null) {
      keepWelcome({ kind: 'update', version: watch.operation.toVersion });
      window.location.reload();

      return undefined;
    }

    const timer = setTimeout(() => {
      usePlatform.getState().dismiss();
      usePlatform.getState().setWelcome({ kind: 'restart', version: watch.operation.fromVersion });
      void queryClient.invalidateQueries();
    }, LEAVE_MS);

    return (): void => {
      clearTimeout(timer);
    };
  }, [stage, kind, watch, queryClient]);

  if (watch === null) {
    return <WelcomeNote />;
  }

  const isFailed = watch.stage === 'failed';
  // A restart that is over fades out; an update that is over loads the page anew.
  const isLeaving = watch.stage === 'done' && kind === 'restart';
  const percent = percentOf(watch);
  const steps = stepsOf(watch);
  const wordsOf = stepWords(watch, t);
  const running = steps.find((step) => step.status === 'running');
  const outcome: PlatformUpdateOutcome | null = watch.outcome;
  const { fromVersion, toVersion } = watch.operation;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="platform-title"
      className={cn(
        'fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-canvas text-foreground transition-opacity duration-600',
        isFailed && 'system-failed',
        isLeaving ? 'opacity-0' : 'animate-enter',
      )}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="system-glow animate-glow" />
        <div className="system-glow-accent" />
      </div>
      <div className="absolute top-7 left-10 flex items-center gap-2.5 text-ui text-foreground-muted">
        <Logo size={22} />
        {/* The product's name, the same in every language. */}
        <span translate="no" className="font-semibold text-foreground">
          Nebula Home
        </span>
      </div>

      <main
        className={cn(
          'relative flex flex-col items-center p-10 text-center',
          kind === 'restart' ? 'gap-7' : 'gap-6.5',
        )}
      >
        <Mark isFailed={isFailed} />

        {kind === 'restart' ? (
          <>
            <div className="flex flex-col items-center gap-2.5">
              <h1 id="platform-title" className="text-display-lg font-semibold">
                {t('platform.restart.title', 'Restarting Nebula Home')}
              </h1>
              <p className="max-w-120 text-subhead leading-normal text-foreground-muted">
                {t(
                  'platform.restart.note',
                  'The services are starting again. This page reconnects by itself — no need to reload.',
                )}
              </p>
            </div>
            <div
              role="progressbar"
              aria-label={t('platform.restart.progress', 'Restarting')}
              className="relative h-0.75 w-80 overflow-hidden rounded-full bg-foreground/10"
            >
              <span className="system-sweep absolute top-0 left-0 h-full w-2/5 animate-sweep rounded-full" />
            </div>
          </>
        ) : isFailed ? (
          <div className="flex flex-col items-center gap-2.5">
            <h1 id="platform-title" className="text-display-lg font-semibold">
              {t('platform.failed.title', 'The update didn’t finish')}
            </h1>
            <p className="max-w-130 text-subhead leading-normal text-foreground-muted">
              {outcome?.status === 'rolled_back' ? (
                <Trans
                  i18nKey="platform.failed.rolledBack"
                  defaults="Nothing is lost: Nebula Home went back to <0>{{version}}</0> from the backup made a minute ago, and every service is running."
                  values={{ version: fromVersion }}
                  components={[<span key="version" className="font-mono" translate="no" />]}
                />
              ) : (
                <Trans
                  i18nKey="platform.failed.notRestored"
                  defaults="Nebula Home could not go back to <0>{{version}}</0> by itself. The copies of its data are kept: the log says where."
                  values={{ version: fromVersion }}
                  components={[<span key="version" className="font-mono" translate="no" />]}
                />
              )}
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-col items-center gap-3">
              <h1 id="platform-title" className="text-display-lg font-semibold">
                {t('platform.update.title', 'Updating Nebula Home')}
              </h1>
              <div className="flex items-center gap-2.5 font-mono text-ui" translate="no">
                <span className="rounded-pill border border-border-strong bg-canvas/45 px-3 py-1 text-foreground-muted backdrop-blur-lg">
                  {fromVersion}
                </span>
                <AppIcon id="chevron-right" size={16} className="text-foreground-subtle" />
                <span className="rounded-pill border border-primary-hover/45 bg-primary/14 px-3 py-1 text-foreground">
                  {toVersion}
                </span>
              </div>
            </div>
            <div className="flex w-100 flex-col gap-2">
              <div
                role="progressbar"
                aria-label={t('platform.update.progress', 'Update progress')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent ?? undefined}
                className="relative h-1.5 overflow-hidden rounded-full bg-foreground/10"
              >
                <span
                  className="system-shimmer absolute inset-y-0 left-0 animate-shimmer rounded-full transition-[width] duration-700"
                  /* eslint-disable-next-line react/forbid-dom-props -- the bar's length is the
                     progress, which no class can hold. */
                  style={{ width: `${String(percent ?? 0)}%` }}
                />
              </div>
              <div className="flex justify-between text-ui-sm text-foreground-muted">
                <span>{running === undefined ? '' : wordsOf(running)}</span>
                <span className="font-mono text-foreground">{`${String(percent ?? 0)}%`}</span>
              </div>
            </div>
          </>
        )}

        <ul
          aria-label={t('platform.steps.label', 'Steps')}
          className={cn(
            'm-0 list-none border-b border-border p-0 text-left',
            kind === 'restart' ? 'mt-1 w-90' : isFailed ? 'w-105' : 'w-100',
          )}
        >
          {steps.map((step) => (
            <StepLine key={step.id} step={step} label={wordsOf(step)} />
          ))}
        </ul>

        {kind === 'restart' ? (
          <span className="font-mono text-mono-caption text-foreground-subtle">
            {[fromVersion, machine, t('platform.restart.usually', 'usually about 30 s')]
              .filter((part) => part !== null)
              .join(' · ')}
          </span>
        ) : isFailed ? (
          <>
            <pre className="m-0 w-105 rounded-tile border border-border-strong bg-canvas/45 px-3.5 py-3 text-left font-mono text-mono-caption leading-relaxed break-words whitespace-pre-wrap text-foreground-muted backdrop-blur-lg">
              {outcome?.error ?? outcome?.log.at(-1) ?? ''}
            </pre>
            {retryError === null ? null : (
              <p role="alert" className="text-ui text-danger">
                {retryError}
              </p>
            )}
            <div className="flex gap-2">
              <Button
                variant="bare"
                className="h-11 px-5 text-foreground"
                onClick={() => {
                  const text = [outcome?.error ?? '', ...(outcome?.log ?? [])].join('\n');
                  const link = document.createElement('a');

                  link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
                  link.download = `nebula-update-${toVersion ?? 'log'}.log`;
                  link.click();
                  URL.revokeObjectURL(link.href);
                }}
              >
                {t('platform.failed.downloadLog', 'Download the log')}
              </Button>
              {canUpdate && toVersion !== null ? (
                <Button
                  variant="ghost"
                  className="h-11 bg-canvas/45 px-4.5 backdrop-blur-lg"
                  onClick={() => {
                    setRetryError(null);
                    runSystemUpdates([{ kind: 'core', version: toVersion }]).catch(
                      (error: unknown) => {
                        setRetryError(error instanceof Error ? error.message : String(error));
                      },
                    );
                  }}
                >
                  <AppIcon id="refresh-cw" size={15} />
                  {t('platform.failed.tryAgain', 'Try again')}
                </Button>
              ) : null}
              <Button
                className="h-11 bg-foreground px-5 text-canvas hover:enabled:bg-foreground/90"
                onClick={() => {
                  usePlatform.getState().dismiss();
                  void queryClient.invalidateQueries();
                }}
              >
                {t('platform.failed.back', 'Back to Nebula')}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            <span className="text-ui-sm text-foreground-muted">
              {t(
                'platform.update.keepOn',
                'Keep the server on. Automations pause for about a minute.',
              )}
            </span>
            {toVersion === null ? null : (
              <a
                href={releaseNotesUrl(toVersion)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-ui-sm text-primary-hover hover:text-foreground"
              >
                {t('platform.update.releaseNotes', 'Release notes')}
                <AppIcon id="external-link" size={13} />
              </a>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
