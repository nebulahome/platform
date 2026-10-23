/**
 * How adding a Matter device goes, as its dialog shows it: the steps on the right, each with what
 * it found, and on the left devices finding their way into the house's fabric.
 *
 * The picture is the Matter mark in two rings, with three devices - a lamp, a plug, a sensor -
 * riding round it a third of a turn apart, coming a step closer to the mark with each step done.
 * While the device is looked for on the network the outer ring pulses with a soft glow; while it
 * is being added the inner ring breathes. Once it is in, the devices stop by the mark and the
 * rings turn the success colour with one wave. A test certificate stops them: the rings turn the
 * warning colour and the devices shake once. With less motion asked for, the picture stands still
 * where the job is.
 *
 * The turning keeps to the wall clock rather than starting where it is drawn, so a picture drawn
 * again - the dialog changing face as the job goes on - carries on from where the last one was,
 * and stopping it leaves the devices where they were rather than back at the start.
 */
import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import type { MatterCommissioning, MatterCommissioningStep } from '@nebulahome/contracts';
import { AppIcon, cn, type UiIconId } from '@nebulahome/ui';

import { MatterLogo } from '@/components/brand-logos';

/** How far out the devices ride, by how many steps are done: the outer ring, then closer in. */
const ORBIT_RADII = [100, 94, 88, 82, 76, 70, 64] as const;

/** One turn of the ring. */
const ORBIT_MS = 18_000;

/** The devices that ride the ring, and where each sits on it, in degrees. */
const RIDERS: readonly { readonly icon: UiIconId; readonly angle: number }[] = [
  { icon: 'lightbulb', angle: 57 },
  { icon: 'plug', angle: 177 },
  { icon: 'thermometer', angle: 297 },
];

/** What the picture shows: `searching` is the device being looked for on the network. */
export type JoinPhase = 'searching' | 'working' | 'done' | 'warning' | 'failed';

/**
 * Where a job stands, for the picture.
 *
 * @param job - The job.
 * @returns The phase.
 */
export function joinPhaseOf(job: MatterCommissioning): JoinPhase {
  if (job.state === 'needs-answer') {
    return 'warning';
  }

  if (job.state === 'failed' || job.state === 'cancelled') {
    return 'failed';
  }

  if (job.state === 'succeeded') {
    return 'done';
  }

  return job.steps.some((step) => step.id === 'found' && step.state === 'running')
    ? 'searching'
    : 'working';
}

/** What the picture needs. */
export type JoinAnimationProps = {
  readonly phase: JoinPhase;

  /** How many steps are done. */
  readonly done: number;
};

/**
 * Devices finding their way into the fabric.
 *
 * @param props - See {@link JoinAnimationProps}.
 * @returns The picture, decorative: the steps say it in words.
 */
