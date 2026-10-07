/**
 * One container: how busy it is, what it runs, how it is attached to the machine, and what it
 * last wrote.
 *
 * The buttons that start, stop, restart, update and remove it sit in the header, and are absent
 * for the platform's own containers and for one an integration runs: the first would stop the
 * page asking, the second is the integration's to manage - its details say which runs it. The
 * cards stand on one grid of two equal columns, so their edges line up down the page. The
 * environment is shown with the value of anything whose name says it is a secret withheld, by the
 * server, so it never reaches the page; a long one shows its first lines and the rest in a dialog.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import type { ContainerAction, ContainerDetail, ContainerPort } from '@nebulahome/contracts';
import { Badge, Button, Modal, Panel, PanelNote, Switch } from '@nebulahome/ui';

import { useSession } from '@/auth/session-store';
import { ExternalLinkIcon } from '@/components/icons';
import { LogViewer } from '@/components/log-viewer';
import {
  CONTAINER_QUERY_KEYS,
  controlContainer,
  fetchContainer,
  fetchContainerLogs,
  removeContainer,
  updateContainer,
} from '@/containers/api';
import { projectTitle } from '@/containers/container-groups';
import { toMessage } from '@/lib/error-message';
import { formatBytes } from '@/lib/format-bytes';
import { matchesQuery } from '@/lib/search-text';
import { composePath } from '@/routes/containers/container-card';
import { ContainerBadges, ContainerTile } from '@/routes/containers/container-parts';
import { DetailHeader, DetailPlaceholder } from '@/routes/library/detail-page';
import { Fact, When } from '@/routes/library/entity/details-panel';
import { SearchField } from '@/routes/library/search-field';
import { SystemUsageCard } from '@/routes/settings/system-usage-card';

/** How many variables the card shows before the rest go to a dialog. */
const ENV_SHOWN = 8;

/** The addresses that mean every interface of the machine. */
const EVERY_INTERFACE = new Set(['', '0.0.0.0', '::']);

/** What each action is called on its button. */
const ACTION_LABELS: Readonly<Record<ContainerAction, string>> = {
  start: 'Start',
  stop: 'Stop',
  restart: 'Restart',
};

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
      className="inline-flex max-w-full items-center gap-1 text-primary transition-colors hover:text-primary-hover"
    >
      <span className="truncate">{props.children}</span>
      <ExternalLinkIcon width="12" height="12" className="shrink-0" />
    </a>
  );
}

/**
 * The container's facts: what it runs, since when, and where it comes from.
 *
 * @param props - The container.
 * @param props.container - It.
 * @returns The panel.
 */
