/**
 * The Overview tab of a container's page, as the board draws it: the health strip, how busy it
 * is, its ports, its storage, and its details.
 *
 * The strip is Runtime, Image, Used by - each the state in a word, one line, and the action that
 * fixes it: Update for a newer image. Ports lead from the machine's port to the container's, with
 * Open for the ones a browser can; Storage is what it keeps and where; Details is everything else
 * that says what it is.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { ContainerDetail, ContainerPort } from '@nebulahome/contracts';
import {
  AppIcon,
  Badge,
  FactGrid,
  HealthCard,
  HealthStrip,
  ListRow,
  Note,
  RowList,
  Section,
  type Fact,
} from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { projectTitle } from '@/containers/container-groups';
import {
  containerImageHealth,
  containerRuntimeHealth,
  containerUsedByHealth,
  type OwnerStanding,
} from '@/containers/container-health';
import { absoluteTime } from '@/lib/format-time';
import { fetchVendor, LIBRARY_QUERY_KEYS } from '@/library/api';
import { vendorStatusOf } from '@/library/vendor-status';
import { fetchPackage, PACKAGE_QUERY_KEYS } from '@/packages/api';
import { composePath } from '@/routes/containers/container-card';
import { ContainerUsage } from '@/routes/containers/container-usage';

/** The addresses that mean every interface of the machine. */
const EVERY_INTERFACE = new Set(['', '0.0.0.0', '::']);

/** One published port, once for every address it is on. */
type PublishedPort = {
  readonly hostPort: number;
  readonly containerPort: number;
  readonly protocol: string;

  /** The address it is published on, when not every one. */
  readonly hostIp: string | null;
};

/**
 * The ports, published ones once each - Docker lists a port on IPv4 and IPv6 apart - and the ones
 * only exposed to other containers.
 *
 * @param ports - The ports, as Docker lists them.
 * @returns The published and the exposed.
 */
export function portsOf(ports: readonly ContainerPort[]): {
  readonly published: PublishedPort[];
  readonly exposed: string[];
} {
  const published = new Map<string, PublishedPort>();
  const exposed = new Set<string>();

  for (const port of ports) {
    if (port.hostPort === null) {
      exposed.add(`${String(port.containerPort)}/${port.protocol}`);
      continue;
    }

    const hostIp = EVERY_INTERFACE.has(port.hostIp ?? '') ? null : port.hostIp;
    const key = `${hostIp ?? '*'}:${String(port.hostPort)}:${String(port.containerPort)}/${port.protocol}`;

    published.set(key, {
      hostPort: port.hostPort,
      containerPort: port.containerPort,
      protocol: port.protocol,
      hostIp,
    });
  }

  const publishedPorts = new Set(
    [...published.values()].map((port) => `${String(port.containerPort)}/${port.protocol}`),
  );

  return {
    published: [...published.values()].sort((left, right) => left.hostPort - right.hostPort),
    exposed: [...exposed].filter((port) => !publishedPorts.has(port)).sort(),
  };
}

/**
 * A link that leaves the platform.
 *
 * @param props - Where to, and what to call it.
 * @param props.href - The address.
 * @param props.children - The words.
 * @returns The link.
 */
function OutLink(props: { readonly href: string; readonly children: string }) {
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex max-w-full items-center gap-1.5 text-ui-sm text-primary transition-colors hover:text-primary-hover"
    >
      <span className="truncate">{props.children}</span>
      <AppIcon id="external-link" size={13} className="shrink-0" />
    </a>
  );
}

/**
 * How the integration or package that runs the container stands, read from its own page's data.
 *
 * @param container - The container.
 * @returns Its standing, or null while it is read or when it cannot be.
 */
function useOwnerStanding(container: ContainerDetail): OwnerStanding | null {
  const can = useSession((state) => state.can);
  const owner =
    container.managedBy === null || container.managedBy.isReleased ? null : container.managedBy;
  const vendor = useQuery({
    queryKey: [...LIBRARY_QUERY_KEYS.vendors, owner?.vendorId ?? ''],
    enabled: owner?.ownerKind === 'vendor' && can('integration:read'),

    /**
     * Reads the integration that runs it.
     *
     * @param context - The abort signal.
     * @param context.signal - Cancels the request.
     * @returns The vendor.
     */
    queryFn: async ({ signal }) => fetchVendor(owner?.vendorId ?? '', signal),
  });
  const found = useQuery({
    queryKey: PACKAGE_QUERY_KEYS.one(owner?.vendorId ?? ''),
    enabled: owner?.ownerKind === 'package' && can('package:read'),

    /**
     * Reads the package that runs it.
     *
     * @param context - The abort signal.
     * @param context.signal - Cancels the request.
     * @returns The package.
     */
    queryFn: async ({ signal }) => fetchPackage(owner?.vendorId ?? '', signal),
  });

  if (owner?.ownerKind === 'vendor' && vendor.data !== undefined) {
    const status = vendorStatusOf(vendor.data);

    return {
      name: vendor.data.name,
      isWorking: status.kind !== 'degraded',
      problem: status.kind === 'degraded' ? status.detail : null,
    };
  }

  if (owner?.ownerKind === 'package' && found.data !== undefined) {
    return {
      name: found.data.name,
      isWorking: found.data.state === 'running',
      problem: found.data.lastError ?? found.data.problems[0] ?? null,
    };
  }

  return null;
}