export function JoinAnimation(props: JoinAnimationProps) {
  const { phase, done } = props;
  const radius = ORBIT_RADII[Math.min(done, ORBIT_RADII.length - 1)] ?? 100;
  const isMoving = phase === 'working' || phase === 'searching';
  const look = RING_LOOK[phase];

  // Where on its turn the ring is now, read once as the picture is drawn.
  const [turnedMs] = useState(() => Date.now() % ORBIT_MS);
  const turning: CSSProperties = {
    animationDuration: `${String(ORBIT_MS)}ms`,
    animationDelay: `-${String(turnedMs)}ms`,
    animationPlayState: isMoving ? 'running' : 'paused',
  };

  return (
    <div aria-hidden="true" className="relative size-50 shrink-0">
      <span
        className={cn('absolute inset-0 rounded-full', phase === 'searching' && 'matter-pulse')}
      >
        <span
          className={cn(
            'matter-orbit absolute inset-0 rounded-full border border-dashed',
            look.outer,
          )}
          /* eslint-disable-next-line react/forbid-dom-props -- the turn keeps to the clock. */
          style={turning}
        />
      </span>
      <span
        className={cn(
          'absolute inset-7 rounded-full border bg-radial to-transparent to-70%',
          look.inner,
          look.core,
          phase === 'working' && 'matter-breathe',
        )}
      />
      {phase === 'done' ? (
        <span className="matter-wave absolute inset-7 rounded-full border-2 border-success/60" />
      ) : null}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex size-16 items-center justify-center rounded-inner border border-border-strong bg-surface-raised matter-glow text-foreground">
          <MatterLogo width={32} height={32} />
        </span>
      </span>

      {/* The devices ride a ring of their own, each turned back as it is carried: upright. */}
      {/* eslint-disable-next-line react/forbid-dom-props -- the turn keeps to the clock. */}
      <span className="matter-orbit absolute inset-0" style={turning}>
        {RIDERS.map((rider) => (
          <span
            key={rider.icon}
            className="absolute top-1/2 left-1/2 transition-transform duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)]"
            /* eslint-disable-next-line react/forbid-dom-props -- where on the ring is the job's. */
            style={{
              transform: `translate(-50%, -50%) rotate(${String(rider.angle)}deg) translateY(-${String(radius)}px) rotate(-${String(rider.angle)}deg)`,
            }}
          >
            <span
              className={cn(
                'matter-upright flex size-9 items-center justify-center rounded-field',
                look.badge,
              )}
              /* eslint-disable-next-line react/forbid-dom-props -- the turn keeps to the clock. */
              style={turning}
            >
              <span className={cn('flex', phase === 'warning' && 'matter-shake')}>
                <AppIcon id={rider.icon} size={18} />
              </span>
            </span>
          </span>
        ))}
      </span>
    </div>
  );
}

/** The rings' and the devices' colours, by phase. */
const WORKING_LOOK = {
  outer: 'border-violet/40',
  inner: 'border-violet/25',
  core: 'from-violet/16',
  badge: 'bg-surface-raised text-lamp',
} as const;

const RING_LOOK: Record<
  JoinPhase,
  { readonly outer: string; readonly inner: string; readonly core: string; readonly badge: string }
> = {
  searching: { ...WORKING_LOOK, outer: 'border-violet/60' },
  working: WORKING_LOOK,
  warning: {
    outer: 'border-warning/45',
    inner: 'border-violet/25',
    core: 'from-warning/14',
    badge: 'bg-warning/14 text-warning',
  },
  done: {
    outer: 'border-success/50',
    inner: 'border-success/35',
    core: 'from-success/14',
    badge: 'bg-success/14 text-success',
  },
  failed: {
    outer: 'border-danger/40',
    inner: 'border-violet/25',
    core: 'from-danger/12',
    badge: 'bg-danger/14 text-danger',
  },
};

/**
 * A step's glyph: a check when done, a turning ring while running, an empty ring to come.
 *
 * @param props - The step's state.
 * @param props.state - It.
 * @returns The glyph.
 */
function StepGlyph(props: { readonly state: MatterCommissioningStep['state'] }) {
  switch (props.state) {
    case 'done': {
      return <AppIcon id="circle-check" size={20} className="text-success" />;
    }

    case 'warning': {
      return <AppIcon id="triangle-alert" size={20} className="text-warning" />;
    }

    case 'failed': {
      return <AppIcon id="circle-x" size={20} className="text-danger" />;
    }

    case 'running': {
      return (
        <span className="block size-5 rounded-full border-2 border-primary/25 border-t-primary motion-safe:animate-spin" />
      );
    }

    case 'pending': {
      return <span className="block size-5 rounded-full border-2 border-border-strong" />;
    }
  }
}

/** What the steps need. */
export type StepListProps = {
  readonly job: MatterCommissioning;
};

/**
 * The steps of a job, each with what it found.
 *
 * @param props - See {@link StepListProps}.
 * @returns The list.
 */
