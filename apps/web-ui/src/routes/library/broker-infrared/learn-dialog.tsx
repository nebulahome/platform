/**
 * Learning a button: one dialog whose face follows the learn job.
 *
 * **Ready** - the remote pointing at the blaster and what to do, and Start listening. **Listening**
 * - a ring counting down the blaster's half a minute round its glyph, slowly pulsing. **Radio** -
 * with a blaster that does RF 433 a switch at the top picks Infrared or Radio; Radio first holds
 * the button down while the blaster finds its frequency, then presses it once. **Captured** - the
 * code's pulses and protocol, Test (did the device react? Yes, or Learn again), the name with its
 * icon, then Save, or Save and learn next for a whole remote in a row. **Nothing heard** - why, and
 * Try again. Closing while it listens stops the blaster.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type {
  IconView,
  InfraredButton,
  InfraredLearnJob,
  InfraredRemote,
  InfraredSignal,
} from '@nebulahome/contracts';
import { AppIcon, Button, cn, Modal, Note, ProgressBar, Segmented } from '@nebulahome/ui';

import { InfraredLogo } from '@/components/brand-logos';
import { toMessage } from '@/lib/error-message';
import {
  cancelInfraredLearn,
  fetchInfraredLearnJob,
  INFRARED_QUERY_KEYS,
  learnInfrared,
  saveInfraredButton,
  testInfraredCode,
} from '@/library/infrared-api';
import { PulseStrip } from '@/routes/library/broker-parts';
import { BrokerMark } from '@/routes/library/brokers-page';
import { NameIconField } from '@/routes/library/name-icon-field';

import { kindName, ProtocolPill, protocolLine, pulsesLine } from './infrared-parts';

/** How often a job under way is read. */
const POLL_MS = 1000;

/** How long the blaster listens. */
const LISTEN_MS = 30_000;

/** What the dialog needs. */
export type LearnDialogProps = {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly remote: InfraredRemote;

  /** The button learned again; a new one when absent. */
  readonly button?: InfraredButton | undefined;

  /** A job already under way to follow. */
  readonly jobId?: string | undefined;
};

/**
 * Whether a job is still going.
 *
 * @param job - The job.
 * @returns True while the blaster sweeps or listens.
 */
function isGoing(job: InfraredLearnJob | undefined): boolean {
  return (
    job !== undefined &&
    (job.phase === 'ready' || job.phase === 'sweeping' || job.phase === 'listening')
  );
}

/**
 * Renders the dialog.
 *
 * @param props - See {@link LearnDialogProps}.
 * @returns The dialog.
 */
