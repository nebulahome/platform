/**
 * The Overview tab of a package's page, as the board draws it: the health strip, what it provides,
 * and About.
 *
 * The strip is Runtime, Needs, Used by, Updates - each the state in a word, one line, and the one
 * action that fixes it: Open the log for a package that failed, Open for what waits on it, Update
 * for a newer release. Provides lists what the package brings into the house - its devices, the
 * containers it runs, the cards it adds to the dashboards - each a row that opens its own page.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { ApiPackageDetail, PackageRelation } from '@nebulahome/contracts';
import {
  AppIcon,
  Button,
  FactGrid,
  HealthCard,
  HealthStrip,
  ListRow,
  Pill,
  RowList,
  Section,
} from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { CONTAINER_QUERY_KEYS, fetchContainers } from '@/containers/api';
import { defineMessage, type Message, text } from '@/i18n/messages';
import { absoluteTime } from '@/lib/format-time';
import { fetchDevices, LIBRARY_QUERY_KEYS } from '@/library/api';
import {
  packageNeedsHealth,
  packageRuntimeHealth,
  packageUpdatesHealth,
  packageUsedByHealth,
} from '@/packages/package-health';
import { useInstalledPackages } from '@/packages/use-packages';
import { ContainerBadges } from '@/routes/containers/container-parts';
import { devicePath } from '@/routes/library/device/device-path';

/** What the sources are called. */
const SOURCE_LABELS = {
  index: defineMessage('packages.packageOverview.fromThePackageIndex', 'From the package index'),
  local: defineMessage('packages.packageOverview.installedFromAFile', 'Installed from a file'),
} as const;

/** What the runtimes are called. */
const RUNTIME_LABELS: Readonly<Record<ApiPackageDetail['runtime'], Message>> = {
  node: defineMessage('packages.packageOverview.nodeProcess', 'A Node process'),
  container: defineMessage('packages.packageOverview.containersOnly', 'Containers only'),
  none: defineMessage('packages.packageOverview.nothingOfItsOwn', 'Nothing of its own'),
};

/**
 * Where one relation's page is.
 *
 * @param relation - A package or an integration.
 * @returns Its address.
 */
export function relationPath(relation: PackageRelation): string {
  return relation.kind === 'package'
    ? `/packages/${encodeURIComponent(relation.id)}`
    : `/integrations/${encodeURIComponent(relation.id)}`;
}

/** What the overview needs. */
export type PackageOverviewProps = {
  readonly found: ApiPackageDetail;

  /** The newer release the index offers, if one is. */
  readonly newer: string | undefined;

  /** Whether the local folder holds another build of this version. */
  readonly hasNewBuild: boolean;

  /** Whether the index or the folder offers this package at all. */
  readonly isOffered: boolean;

  /** Updates or reinstalls it, for who may install; absent otherwise. */
  readonly onUpdate?: () => void;

  /** Whether an update is under way. */
  readonly isUpdating: boolean;

  /** Opens the Log tab, for a package that has a log. */
  readonly onOpenLog?: () => void;
};

/**
 * Renders the Overview tab.
 *
 * @param props - See {@link PackageOverviewProps}.
 * @returns The tab's content.
 */
