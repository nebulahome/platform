/**
 * What the containers pages share: the tile a container or a project is drawn with, the dot that
 * says whether it runs, the badges a container carries, and the card that says Docker cannot be
 * seen.
 */
import type { ContainerState, ContainerSummary, DockerStatus } from '@nebula-home/contracts';
import { AppIcon, Badge, cn, Panel, type BadgeTone, type UiIconId } from '@nebula-home/ui';

/** What each state means to somebody reading the page. */
export const CONTAINER_TONES: Readonly<Record<ContainerState, BadgeTone>> = {
  created: 'neutral',
  running: 'success',
  paused: 'warning',
  restarting: 'accent',
  removing: 'warning',
  exited: 'neutral',
  dead: 'danger',
};

/** The tints a tile is drawn in, chosen by the name so a container keeps its colour. */
const TILE_COLORS = [
  '#6d7bff',
  '#3b9dff',
  '#22b8a7',
  '#e0a33b',
  '#d9667a',
  '#9b7bea',
  '#5fb35f',
  '#e07b4f',
] as const;

/**
 * The tint a name is drawn in: the same every time, different between most names.
 *
 * @param name - The name.
 * @returns A colour.
 */
export function tintOf(name: string): string {
  let hash = 0;

  for (const character of name) {
    hash = Math.trunc(hash * 31 + (character.codePointAt(0) ?? 0)) % 1_000_003;
  }

  return TILE_COLORS[hash % TILE_COLORS.length] ?? TILE_COLORS[0];
}

/** What a tile needs. */
type TileProps = {
  /** What decides its colour. */
  readonly name: string;

  /** The icon in it. */
  readonly icon: UiIconId;

  /** The side of the square, in pixels. */
  readonly size: number;
};

/**
 * The square a container or a project is recognised by, as a vendor's logo is: an icon on its
 * own tint, which follows the name.
 *
 * @param props - See {@link TileProps}.
 * @returns The square.
 */
export function ContainerTile(props: TileProps) {
  const { name, icon, size } = props;
  const color = tintOf(name);

  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-tile"
      /* eslint-disable-next-line react/forbid-dom-props -- the size and the tint are values
         chosen per container, which no class carries. */
      style={{
        width: size,
        height: size,
        backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 14%, transparent), inset 0 1px 0 rgb(255 255 255 / 0.04)`,
        color,
      }}
    >
      <AppIcon id={icon} size={Math.round(size * 0.5)} />
    </span>
  );
}

/** How a dot reads. */
export type DotTone = 'success' | 'warning' | 'danger' | 'neutral' | 'accent';

/** The colour of each tone's dot. */
const DOT_CLASSES: Readonly<Record<DotTone, string>> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  neutral: 'bg-foreground-subtle',
  accent: 'bg-primary',
};

/**
 * A round mark with a dot in it: whether a container runs, at a glance, the word in its tooltip.
 *
 * @param props - What it says.
 * @param props.tone - Its colour.
 * @param props.title - What it means, for the tooltip and a screen reader.
 * @param props.isBusy - Whether it pulses: something is being done.
 * @returns The mark.
 */
export function StatusDot(props: {
  readonly tone: DotTone;
  readonly title: string;
  readonly isBusy?: boolean;
}) {
  return (
    <span
      role="img"
      aria-label={props.title}
      title={props.title}
      className="inline-flex size-[26px] shrink-0 items-center justify-center rounded-full border border-border-soft face-raised"
    >
      <span
        className={cn(
          'size-2 rounded-full',
          DOT_CLASSES[props.tone],
          props.isBusy === true ? 'animate-pulse' : null,
        )}
      />
    </span>
  );
}

/**
 * How a container's dot reads.
 *
 * @param container - The container.
 * @returns Its tone, what it says, and whether it pulses.
 */
export function dotOf(container: ContainerSummary): {
  readonly tone: DotTone;
  readonly title: string;
  readonly isBusy: boolean;
} {
  if (container.update.isInstalling) {
    return { tone: 'accent', title: 'Updating', isBusy: true };
  }

  if (container.health === 'unhealthy') {
    return { tone: 'danger', title: 'Running, unhealthy', isBusy: false };
  }

  if (container.state === 'running') {
    return {
      tone: 'success',
      title: container.health === 'starting' ? 'Starting' : 'Running',
      isBusy: container.health === 'starting',
    };
  }

  return {
    tone: CONTAINER_TONES[container.state] === 'danger' ? 'danger' : 'neutral',
    title: container.status === '' ? container.state : container.status,
    isBusy: container.state === 'restarting',
  };
}

/**
 * What Docker being out of reach means, and what to do about it.
 *
 * @param props - The status.
 * @param props.docker - Why Docker cannot be seen.
 * @returns The card.
 */
export function DockerUnavailable(props: { readonly docker: DockerStatus }) {
  return (
    <Panel title="Docker cannot be seen">
      <div className="flex flex-col gap-3 px-4 py-3.5 text-ui text-foreground-muted">
        <p>{props.docker.reason ?? 'The supervisor has not reached Docker yet.'}</p>
        <p>
          The platform reaches Docker through its socket. Give the container{' '}
          <code className="font-mono text-caption">
            -v /var/run/docker.sock:/var/run/docker.sock
          </code>{' '}
          - the compose file does - and it is asked again within half a minute. The socket is the
          machine&apos;s root: only the supervisor holds it.
        </p>
      </div>
    </Panel>
  );
}

/**
 * The line of badges a container carries.
 *
 * @param props - The container, and whether to leave its state out - a card says it with a dot.
 * @param props.container - It.
 * @param props.isStateShown - Whether the state is a badge too.
 * @returns The badges.
 */
export function ContainerBadges(props: {
  readonly container: ContainerSummary;
  readonly isStateShown?: boolean;
}) {
  const { container, isStateShown = true } = props;

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {isStateShown ? (
        <Badge tone={CONTAINER_TONES[container.state]} size="small">
          {container.state}
        </Badge>
      ) : null}
      {isStateShown && container.health === 'unhealthy' ? (
        <Badge tone="danger" size="small">
          unhealthy
        </Badge>
      ) : null}
      {container.isSelf ? (
        <Badge tone="accent" size="small">
          Core
        </Badge>
      ) : container.isSystem ? (
        <Badge tone="accent" size="small">
          System
        </Badge>
      ) : null}
      {container.managedBy !== null && !container.managedBy.isReleased ? (
        <Badge tone="neutral" size="small">
          Integration
        </Badge>
      ) : null}
      {container.update.isInstalling ? (
        <Badge tone="accent" size="small">
          Updating
        </Badge>
      ) : container.update.isAvailable ? (
        <Badge tone="accent" size="small">
          Update
        </Badge>
      ) : null}
    </span>
  );
}

/**
 * A bar of how far something has got, and a pulse when it cannot say.
 *
 * @param props - How far.
 * @param props.percent - From 0 to 100; null when nothing says, which pulses the whole bar.
 * @param props.label - What it is, to a screen reader.
 * @returns The bar.
 */
export function ProgressBar(props: { readonly percent: number | null; readonly label: string }) {
  const { percent, label } = props;

  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      className="block h-1.5 w-full overflow-hidden rounded-full bg-surface-raised"
    >
      <span
        className={cn(
          'block h-full rounded-full bg-primary transition-[width] duration-500',
          percent === null ? 'w-full animate-pulse' : null,
        )}
        /* eslint-disable-next-line react/forbid-dom-props -- the width is the value itself. */
        style={percent === null ? undefined : { width: `${String(Math.max(4, percent))}%` }}
      />
    </span>
  );
}