/** What the overview needs. */
export type ContainerOverviewProps = {
  readonly container: ContainerDetail;

  /** Updates it to the newer image, for who may; absent otherwise. */
  readonly onUpdate?: () => void;

  /** Whether an update is under way. */
  readonly isUpdating: boolean;
};

/**
 * Renders the Overview tab.
 *
 * @param props - See {@link ContainerOverviewProps}.
 * @returns The tab's content.
 */
export function ContainerOverview(props: ContainerOverviewProps) {
  const { t } = useTranslation();

  const { container, onUpdate, isUpdating } = props;
  const owner = useOwnerStanding(container);
  const runtime = containerRuntimeHealth(container);
  const image = containerImageHealth(container);
  const usedBy = containerUsedByHealth(container, owner);
  const { published, exposed } = portsOf(container.ports);
  const isHost = container.networkMode === 'host';
  const webPage =
    container.webPort === null
      ? null
      : `${window.location.protocol}//${window.location.hostname}:${String(container.webPort)}`;
  const problems = container.warnings;

  const facts: Fact[] = [
    {
      label: t('containers.containerOverview.image', 'Image'),
      value: container.image,
      isMono: true,
    },
    {
      label: t('containers.containerOverview.created', 'Created'),
      value: absoluteTime(container.createdAt),
    },
    {
      label: t('containers.containerOverview.restartPolicy', 'Restart policy'),
      value: container.restartPolicy ?? 'no',
      isMono: true,
    },
    {
      label: t('containers.containerOverview.network', 'Network'),
      value:
        container.networks.length === 0
          ? container.networkMode
          : container.networks
              .map(
                (network) =>
                  `${network.name} · ${network.ipAddress ?? t('containers.containerOverview.noAddress', 'no address')}`,
              )
              .join(', '),
      isMono: true,
    },
    ...(container.command === null
      ? []
      : [
          {
            label: t('containers.containerOverview.command', 'Command'),
            value: container.command,
            isMono: true,
          },
        ]),
    ...(container.managedBy === null || container.managedBy.isReleased
      ? []
      : [
          {
            label: t('containers.containerOverview.runBy', 'Run by'),
            value: (
              <Link
                to={
                  container.managedBy.ownerKind === 'package'
                    ? `/packages/${encodeURIComponent(container.managedBy.vendorId)}`
                    : `/integrations/${encodeURIComponent(container.managedBy.vendorId)}`
                }
                className="text-primary transition-colors hover:text-primary-hover"
              >
                {t('containers.containerOverview.supervisorFor', 'The supervisor, for')}{' '}
                {owner?.name ?? container.managedBy.vendorId}
              </Link>
            ),
          },
        ]),
    ...(container.compose === null
      ? []
      : [
          {
            label: t('containers.containerOverview.compose', 'Compose'),
            value: (
              <Link
                to={composePath(container.compose.project)}
                className="text-primary transition-colors hover:text-primary-hover"
              >
                {projectTitle(container.compose.project, container.isSystem)} ·{' '}
                {container.compose.service}
              </Link>
            ),
          },
        ]),
    ...(container.registryUrl === null
      ? []
      : [
          {
            label: t('containers.containerOverview.registry', 'Registry'),
            value: (
              <OutLink href={container.registryUrl}>
                {container.registryUrl.replace(/^https?:\/\//u, '')}
              </OutLink>
            ),
          },
        ]),
    ...(webPage === null
      ? []
      : [
          {
            label: t('containers.containerOverview.webPage', 'Web page'),
            value: <OutLink href={webPage}>{webPage.replace(/^https?:\/\//u, '')}</OutLink>,
          },
        ]),
    ...(container.deviceId === null
      ? []
      : [
          {
            label: t('containers.containerOverview.device', 'Device'),
            value: (
              <Link
                to={`/devices/${encodeURIComponent(container.deviceId)}`}
                className="text-primary transition-colors hover:text-primary-hover"
              >
                {t('containers.containerOverview.itsEntities', 'Its entities')}
              </Link>
            ),
          },
        ]),
    {
      label: t('containers.containerOverview.id', 'Id'),
      value: container.id.slice(0, 12),
      isMono: true,
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      {problems.length === 0 ? null : (
        <Note tone="danger">
          {problems.map((problem) => (
            <span key={problem} className="block">
              {problem}
            </span>
          ))}
        </Note>
      )}

      <HealthStrip>
        <HealthCard
          label={t('containers.containerOverview.runtime', 'Runtime')}
          tone={runtime.tone}
          value={runtime.value}
          detail={runtime.detail}
        />
        <HealthCard
          label={t('containers.containerOverview.image', 'Image')}
          tone={image.tone}
          value={image.value}
          detail={image.detail}
          action={
            onUpdate !== undefined && container.update.isAvailable && !container.update.isInstalling
              ? {
                  icon: 'download',
                  verb: t('containers.containerOverview.update', 'Update'),
                  isBusy: isUpdating,
                  onSelect: onUpdate,
                }
              : undefined
          }
        />
        <HealthCard
          label={t('containers.containerOverview.usedBy', 'Used by')}
          tone={usedBy.tone}
          value={usedBy.value}
          detail={usedBy.detail}
        />
      </HealthStrip>

      {container.state === 'running' ? <ContainerUsage container={container} /> : null}

      <Section title={t('containers.containerOverview.ports', 'Ports')}>
        {isHost ? (
          <p className="rounded-card border border-border bg-surface px-5 py-4 text-ui text-foreground-muted">
            {t(
              'containers.containerOverview.onTheMachineS',
              "On the machine's own network: every port it opens is the machine's.",
            )}
          </p>
        ) : published.length === 0 && exposed.length === 0 ? (
          <p className="rounded-card border border-border bg-surface px-5 py-4 text-ui text-foreground-muted">
            {t('containers.containerOverview.itOpensNoPort', 'It opens no port.')}
          </p>
        ) : (
          <RowList>
            {published.map((port) => {
              const page = `${window.location.protocol === 'https:' && port.containerPort === 443 ? 'https' : 'http'}://${port.hostIp ?? window.location.hostname}:${String(port.hostPort)}`;

              return (
                <ListRow
                  key={`${port.hostIp ?? '*'}:${String(port.hostPort)}/${port.protocol}`}
                  icon={<AppIcon id="network" size={18} />}
                  title={
                    <span className="font-mono tabular">
                      {port.hostPort} → {port.containerPort}
                    </span>
                  }
                  subtitle={
                    port.hostIp === null
                      ? port.protocol.toUpperCase()
                      : t(
                          'containers.containerOverview.protocolOnHost',
                          '{{protocol}} · on {{host}}',
                          {
                            protocol: port.protocol.toUpperCase(),
                            host: port.hostIp,
                          },
                        )
                  }
                  trailing={
                    port.protocol === 'tcp' ? (
                      <OutLink href={page}>
                        {t('containers.containerOverview.open', 'Open')}
                      </OutLink>
                    ) : undefined
                  }
                />
              );
            })}
            {exposed.length === 0 ? null : (
              <ListRow
                icon={<AppIcon id="network" size={18} />}
                title={<span className="font-mono tabular">{exposed.join(', ')}</span>}
                subtitle={t(
                  'containers.containerOverview.onlyOtherContainersReach',
                  'Only other containers reach these',
                )}
              />
            )}
          </RowList>
        )}
      </Section>

      <Section title={t('containers.containerOverview.storage', 'Storage')}>
        {container.mounts.length === 0 && container.devices.length === 0 ? (
          <p className="rounded-card border border-border bg-surface px-5 py-4 text-ui text-foreground-muted">
            {t('containers.containerOverview.nothingIsMounted', 'Nothing is mounted.')}
          </p>
        ) : (
          <RowList>
            {container.mounts.map((mount) => (
              <ListRow
                key={mount.destination}
                icon={<AppIcon id="hard-drive" size={18} />}
                title={<span className="font-mono">{mount.destination}</span>}
                subtitle={`${
                  mount.type === 'bind'
                    ? t('containers.containerOverview.folder', 'Folder')
                    : mount.type === 'volume'
                      ? t('containers.containerOverview.volume', 'Volume')
                      : mount.type
                } · ${mount.source ?? t('containers.containerOverview.inMemory', 'in memory')}${mount.subpath === null ? '' : ` / ${mount.subpath}`}`}
                trailing={
                  <Badge tone="neutral" size="small">
                    {mount.isReadOnly
                      ? t('containers.containerOverview.readOnly', 'Read-only')
                      : t('containers.containerOverview.readWrite', 'Read-write')}
                  </Badge>
                }
              />
            ))}
            {container.devices.map((device) => (
              <ListRow
                key={device.container}
                icon={<AppIcon id="cable" size={18} />}
                title={<span className="font-mono">{device.container}</span>}
                subtitle={t('containers.containerOverview.deviceHost', 'Device · {{host}}', {
                  host: device.host,
                })}
                trailing={
                  <Badge tone="neutral" size="small">
                    {t('containers.containerOverview.passedThrough', 'Passed through')}
                  </Badge>
                }
              />
            ))}
          </RowList>
        )}
      </Section>

      <Section title={t('containers.containerOverview.details', 'Details')}>
        <FactGrid facts={facts} />
      </Section>
    </div>
  );
}