export function PackageOverview(props: PackageOverviewProps) {
  const { t } = useTranslation();

  const { found, newer, hasNewBuild, isOffered, onUpdate, isUpdating, onOpenLog } = props;
  const can = useSession((state) => state.can);
  const { packages } = useInstalledPackages();
  const runtime = packageRuntimeHealth(found);
  const needs = packageNeedsHealth(found, packages);
  const usedBy = packageUsedByHealth(found);
  const updates = packageUpdatesHealth(found, newer, hasNewBuild, isOffered);
  const firstUser = found.usedBy[0];

  const devices = useQuery({
    queryKey: LIBRARY_QUERY_KEYS.devices,
    enabled: can('device:read'),

    /**
     * Reads every device; the tab keeps the package's.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns The devices.
     */
    queryFn: async ({ signal }) => fetchDevices(signal),
  });
  const containers = useQuery({
    queryKey: CONTAINER_QUERY_KEYS.list,
    enabled: can('container:read'),

    /**
     * Reads the host's containers; the tab keeps the package's.
     *
     * @param context - The query's abort signal.
     * @param context.signal - Cancels the request.
     * @returns Them.
     */
    queryFn: async ({ signal }) => fetchContainers(signal),
  });
  const ownDevices = (devices.data ?? []).filter(
    (device) => device.origin === 'package' && device.vendorId === found.id,
  );
  const ownContainers = (containers.data?.items ?? []).filter(
    (container) =>
      container.managedBy?.ownerKind === 'package' && container.managedBy.vendorId === found.id,
  );
  const cards = found.ui?.cards ?? [];
  const hasProvides = ownDevices.length + ownContainers.length + cards.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <HealthStrip>
        <HealthCard
          label={t('packages.packageOverview.runtime', 'Runtime')}
          tone={runtime.tone}
          value={runtime.value}
          detail={runtime.detail}
          action={
            found.state === 'failed' && onOpenLog !== undefined ? (
              <Button variant="ghost" size="compact" onClick={onOpenLog}>
                {t('packages.packageOverview.openTheLog', 'Open the log')}
              </Button>
            ) : undefined
          }
        />
        <HealthCard
          label={t('packages.packageOverview.needs', 'Needs')}
          tone={needs.tone}
          value={needs.value}
          detail={needs.detail}
        />
        <HealthCard
          label={t('packages.packageOverview.usedBy', 'Used by')}
          tone={usedBy.tone}
          value={usedBy.value}
          detail={usedBy.detail}
          action={
            firstUser === undefined || found.state === 'running' ? undefined : (
              <Link
                to={relationPath(firstUser)}
                className="inline-flex h-control-sm items-center rounded-pill border border-border-strong bg-surface-raised px-3 text-ui-sm font-medium text-foreground transition-colors hover:bg-surface-high"
              >
                {t('packages.packageOverview.open', 'Open')}
              </Link>
            )
          }
        />
        <HealthCard
          label={t('packages.packageOverview.updates', 'Updates')}
          tone={updates.tone}
          value={updates.value}
          detail={updates.detail}
          action={
            onUpdate !== undefined && (newer !== undefined || hasNewBuild) ? (
              <Button variant="ghost" size="compact" isBusy={isUpdating} onClick={onUpdate}>
                {newer === undefined
                  ? t('packages.packageOverview.reinstall', 'Reinstall')
                  : t('packages.packageOverview.update', 'Update')}
              </Button>
            ) : undefined
          }
        />
      </HealthStrip>

      {hasProvides ? (
        <Section title={t('packages.packageOverview.provides', 'Provides')}>
          <RowList>
            {ownDevices.map((device) => (
              <ListRow
                key={device.id}
                icon={<AppIcon id="cpu" size={18} />}
                title={device.name}
                subtitle={[
                  t('packages.packageOverview.device', 'Device'),
                  device.model,
                  device.areaName,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                meta={`${String(device.entityIds.length)} ${device.entityIds.length === 1 ? 'entity' : 'entities'}`}
                trailing={
                  device.state === 'running' ? (
                    <Pill tone="success">
                      {t('packages.packageOverview.reporting', 'Reporting')}
                    </Pill>
                  ) : (
                    <Pill>{t('packages.packageOverview.silent', 'Silent')}</Pill>
                  )
                }
                hasChevron
                wrap={(className, parts) => (
                  <Link to={devicePath(device.id)} aria-label={device.name} className={className}>
                    {parts}
                  </Link>
                )}
              />
            ))}
            {ownContainers.map((container) => (
              <ListRow
                key={container.id}
                icon={<AppIcon id="container" size={18} />}
                title={container.displayName}
                subtitle={t('packages.packageOverview.containerImage', 'Container · {{image}}', {
                  image: container.image,
                })}
                trailing={<ContainerBadges container={container} />}
                hasChevron
                wrap={(className, parts) => (
                  <Link
                    to={`/containers/${encodeURIComponent(container.name)}`}
                    aria-label={container.displayName}
                    className={className}
                  >
                    {parts}
                  </Link>
                )}
              />
            ))}
            {cards.map((card) => (
              <ListRow
                key={card.id}
                icon={<AppIcon id="layout-grid" size={18} />}
                title={card.name}
                subtitle={
                  card.description ?? t('packages.packageOverview.dashboardCard', 'Dashboard card')
                }
              />
            ))}
          </RowList>
        </Section>
      ) : null}

      <Section title={t('packages.packageOverview.about', 'About')}>
        <FactGrid
          facts={[
            { label: t('packages.packageOverview.id', 'Id'), value: found.id, isMono: true },
            {
              label: t('packages.packageOverview.version', 'Version'),
              value: found.version,
              isMono: true,
            },
            {
              label: t('packages.packageOverview.source', 'Source'),
              value: found.isSystem
                ? t('packages.packageOverview.shipsWithNebulaHome', 'Ships with Nebula Home')
                : text(SOURCE_LABELS[found.source]),
            },
            ...(found.repository === null
              ? []
              : [
                  {
                    label: t('packages.packageOverview.repository', 'Repository'),
                    value: (
                      <a
                        href={`https://github.com/${found.repository}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-primary transition-colors hover:text-primary-hover"
                      >
                        {found.repository}
                        <AppIcon id="external-link" size={13} />
                      </a>
                    ),
                  },
                ]),
            {
              label: t('packages.packageOverview.runsAs', 'Runs as'),
              value: text(RUNTIME_LABELS[found.runtime]),
            },
            {
              label: t('packages.packageOverview.removable', 'Removable'),
              value: found.isSystem
                ? t('packages.packageOverview.noPartOfThe', 'No, part of the platform')
                : t('packages.packageOverview.yes', 'Yes'),
            },
            {
              label: t('packages.packageOverview.installed', 'Installed'),
              value: absoluteTime(found.installedAt),
            },
          ]}
        />
      </Section>
    </div>
  );
}
