/**
 * What the containers pages share: the tile a container or a project is drawn with, the dot that
 * says whether it runs, the badges a container carries, and the card that says Docker cannot be
 * seen.
 */
import { Trans, useTranslation } from 'react-i18next';

import type { ContainerState, ContainerSummary, DockerStatus } from '@nebulahome/contracts';
import {
  AppIcon,
  Badge,
  Panel,
  type BadgeTone,
  type StatusDotTone,
  type UiIconId,
} from '@nebulahome/ui';

import { translate } from '@/i18n/messages';

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

/**
 * How a container's dot reads.
 *
 * @param container - The container.
 * @returns Its tone, what it says, and whether it pulses.
 */
export function dotOf(container: ContainerSummary): {
  readonly tone: StatusDotTone;
  readonly title: string;
  readonly isBusy: boolean;
} {
  if (container.update.isInstalling) {
    return {
      tone: 'accent',
      title: translate('containers.containerParts.updating', 'Updating'),
      isBusy: true,
    };
  }

  if (container.health === 'unhealthy') {
    return {
      tone: 'danger',
      title: translate('containers.containerParts.runningUnhealthy', 'Running, unhealthy'),
      isBusy: false,
    };
  }

  if (container.state === 'running') {
    return {
      tone: 'success',
      title:
        container.health === 'starting'
          ? translate('containers.containerParts.starting', 'Starting')
          : translate('containers.containerParts.running', 'Running'),
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
  const { t } = useTranslation();

  return (
    <Panel title={t('containers.containerParts.dockerCannotBeSeen', 'Docker cannot be seen')}>
      <div className="flex flex-col gap-3 px-4 py-3.5 text-ui text-foreground-muted">
        <p>
          {props.docker.reason ??
            t(
              'containers.containerParts.supervisorHasNotReached',
              'The supervisor has not reached Docker yet.',
            )}
        </p>
        <p>
          <Trans
            i18nKey="containers.containerParts.giveTheSocket"
            defaults="The platform reaches Docker through its socket. Give the container <0>-v /var/run/docker.sock:/var/run/docker.sock</0> - the compose file does - and it is asked again within half a minute. The socket is the machine's root: only the supervisor holds it."
            components={[<code key="socket" className="font-mono text-caption" translate="no" />]}
          />
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
  const { t } = useTranslation();

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
          {t('containers.containerParts.unhealthy', 'unhealthy')}
        </Badge>
      ) : null}
      {container.isSelf ? (
        <Badge tone="accent" size="small">
          {t('containers.containerParts.core', 'Core')}
        </Badge>
      ) : container.isSystem ? (
        <Badge tone="accent" size="small">
          {t('containers.containerParts.system', 'System')}
        </Badge>
      ) : null}
      {container.managedBy !== null && !container.managedBy.isReleased ? (
        <Badge tone="neutral" size="small">
          {t('containers.containerParts.integration', 'Integration')}
        </Badge>
      ) : null}
      {container.update.isInstalling ? (
        <Badge tone="accent" size="small">
          {t('containers.containerParts.updating', 'Updating')}
        </Badge>
      ) : container.update.isAvailable ? (
        <Badge tone="accent" size="small">
          {t('containers.containerParts.update', 'Update')}
        </Badge>
      ) : null}
    </span>
  );
}
