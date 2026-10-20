/**
 * How adding a Matter device goes, as its dialog shows it: the steps on the right, each with what
 * it found, and on the left the device finding its way into the house's fabric.
 *
 * The picture is the Matter mark in two rings. While the device is being added the outer ring
 * turns slowly, the inner one breathes, and the device's badge rides the outer ring, coming a step
 * closer to the mark with each step done; once it is in, the badge rests by the mark and the rings
 * turn the success colour with one wave. A test certificate stops it: the rings turn the warning
 * colour, the badge becomes a warning and shakes once. With less motion asked for, the picture
 * stands still where the job is.
 */
import { useTranslation } from 'react-i18next';

import type { MatterCommissioning, MatterCommissioningStep } from '@nebulahome/contracts';
import { AppIcon, cn, type UiIconId } from '@nebulahome/ui';

import { MatterIcon } from '@/components/icons';

/** How far out the badge rides, by how many steps are done: the outer ring, then closer in. */
const ORBIT_RADII = [100, 92, 84, 76, 62, 48, 40] as const;

/** What the picture shows. */
export type JoinPhase = 'working' | 'done' | 'warning' | 'failed';

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

  if (job.state === 'failed') {
    return 'failed';
  }

  return job.state === 'succeeded' ? 'done' : 'working';
}

/** What the picture needs. */
export type JoinAnimationProps = {
  readonly phase: JoinPhase;

  /** How many steps are done. */
  readonly done: number;

  /** The device's glyph, once it is known what it is. */
  readonly icon?: UiIconId;
};

/**
 * The device finding its way into the fabric.
 *
 * @param props - See {@link JoinAnimationProps}.
 * @returns The picture, decorative: the steps say it in words.
 */
export function JoinAnimation(props: JoinAnimationProps) {
  const { phase, done, icon = 'plug' } = props;
  const radius = ORBIT_RADII[Math.min(done, ORBIT_RADII.length - 1)] ?? 100;
  const isWorking = phase === 'working';
  const look = RING_LOOK[phase];

  return (
    <div aria-hidden="true" className="relative size-50 shrink-0">
      <span
        className={cn(
          'absolute inset-0 rounded-full border border-dashed',
          look.outer,
          isWorking && 'matter-orbit',
        )}
      />
      <span
        className={cn(
          'absolute inset-7 rounded-full border bg-radial to-transparent to-70%',
          look.inner,
          look.core,
          isWorking && 'matter-breathe',
        )}
      />
      {phase === 'done' ? (
        <span className="matter-wave absolute inset-7 rounded-full border-2 border-success/60" />
      ) : null}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex size-16 items-center justify-center rounded-inner border border-border-strong bg-surface-raised matter-glow text-foreground">
          <MatterIcon width={32} height={32} />
        </span>
      </span>

      {/* The badge rides a ring of its own, turned while the device is on its way, kept upright. */}
      <span className={cn('absolute inset-0', isWorking && 'matter-orbit')}>
        <span
          className="absolute top-1/2 left-1/2 transition-transform duration-700"
          /* eslint-disable-next-line react/forbid-dom-props -- where on the ring is the job's. */
          style={{
            transform: `translate(-50%, -50%) rotate(${String(BADGE_ANGLE)}deg) translateY(-${String(radius)}px) rotate(-${String(BADGE_ANGLE)}deg)`,
          }}
        >
          <span
            className={cn(
              'flex size-10 items-center justify-center rounded-field',
              isWorking && 'matter-upright',
              look.badge,
            )}
          >
            <span className={cn('flex', phase === 'warning' && 'matter-shake')}>
              <AppIcon
                id={phase === 'warning' ? 'triangle-alert' : phase === 'failed' ? 'circle-x' : icon}
                size={20}
              />
            </span>
          </span>
        </span>
      </span>
    </div>
  );
}

/** Where the badge sits on the ring when it stands still: up and to the right. */
const BADGE_ANGLE = 57;

/** The rings' and the badge's colours, by phase. */
const RING_LOOK: Record<
  JoinPhase,
  { readonly outer: string; readonly inner: string; readonly core: string; readonly badge: string }
> = {
  working: {
    outer: 'border-violet/40',
    inner: 'border-violet/25',
    core: 'from-violet/16',
    badge: 'bg-surface-raised text-lamp',
  },
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