export function LearnDialog(props: LearnDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { isOpen, onClose, remote, button } = props;
  const [signal, setSignal] = useState<InfraredSignal>(button?.code.signal ?? 'ir');
  const [jobId, setJobId] = useState<string | null>(props.jobId ?? null);
  const [name, setName] = useState(button?.name ?? '');
  const [icon, setIcon] = useState<string | null>(button?.icon ?? null);
  const [reacted, setReacted] = useState<boolean | null>(null);
  const blasterName = remote.blasterName ?? '';

  const job = useQuery<InfraredLearnJob>({
    queryKey: [...INFRARED_QUERY_KEYS.learn, jobId ?? ''],
    enabled: jobId !== null,

    /**
     * Reads it again while the blaster sweeps or listens.
     *
     * @param query - The query, with what it read last.
     * @returns How soon to read it again, or false once it ended.
     */
    refetchInterval: (query) => (isGoing(query.state.data) ? POLL_MS : false),

    /**
     * Reads the job.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns Where it stands.
     */
    queryFn: async ({ signal: abort }) => fetchInfraredLearnJob(jobId ?? '', abort),
  });
  const current = jobId === null ? undefined : job.data;

  const start = useMutation({
    /**
     * Starts listening.
     *
     * @returns The job.
     */
    mutationFn: async () => learnInfrared(remote.blasterId ?? '', signal),

    /**
     * Follows it.
     *
     * @param started - The job.
     */
    onSuccess: (started) => {
      queryClient.setQueryData([...INFRARED_QUERY_KEYS.learn, started.id], started);
      setReacted(null);
      setJobId(started.id);
    },
  });
  const test = useMutation({
    /**
     * Sends the code caught, as a test.
     *
     * @returns When it went.
     */
    mutationFn: async () =>
      current?.code == null ? null : testInfraredCode(remote.blasterId ?? '', current.code),
  });
  const save = useMutation({
    /**
     * Saves the button.
     *
     * @param next - Whether to learn the next one after.
     * @returns The button.
     */
    mutationFn: async (next: boolean) => {
      if (current?.code == null) {
        return next;
      }

      await saveInfraredButton({
        remoteId: remote.id,
        ...(button === undefined ? {} : { id: button.id, cell: button.cell }),
        name: name.trim(),
        icon,
        code: current.code,
      });

      return next;
    },

    /**
     * Closes, or goes back to Ready for the next button.
     *
     * @param next - Whether to learn another.
     */
    onSuccess: (next) => {
      void queryClient.invalidateQueries({ queryKey: ['brokers', 'infrared'] });

      if (next) {
        setJobId(null);
        setName('');
        setIcon(null);
        setReacted(null);
      } else {
        onClose();
      }
    },
  });

  /** Closes, stopping the blaster when it still listens. */
  const close = (): void => {
    if (jobId !== null && isGoing(current)) {
      void cancelInfraredLearn(jobId).catch(() => undefined);
    }

    onClose();
  };

  const phase = current?.phase ?? null;
  const isRf = remote.canRf;
  const kind = kindName(remote.kind);

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      size="large"
      layout="card"
      lead={<BrokerMark broker="infrared" size={44} isLit />}
      title={
        button === undefined
          ? t('brokers.infrared.learn.title', 'Learn a button')
          : t('brokers.infrared.learn.again', 'Learn {{name}} again', { name: button.name })
      }
      description={t('brokers.infrared.learn.line', '{{remote}} · through {{blaster}}', {
        remote: remote.name,
        blaster: blasterName,
      })}
      closesOnBackdrop={phase === null}
      footer={
        phase === 'captured' ? (
          <>
            <span />
            <span className="flex items-center gap-2">
              {button === undefined ? (
                <Button
                  variant="ghost"
                  disabled={name.trim() === ''}
                  isBusy={save.isPending && save.variables}
                  onClick={() => {
                    save.mutate(true);
                  }}
                >
                  {t('brokers.infrared.learn.saveNext', 'Save and learn next')}
                </Button>
              ) : null}
              <Button
                disabled={name.trim() === ''}
                isBusy={save.isPending && !save.variables}
                onClick={() => {
                  save.mutate(false);
                }}
              >
                {t('brokers.infrared.learn.save', 'Save')}
              </Button>
            </span>
          </>
        ) : phase === 'failed' || phase === 'cancelled' ? (
          <>
            <span />
            <span className="flex items-center gap-2">
              <Button variant="bare" onClick={close}>
                {t('common.close', 'Close')}
              </Button>
              <Button
                isBusy={start.isPending}
                onClick={() => {
                  start.mutate();
                }}
              >
                {t('brokers.infrared.learn.tryAgain', 'Try again')}
              </Button>
            </span>
          </>
        ) : phase === null ? (
          <>
            <span className="text-caption text-foreground-subtle">
              {t('brokers.infrared.learn.thirty', 'The blaster listens for 30 s once you start.')}
            </span>
            <span className="flex items-center gap-2">
              <Button variant="bare" onClick={close}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button
                isBusy={start.isPending}
                disabled={remote.blasterId === null}
                onClick={() => {
                  start.mutate();
                }}
              >
                <AppIcon id="radio" size={15} />
                {t('brokers.infrared.learn.start', 'Start listening')}
              </Button>
            </span>
          </>
        ) : (
          <>
            <span className="text-caption text-foreground-subtle">
              {isRf
                ? t(
                    'brokers.infrared.learn.rfOnly',
                    'Radio shows only for blasters that do RF 433.',
                  )
                : ''}
            </span>
            <Button variant="ghost" onClick={close}>
              {t('common.cancel', 'Cancel')}
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-5">
        {isRf && (phase === null || phase === 'sweeping' || phase === 'listening') ? (
          <Segmented
            label={t('brokers.infrared.learn.signal', 'Signal')}
            value={current?.signal ?? signal}
            onChange={setSignal}
            disabled={phase !== null}
            options={[
              { value: 'ir', label: t('brokers.infrared.learn.infrared', 'Infrared') },
              { value: 'rf', label: t('brokers.infrared.learn.radio', 'Radio (433 MHz)') },
            ]}
            className="self-center"
          />
        ) : null}

        {phase === null ? (
          <Ready blasterName={blasterName} signal={signal} />
        ) : (current?.signal ?? signal) === 'rf' &&
          (phase === 'ready' || phase === 'sweeping' || phase === 'listening') ? (
          <RadioSteps job={current} />
        ) : phase === 'ready' || phase === 'listening' ? (
          <Listening job={current} blasterName={blasterName} />
        ) : phase === 'captured' && current?.code != null ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-ui font-medium text-foreground">
                <AppIcon id="circle-check" size={17} className="text-success" />
                {t('brokers.infrared.learn.caught', 'Caught it')}
              </span>
              <span className="flex items-center gap-2.5">
                <ProtocolPill protocol={current.code.protocol} />
                <span className="font-mono text-mono-caption text-foreground-muted">
                  {protocolLine(current.code.protocol)}
                </span>
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <PulseStrip pulses={current.code.pulses} className="h-14 border border-border" />
              <span className="font-mono text-mono-caption text-foreground-subtle">
                {pulsesLine(current.code)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 rounded-inner border border-border px-3.5 py-2.5">
              <Button
                variant="ghost"
                size="compact"
                isBusy={test.isPending}
                onClick={() => {
                  setReacted(null);
                  test.mutate();
                }}
              >
                <AppIcon id="send" size={14} />
                {t('brokers.infrared.learn.test', 'Test')}
              </Button>
              <span className="grow text-ui-sm text-foreground-muted">
                {reacted === true
                  ? t('brokers.infrared.learn.itWorks', 'It works.')
                  : t('brokers.infrared.learn.didItReact', 'Did the {{kind}} react?', {
                      kind: kind.toLowerCase() === 'tv' ? kind : kind.toLowerCase(),
                    })}
              </span>
              <Button
                variant="bare"
                size="compact"
                isBusy={start.isPending}
                onClick={() => {
                  start.mutate();
                }}
              >
                {t('brokers.infrared.learn.learnAgain', 'Learn again')}
              </Button>
              <Button
                variant="ghost"
                size="compact"
                onClick={() => {
                  setReacted(true);
                }}
              >
                <AppIcon id="check" size={14} />
                {t('brokers.infrared.learn.yes', 'Yes')}
              </Button>
            </div>
            <NameIconField
              value={name}
              onChange={setName}
              icon={icon}
              fallback="circle-dot"
              onIconChange={(picked: IconView) => {
                setIcon(picked.id);
              }}
              required
            />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Note tone="danger">
              {current?.phase === 'cancelled'
                ? t('brokers.infrared.learn.cancelled', 'Stopped before anything was caught.')
                : (current?.error ??
                  t('brokers.infrared.learn.nothing', 'Nothing reached the blaster in 30 s.'))}
            </Note>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-ui-sm text-foreground-muted">
              <li>
                {t(
                  'brokers.infrared.learn.tipClose',
                  'Hold the remote about 10 cm from the blaster, pointing straight at it.',
                )}
              </li>
              <li>
                {t(
                  'brokers.infrared.learn.tipBatteries',
                  'Check the remote’s batteries: a weak remote reaches a TV but not a blaster.',
                )}
              </li>
              <li>
                {t(
                  'brokers.infrared.learn.tipOnce',
                  'Press the button once, firmly, after Start listening.',
                )}
              </li>
            </ul>
          </div>
        )}

        {[start.error, test.error, save.error].map((error) =>
          error === null ? null : (
            <Note key={toMessage(error)} tone="danger">
              {toMessage(error)}
            </Note>
          ),
        )}
      </div>
    </Modal>
  );
}

/**
 * Ready: the remote pointing at the blaster, and what to do.
 *
 * @param props - The blaster and the signal.
 * @param props.blasterName - The blaster.
 * @param props.signal - Infrared or radio.
 * @returns The face.
 */
function Ready(props: { readonly blasterName: string; readonly signal: InfraredSignal }) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-4">
      <div
        aria-hidden="true"
        className="flex items-center gap-5 rounded-card border border-border bg-[radial-gradient(circle_at_85%_50%,color-mix(in_srgb,#f7895c_14%,transparent),transparent_55%)] px-8 py-7"
      >
        <span className="flex h-24 w-13 shrink-0 flex-col items-center gap-2 rounded-inner border border-border-strong bg-surface-raised pt-3">
          <span className="size-2 rounded-full bg-[#f7895c]" />
          <span className="grid grid-cols-2 gap-1.5">
            {['a', 'b', 'c', 'd', 'e', 'f'].map((key) => (
              <span key={key} className="size-2.5 rounded-[3px] bg-border-strong" />
            ))}
          </span>
        </span>
        <span className="relative flex grow items-center">
          <span className="h-0 grow border-t-2 border-dashed border-[#f7895c]/80" />
          <span className="absolute -top-6 left-1/2 -translate-x-1/2 font-mono text-mono-caption text-foreground-subtle">
            {t('brokers.infrared.learn.tenCm', 'about 10 cm')}
          </span>
        </span>
        <span className="flex size-18 shrink-0 items-center justify-center rounded-inner border border-border-strong bg-surface-raised infrared-glow">
          <InfraredLogo width={32} height={32} />
        </span>
      </div>
      <p className="text-ui font-medium text-foreground">
        {props.signal === 'rf'
          ? t(
              'brokers.infrared.learn.pointRf',
              'Hold the remote near {{blaster}}, then hold its button down when asked.',
              { blaster: props.blasterName },
            )
          : t(
              'brokers.infrared.learn.point',
              'Point the remote at {{blaster}} from about 10 cm and press the button once.',
              { blaster: props.blasterName },
            )}
      </p>
    </div>
  );
}