function ContainerDetails(props: { readonly container: ContainerDetail }) {
  const { container } = props;
  const webPage =
    container.webPort === null
      ? null
      : `${window.location.protocol}//${window.location.hostname}:${String(container.webPort)}`;

  return (
    <Panel title="Details">
      <dl>
        <Fact term="Image">
          <span className="font-mono text-caption break-all">{container.image}</span>
        </Fact>
        {container.version === null ? null : <Fact term="Version">{container.version}</Fact>}
        <Fact term="Update">
          {container.update.isInstalling
            ? `Installing${container.update.progress === null ? '' : ` · ${String(container.update.progress)}%`}`
            : container.update.isAvailable
              ? `${container.update.latestVersion ?? 'A newer image'} is out`
              : container.update.checkedAt === null
                ? 'Not checked yet'
                : 'Up to date'}
        </Fact>
        {container.registryUrl === null ? null : (
          <Fact term="Registry">
            <OutLink href={container.registryUrl}>
              {container.registryUrl.replace(/^https?:\/\//u, '')}
            </OutLink>
          </Fact>
        )}
        {webPage === null ? null : (
          <Fact term="Web page">
            <OutLink href={webPage}>{webPage.replace(/^https?:\/\//u, '')}</OutLink>
          </Fact>
        )}
        <Fact term="Status">{container.status}</Fact>
        {container.health === null ? null : <Fact term="Health">{container.health}</Fact>}
        <Fact term="Created">
          <When when={container.createdAt} />
        </Fact>
        {container.startedAt === null ? null : (
          <Fact term="Started">
            <When when={container.startedAt} />
          </Fact>
        )}
        <Fact term="Restart">{container.restartPolicy ?? 'no'}</Fact>
        {container.command === null ? null : (
          <Fact term="Command">
            <span className="font-mono text-caption break-all">{container.command}</span>
          </Fact>
        )}
        {container.managedBy === null || container.managedBy.isReleased ? null : (
          <Fact term="Run by">
            <Link
              to={
                container.managedBy.ownerKind === 'package'
                  ? `/packages/${encodeURIComponent(container.managedBy.vendorId)}`
                  : `/integrations/${encodeURIComponent(container.managedBy.vendorId)}`
              }
              className="text-primary underline-offset-2 hover:underline"
            >
              The {container.managedBy.vendorId}{' '}
              {container.managedBy.ownerKind === 'package' ? 'package' : 'integration'}
            </Link>
          </Fact>
        )}
        {container.isSystem ? (
          <Fact term="Part of">NebulaHome{container.isSelf ? ': the platform itself' : ''}</Fact>
        ) : null}
        {container.compose === null ? null : (
          <Fact term="Compose">
            <Link
              to={composePath(container.compose.project)}
              className="text-primary underline-offset-2 hover:underline"
            >
              {projectTitle(container.compose.project, container.isSystem)}
            </Link>
            <span className="text-foreground-subtle"> · {container.compose.service}</span>
          </Fact>
        )}
        {container.deviceId === null ? null : (
          <Fact term="Device">
            <Link
              to={`/devices/${encodeURIComponent(container.deviceId)}`}
              className="text-primary underline-offset-2 hover:underline"
            >
              Its entities
            </Link>
          </Fact>
        )}
        <Fact term="Id">
          <span className="font-mono text-caption break-all">{container.id.slice(0, 12)}</span>
        </Fact>
      </dl>
    </Panel>
  );
}

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
 * A port number in a chip.
 *
 * @param props - The words.
 * @param props.children - The port.
 * @param props.isMuted - Whether it is one only other containers reach.
 * @returns The chip.
 */
function PortChip(props: { readonly children: string; readonly isMuted?: boolean }) {
  return (
    <span
      className={
        props.isMuted === true
          ? 'inline-flex h-6 items-center rounded-chip border border-border px-2 font-mono text-caption text-foreground-subtle tabular'
          : 'inline-flex h-6 items-center rounded-chip border border-border bg-surface-raised px-2 font-mono text-caption text-foreground tabular'
      }
    >
      {props.children}
    </span>
  );
}

/**
 * The ports: each published one as the machine's port leading to the container's, with a way to
 * open the ones a browser can, and the ones only other containers reach.
 *
 * @param props - The container.
 * @param props.container - It.
 * @returns The panel.
 */
function ContainerPorts(props: { readonly container: ContainerDetail }) {
  const { container } = props;
  const { published, exposed } = portsOf(container.ports);
  const isHost = container.networkMode === 'host';

  return (
    <Panel title={`Ports · ${String(published.length + exposed.length)}`}>
      {isHost ? (
        <p className="px-4 py-3.5 text-ui text-foreground-muted">
          On the machine&apos;s own network: every port it opens is the machine&apos;s.
        </p>
      ) : published.length === 0 && exposed.length === 0 ? (
        <p className="px-4 py-3.5 text-ui text-foreground-muted">It opens no port.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {published.map((port) => {
            const page = `${window.location.protocol === 'https:' && port.containerPort === 443 ? 'https' : 'http'}://${port.hostIp ?? window.location.hostname}:${String(port.hostPort)}`;

            return (
              <li
                key={`${port.hostIp ?? '*'}:${String(port.hostPort)}/${port.protocol}`}
                className="flex flex-wrap items-center gap-2 px-4 py-2.5"
              >
                <PortChip>{String(port.hostPort)}</PortChip>
                <span aria-label="leads to" className="text-foreground-subtle">
                  →
                </span>
                <PortChip>{String(port.containerPort)}</PortChip>
                <Badge tone="neutral" size="small">
                  {port.protocol.toUpperCase()}
                </Badge>
                {port.hostIp === null ? null : (
                  <span className="font-mono text-caption text-foreground-subtle">
                    on {port.hostIp}
                  </span>
                )}
                <span className="grow" />
                {port.protocol === 'tcp' ? <OutLink href={page}>Open</OutLink> : null}
              </li>
            );
          })}
          {exposed.length === 0 ? null : (
            <li className="flex flex-col gap-2 px-4 py-2.5">
              <span className="text-caption text-foreground-subtle">
                Only other containers reach
              </span>
              <span className="flex flex-wrap gap-1.5">
                {exposed.map((port) => (
                  <PortChip key={port} isMuted>
                    {port}
                  </PortChip>
                ))}
              </span>
            </li>
          )}
        </ul>
      )}
    </Panel>
  );
}

/**
 * How the container is attached to the network: its mode and its networks.
 *
 * @param props - The container.
 * @param props.container - It.
 * @returns The panel.
 */
function ContainerNetwork(props: { readonly container: ContainerDetail }) {
  const { container } = props;
  const published = container.ports.filter((port) => port.hostPort !== null);

  return (
    <Panel title="Network">
      <dl>
        <Fact term="Mode">{container.networkMode}</Fact>
        {container.hostname === null ? null : <Fact term="Host name">{container.hostname}</Fact>}
        {container.networks.map((network) => (
          <Fact key={network.name} term={network.name}>
            <span className="flex flex-col gap-0.5">
              <span className="font-mono text-caption">{network.ipAddress ?? 'no address'}</span>
              {network.aliases.length === 0 ? null : (
                <span className="text-caption text-foreground-subtle">
                  as {network.aliases.join(', ')}
                </span>
              )}
            </span>
          </Fact>
        ))}
      </dl>
      {published.length === 0 && container.networkMode !== 'host' ? (
        <PanelNote>Nothing is published on the machine: only other containers reach it.</PanelNote>
      ) : null}
    </Panel>
  );
}

/**
 * What the container keeps, and where: its volumes, the folders of the machine, its devices.
 *
 * @param props - The container.
 * @param props.container - It.
 * @returns The panel.
 */
function ContainerStorage(props: { readonly container: ContainerDetail }) {
  const { container } = props;

  return (
    <Panel title="Storage">
      {container.mounts.length === 0 && container.devices.length === 0 ? (
        <p className="px-4 py-3.5 text-ui text-foreground-muted">Nothing is mounted.</p>
      ) : (
        <dl>
          {container.mounts.map((mount) => (
            <Fact key={mount.destination} term={mount.type}>
              <span className="flex flex-col gap-0.5 font-mono text-caption break-all">
                <span>{mount.destination}</span>
                <span className="text-foreground-subtle">
                  {mount.source ?? 'in memory'}
                  {mount.subpath === null ? '' : ` / ${mount.subpath}`}
                  {mount.isReadOnly ? ' · read-only' : ''}
                </span>
              </span>
            </Fact>
          ))}
          {container.devices.map((device) => (
            <Fact key={device.container} term="device">
              <span className="font-mono text-caption break-all">
                {device.host} → {device.container}
              </span>
            </Fact>
          ))}
        </dl>
      )}
    </Panel>
  );
}

/**
 * Variables of the environment, one row each.
 *
 * @param props - The variables.
 * @param props.variables - Them.
 * @returns The list.
 */
function EnvironmentList(props: { readonly variables: ContainerDetail['env'] }) {
  return (
    <ul className="flex flex-col divide-y divide-border">
      {props.variables.map((variable, index) => (
        // Two variables may share a name in a hand-written configuration.
        <li key={`${variable.name}-${String(index)}`} className="flex flex-col gap-0.5 px-4 py-2">
          <span className="font-mono text-caption text-foreground">{variable.name}</span>
          {variable.isHidden ? (
            <span>
              <Badge tone="neutral" size="small">
                withheld
              </Badge>
            </span>
          ) : (
            <span className="font-mono text-caption break-all text-foreground-muted">
              {variable.value ?? ''}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The container's environment, secrets withheld: the first few, and the rest in a dialog with a
 * search, since an image can set dozens.
 *
 * @param props - The container.
 * @param props.container - It.
 * @returns The panel.
 */
function ContainerEnvironment(props: { readonly container: ContainerDetail }) {
  const { container } = props;
  const [isAllShown, setAllShown] = useState(false);
  const [search, setSearch] = useState('');
  const found = container.env.filter((variable) =>
    matchesQuery([variable.name, variable.isHidden ? null : variable.value], search),
  );

  return (
    <Panel
      title={`Environment · ${String(container.env.length)}`}
      action={
        container.env.length > ENV_SHOWN ? (
          <Button
            variant="ghost"
            size="compact"
            onClick={() => {
              setAllShown(true);
            }}
          >
            Show all
          </Button>
        ) : undefined
      }
    >
      {container.env.length === 0 ? (
        <p className="px-4 py-3.5 text-ui text-foreground-muted">No variables.</p>
      ) : (
        <EnvironmentList variables={container.env.slice(0, ENV_SHOWN)} />
      )}
      {container.env.length > ENV_SHOWN ? (
        <PanelNote>
          <button
            type="button"
            className="text-primary transition-colors hover:text-primary-hover"
            onClick={() => {
              setAllShown(true);
            }}
          >
            {container.env.length - ENV_SHOWN} more
          </button>
        </PanelNote>
      ) : null}

      <Modal
        isOpen={isAllShown}
        onClose={() => {
          setAllShown(false);
          setSearch('');
        }}
        size="large"
        title={`The environment of ${container.displayName}`}
        description={`${String(container.env.length)} variables. The value of one whose name says it is a secret is withheld.`}
      >
        <div className="flex flex-col gap-3 px-5 pt-4">
          <SearchField
            label="Search the variables"
            placeholder="Search variables…"
            value={search}
            onChange={setSearch}
            className="w-full lg:w-full"
          />
        </div>
        <div className="max-h-[60vh] overflow-y-auto py-2">
          {found.length === 0 ? (
            <p className="px-5 py-3 text-ui text-foreground-subtle">
              No variable matches “{search.trim()}”.
            </p>
          ) : (
            <EnvironmentList variables={found} />
          )}
        </div>
      </Modal>
    </Panel>
  );
}

/**
 * The last lines the container wrote, followed as it writes them.
 *
 * @param props - The container's name.
 * @param props.name - It.
 * @returns The panel.
 */
function ContainerLogs(props: { readonly name: string }) {
  const { name } = props;
  const queryKey = useMemo(() => CONTAINER_QUERY_KEYS.logs(name), [name]);

  return (
    <LogViewer
      queryKey={queryKey}
      fileName={name}
      read={async (tail, since, signal) => fetchContainerLogs(name, tail, since, signal)}
    />
  );
}

/**
 * Renders one container's page.
 *
 * @returns The page.
 */
export function ContainerPage() {
  const { name = '' } = useParams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const can = useSession((state) => state.can);
  const canControl = can('container:control');
  const canInstall = can('container:install');
  const [failure, setFailure] = useState<string | null>(null);
  const [isRemoving, setRemoving] = useState(false);
  const [removeVolumes, setRemoveVolumes] = useState(false);

  const container = useQuery({
    queryKey: CONTAINER_QUERY_KEYS.one(name),

    /**
     * Reads the container.
     *
     * @param context - What TanStack Query provides.
     * @param context.signal - Cancels the request.
     * @returns The container.
     */
    queryFn: async ({ signal }: { signal: AbortSignal }) => fetchContainer(name, signal),
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  /** Reads everything about containers again after an action. */
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: CONTAINER_QUERY_KEYS.all });
  };

  const control = useMutation({
    /**
     * Starts, stops or restarts it.
     *
     * @param action - What to do.
     * @returns The container as it now is.
     */
    mutationFn: async (action: ContainerAction) => controlContainer(name, action),

    /** Clears the last failure and reads again. */
    onSuccess: () => {
      setFailure(null);
      refresh();
    },

    /**
     * Says why it did not work.
     *
     * @param error - What the server answered.
     */
    onError: (error) => {
      setFailure(toMessage(error));
    },
  });
  const update = useMutation({
    /**
     * Starts the update.
     *
     * @returns Once the supervisor took it.
     */
    mutationFn: async () => updateContainer(name),

    /** Clears the last failure and reads again. */
    onSuccess: () => {
      setFailure(null);
      refresh();
    },

    /**
     * Says why it did not work.
     *
     * @param error - What the server answered.
     */
    onError: (error) => {
      setFailure(toMessage(error));
    },
  });

  const removal = useMutation({
    /**
     * Stops and removes it.
     *
     * @returns Once it is gone.
     */
    mutationFn: async () => removeContainer(name, removeVolumes),

    /** Goes back to the grid, which no longer has it. */
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CONTAINER_QUERY_KEYS.all });
      setRemoving(false);
      void navigate('/containers');
    },
  });

  const view = container.data;
  const isControllable = view?.refusal === null;
  const isRunning = view?.state === 'running';
  const isBusy =
    control.isPending ||
    update.isPending ||
    removal.isPending ||
    view?.update.isInstalling === true;
  const actions: ContainerAction[] = isRunning ? ['restart', 'stop'] : ['start'];
  const latest = view?.samples.at(-1);

  return (
    <div className="flex min-h-0 grow flex-col">
      <DetailHeader
        crumbs={[
          { to: '/containers', label: 'Containers' },
          ...(view?.compose === null || view?.compose === undefined
            ? []
            : [
                {
                  to: composePath(view.compose.project),
                  label: projectTitle(view.compose.project, view.isSystem),
                },
              ]),
        ]}
        title={view?.displayName ?? name}
        actions={
          view !== undefined && isControllable && (canControl || canInstall) ? (
            <>
              {view.update.isAvailable && !view.update.isInstalling ? (
                <Button
                  size="compact"
                  isBusy={update.isPending}
                  disabled={isBusy}
                  onClick={() => {
                    update.mutate();
                  }}
                >
                  Update to {view.update.latestVersion ?? 'the newest'}
                </Button>
              ) : null}
              {canControl
                ? actions.map((action) => (
                    <Button
                      key={action}
                      variant="ghost"
                      size="compact"
                      isBusy={control.isPending && control.variables === action}
                      disabled={isBusy}
                      onClick={() => {
                        control.mutate(action);
                      }}
                    >
                      {ACTION_LABELS[action]}
                    </Button>
                  ))
                : null}
              {canInstall ? (
                <Button
                  variant="danger"
                  size="compact"
                  disabled={isBusy}
                  onClick={() => {
                    setRemoveVolumes(false);
                    setRemoving(true);
                  }}
                >
                  Remove
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />

      <div className="min-h-0 grow overflow-y-auto px-8 pt-5 pb-7">
        <div className="mx-auto flex max-w-7xl flex-col gap-5">
          {view === undefined ? (
            container.isPending ? (
              <DetailPlaceholder>Reading…</DetailPlaceholder>
            ) : (
              <DetailPlaceholder isProblem>{toMessage(container.error)}</DetailPlaceholder>
            )
          ) : (
            <>
              <section className="flex flex-wrap items-center gap-4">
                <ContainerTile name={view.name} icon="container" size={56} />
                <div className="flex min-w-0 grow flex-col gap-1">
                  <h2 className="truncate text-headline font-semibold tracking-tight">
                    {view.displayName}
                  </h2>
                  <p className="truncate font-mono text-caption text-foreground-muted">
                    {view.name} · {view.image}
                  </p>
                </div>
                <ContainerBadges container={view} />
              </section>

              {failure === null &&
              view.update.error === null &&
              view.warnings.length === 0 ? null : (
                <Panel title="Needs attention">
                  <ul className="flex flex-col gap-1.5 px-4 py-3 text-ui text-danger">
                    {failure === null ? null : <li>{failure}</li>}
                    {view.update.error === null ? null : (
                      <li>The last update check or install failed: {view.update.error}</li>
                    )}
                    {view.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </Panel>
              )}

              {isRunning ? (
                <div className="grid gap-5 lg:grid-cols-2">
                  <SystemUsageCard
                    title="Processor"
                    percent={latest?.cpuPercent ?? null}
                    details={['Share of the whole machine']}
                    series={view.samples.map((sample) => ({
                      at: sample.at.getTime(),
                      value: sample.cpuPercent,
                    }))}
                    color="var(--color-primary)"
                    dotClass="bg-primary"
                  />
                  <SystemUsageCard
                    title="Memory"
                    percent={
                      latest === undefined || latest.memoryLimitBytes === 0
                        ? null
                        : (latest.memoryUsedBytes / latest.memoryLimitBytes) * 100
                    }
                    details={
                      latest === undefined
                        ? ['Waiting for the first reading']
                        : [
                            `${formatBytes(latest.memoryUsedBytes)} in use`,
                            `of ${formatBytes(latest.memoryLimitBytes)}`,
                          ]
                    }
                    series={view.samples.map((sample) => ({
                      at: sample.at.getTime(),
                      value:
                        sample.memoryLimitBytes === 0
                          ? null
                          : (sample.memoryUsedBytes / sample.memoryLimitBytes) * 100,
                    }))}
                    color="var(--color-tag-teal)"
                    dotClass="bg-tag-teal"
                  />
                </div>
              ) : null}

              <div className="grid items-start gap-5 lg:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-5">
                  <ContainerDetails container={view} />
                  <ContainerStorage container={view} />
                </div>
                <div className="flex min-w-0 flex-col gap-5">
                  <ContainerPorts container={view} />
                  <ContainerNetwork container={view} />
                  <ContainerEnvironment container={view} />
                </div>
              </div>

              <ContainerLogs name={view.name} />
            </>
          )}
        </div>
      </div>

      <Modal
        isOpen={isRemoving}
        onClose={() => {
          setRemoving(false);
        }}
        size="small"
        title={`Remove ${view?.displayName ?? name}?`}
        description="It is stopped and removed. Its named volumes and the folders it was given stay."
        footer={
          <>
            {removal.error === null ? null : (
              <p role="alert" className="mr-auto text-ui text-danger">
                {toMessage(removal.error)}
              </p>
            )}
            <Button
              variant="ghost"
              disabled={removal.isPending}
              onClick={() => {
                setRemoving(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              isBusy={removal.isPending}
              onClick={() => {
                removal.mutate();
              }}
            >
              Remove
            </Button>
          </>
        }
      >
        <div className="px-5 py-4">
          <Switch
            label="Also delete the volumes Docker made for it alone"
            isOn={removeVolumes}
            onChange={setRemoveVolumes}
          />
        </div>
      </Modal>
    </div>
  );
}