export function StepList(props: StepListProps) {
  const { t } = useTranslation();
  const { job } = props;
  const isWaiting = job.state === 'needs-answer';

  /**
   * What one step is called, and the line under it.
   *
   * @param step - The step.
   * @returns Its title and detail.
   */
  const wordsOf = (step: MatterCommissioningStep): { title: string; detail: string } => {
    const { detail } = step;

    switch (step.id) {
      case 'code': {
        return {
          title: t('brokers.matter.step.code', 'Code read'),
          detail:
            detail.discriminator === null
              ? detail.isQrCode
                ? t('brokers.matter.step.qrCode', 'QR code')
                : t('brokers.matter.step.manualCode', 'Manual code')
              : detail.isQrCode
                ? t(
                    'brokers.matter.step.qrCodeDiscriminator',
                    'QR code · discriminator {{value}}',
                    {
                      value: detail.discriminator,
                    },
                  )
                : t(
                    'brokers.matter.step.manualCodeDiscriminator',
                    'Manual code · discriminator {{value}}',
                    { value: detail.discriminator },
                  ),
        };
      }

      case 'found': {
        const ids =
          detail.vendorId === null
            ? null
            : t('brokers.matter.step.vendorProduct', 'Vendor {{vendor}}, product {{product}}', {
                vendor: hex(detail.vendorId),
                product: hex(detail.productId ?? 0),
              });
        const said = [detail.address, detail.product ?? ids].filter(
          (part): part is string => part !== null,
        );

        return {
          title: t('brokers.matter.step.found', 'Found it on the network'),
          detail:
            said.length > 0
              ? said.join(' · ')
              : t('brokers.matter.step.looking', 'On the local network, over the code'),
        };
      }

      case 'certificate': {
        return step.state === 'warning'
          ? {
              title: t('brokers.matter.step.testCertificate', 'A test certificate'),
              detail: t(
                'brokers.matter.step.notCertified',
                'Not listed in the DCL as a certified product',
              ),
            }
          : {
              title: t('brokers.matter.step.certificate', 'Certificate checked'),
              detail:
                step.state === 'done'
                  ? t('brokers.matter.step.certified', 'Certified, listed in the DCL')
                  : t('brokers.matter.step.againstDcl', 'Against the DCL'),
            };
      }

      case 'joining': {
        return {
          title: t('brokers.matter.step.joining', 'Joining the fabric'),
          detail: isWaiting
            ? t('brokers.matter.step.waiting', 'Waiting for your answer')
            : t('brokers.matter.step.keys', 'Certificates and keys. Up to a minute.'),
        };
      }

      case 'reading': {
        return {
          title: t('brokers.matter.step.reading', 'Reading what it can do'),
          detail: t('brokers.matter.step.clusters', 'Clusters, endpoints, firmware'),
        };
      }

      case 'in-house': {
        return {
          title: t('brokers.matter.step.inHouse', 'In the house'),
          detail:
            step.state === 'failed'
              ? t('brokers.matter.step.nobodyTookIt', 'No integration took it yet')
              : t('brokers.matter.step.takesIt', 'The integration that knows it takes it'),
        };
      }
    }
  };

  // Waiting on a test certificate, reading is not a step it has reached.
  const shown = job.steps.filter((step) => !(isWaiting && step.id === 'reading'));

  return (
    <ol className="flex flex-col gap-3.5">
      {shown.map((step) => {
        const words = wordsOf(step);
        const isStrong =
          step.state === 'running' || step.state === 'warning' || step.state === 'failed';

        return (
          <li
            key={step.id}
            className={cn('flex items-start gap-3.5', step.state === 'pending' && 'opacity-50')}
          >
            <span className="mt-px shrink-0">
              <StepGlyph state={step.state} />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span
                className={cn(
                  'text-ui',
                  isStrong ? 'font-medium' : 'font-normal',
                  step.state === 'warning'
                    ? 'text-warning'
                    : step.state === 'failed'
                      ? 'text-danger'
                      : 'text-foreground',
                )}
              >
                {words.title}
              </span>
              <span className="text-caption break-words text-foreground-subtle">
                {words.detail}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * A Matter id as the DCL writes it.
 *
 * @param value - The number.
 * @returns `0xFFF1`.
 */
function hex(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * How many steps of a job are done, for the picture.
 *
 * @param job - The job.
 * @returns The count.
 */
export function stepsDone(job: MatterCommissioning): number {
  return job.steps.filter((step) => step.state === 'done' || step.state === 'warning').length;
}