/**
 * The seconds left of a job's listening, counted down once a second.
 *
 * @param job - The job.
 * @returns The seconds.
 */
function useSecondsLeft(job: InfraredLearnJob | undefined): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, []);

  const ends =
    job?.endsAt?.getTime() ?? (job === undefined ? now : job.startedAt.getTime() + LISTEN_MS);

  return Math.max(0, Math.ceil((ends - now) / 1000));
}

/**
 * Listening: a ring counting down round the blaster's glyph.
 *
 * @param props - The job and the blaster.
 * @param props.job - The job.
 * @param props.blasterName - The blaster.
 * @returns The face.
 */
function Listening(props: {
  readonly job: InfraredLearnJob | undefined;
  readonly blasterName: string;
}) {
  const { t } = useTranslation();
  const left = useSecondsLeft(props.job);
  const radius = 84;
  const length = 2 * Math.PI * radius;

  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <span className="relative flex size-45 items-center justify-center">
        <svg aria-hidden="true" viewBox="0 0 180 180" className="absolute inset-0 -rotate-90">
          <circle
            cx="90"
            cy="90"
            r={radius}
            fill="none"
            stroke="var(--color-border)"
            strokeWidth="5"
          />
          <circle
            cx="90"
            cy="90"
            r={radius}
            fill="none"
            stroke="#f7895c"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={length}
            strokeDashoffset={length * (1 - left / (LISTEN_MS / 1000))}
            className="transition-[stroke-dashoffset] duration-1000 ease-linear"
          />
        </svg>
        <span className="absolute inset-4 rounded-full bg-[#f7895c]/6 motion-safe:animate-pulse" />
        <span className="relative flex size-16 items-center justify-center rounded-inner border border-border-strong bg-surface-raised infrared-glow">
          <InfraredLogo width={30} height={30} />
        </span>
      </span>
      <span className="font-mono text-mono-ui text-foreground-muted">
        {t('brokers.infrared.learn.secondsLeft', '{{seconds}} s left', { seconds: left })}
      </span>
      <span className="text-title font-medium text-foreground">
        {t('brokers.infrared.learn.pressNow', 'Press the button now')}
      </span>
      <span className="text-ui-sm text-foreground-muted">
        {t('brokers.infrared.listeningOn', 'Listening on {{blaster}}', {
          blaster: props.blasterName,
        })}
      </span>
    </div>
  );
}

/**
 * Radio: the frequency found while the button is held, then the press.
 *
 * @param props - The job.
 * @param props.job - It.
 * @returns The face.
 */
function RadioSteps(props: { readonly job: InfraredLearnJob | undefined }) {
  const { t } = useTranslation();
  const { job } = props;
  const isSweeping = job?.phase !== 'listening';
  const left = useSecondsLeft(job);

  return (
    <ol className="flex flex-col gap-4">
      <li className="flex items-start gap-3.5">
        <StepRing state={isSweeping ? 'running' : 'done'} />
        <span className="flex min-w-0 grow flex-col gap-1.5">
          <span className="text-ui font-medium text-foreground">
            {t(
              'brokers.infrared.learn.hold',
              'Hold the button down until the blaster finds its frequency',
            )}
          </span>
          <span className="text-caption text-foreground-subtle">
            {job?.frequencyHz == null
              ? t('brokers.infrared.learn.searching', 'Searching 433.92 MHz…')
              : t('brokers.infrared.learn.found', 'Found {{mhz}} MHz', {
                  mhz: (job.frequencyHz / 1_000_000).toFixed(2),
                })}
          </span>
          {isSweeping ? (
            <ProgressBar
              percent={Math.min(100, (1 - left / (LISTEN_MS / 1000)) * 100)}
              label={t('brokers.infrared.learn.sweeping', 'Finding the frequency')}
            />
          ) : null}
        </span>
      </li>
      <li className={cn('flex items-start gap-3.5', isSweeping && 'opacity-50')}>
        <StepRing state={isSweeping ? 'pending' : 'running'} />
        <span className="flex flex-col gap-0.5">
          <span className="text-ui font-medium text-foreground">
            {t('brokers.infrared.learn.pressOnce', 'Now press it once')}
          </span>
          <span className="text-caption text-foreground-subtle">
            {t('brokers.infrared.learn.catches', 'The blaster then catches the code itself')}
          </span>
        </span>
      </li>
    </ol>
  );
}

/**
 * A step's ring: turning while it runs, ticked once done, empty to come.
 *
 * @param props - The step's state.
 * @param props.state - It.
 * @returns The glyph.
 */
function StepRing(props: { readonly state: 'pending' | 'running' | 'done' }) {
  return props.state === 'done' ? (
    <AppIcon id="circle-check" size={20} className="mt-px shrink-0 text-success" />
  ) : (
    <span
      className={cn(
        'mt-px block size-5 shrink-0 rounded-full border-2',
        props.state === 'running'
          ? 'border-primary/25 border-t-primary motion-safe:animate-spin'
          : 'border-border-strong',
      )}
    />
  );
}
